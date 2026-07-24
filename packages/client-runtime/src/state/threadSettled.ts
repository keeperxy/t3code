import type { EnvironmentThreadShell } from "./models.ts";
import { threadRuntimeIsActive } from "./models.ts";

export type ChangeRequestStateLike = "open" | "closed" | "merged";

const DAY_MS = 24 * 60 * 60 * 1_000;

export function threadLastActivityAt(shell: EnvironmentThreadShell): string | null {
  const candidates = [
    shell.latestUserMessageAt,
    shell.latestRun?.requestedAt,
    shell.latestRun?.startedAt,
    shell.latestRun?.completedAt,
  ];
  let latest: string | null = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const timestamp = Date.parse(candidate);
    if (timestamp > latestTimestamp) {
      latest = candidate;
      latestTimestamp = timestamp;
    }
  }

  return latest;
}

/**
 * A queued turn start lives for at most this long. Session adoption normally
 * takes seconds; after this window an unadopted message is stale state rather
 * than work that should keep the thread permanently unsettled.
 */
export const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;

/**
 * Detects a user message that has been dispatched but has not yet been
 * adopted by a run. Once adopted, the run's requested timestamp catches up
 * with the message timestamp and clears this transient state.
 */
export function hasQueuedTurnStart(
  shell: Pick<EnvironmentThreadShell, "latestUserMessageAt" | "latestRun" | "runtime">,
  options: { readonly now: string },
): boolean {
  if (
    shell.runtime?.status === "preparing" ||
    shell.runtime?.status === "queued" ||
    shell.runtime?.status === "starting"
  ) {
    return true;
  }
  if (shell.latestUserMessageAt === null) return false;
  if (shell.runtime?.status === "failed") return false;

  const messageAt = Date.parse(shell.latestUserMessageAt);
  const now = Date.parse(options.now);
  if (Number.isNaN(messageAt) || Number.isNaN(now)) return false;
  // Bound both future and past skew so a clock-ahead client cannot pin the
  // thread active for the entire skew interval.
  if (Math.abs(now - messageAt) > QUEUED_TURN_START_GRACE_MS) return false;
  if (shell.latestRun === null) return true;
  return [
    shell.latestRun.requestedAt,
    shell.latestRun.startedAt,
    shell.latestRun.completedAt,
  ].every((candidate) => candidate === null || Date.parse(candidate) < messageAt);
}

/**
 * A thread may be settled only when none of effectiveSettled's activity
 * blockers hold. This is deliberately the same list: anything the partition
 * refuses to CLASSIFY as settled must also be refused as a settle TARGET.
 * The server enforces its own invariants; this client-side twin exists so
 * the UI can disable/reject before a round trip.
 */
export function canSettle(
  shell: EnvironmentThreadShell,
  options: { readonly now: string },
): boolean {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) return false;
  if (threadRuntimeIsActive(shell.runtime)) return false;
  if (hasQueuedTurnStart(shell, options)) return false;
  return true;
}

/**
 * A merged/closed change request settles its thread only once the thread has
 * been idle this long. Without the idle guard the merge signal is permanent:
 * sending a message to a merged-PR thread would un-settle the row only until
 * its turn completed, then the still-merged PR would snap it straight back
 * into the settled tail. An hour keeps the follow-up conversation visible
 * while it is warm; once the burst goes stale the merge signal settles it
 * again. Activity timestamps can originate on another device while `now` is
 * this caller's clock: skew shortens or stretches the window by its size,
 * the same exposure the inactivity auto-settle already accepts — worst case
 * is a row changing lists early or late, never lost work.
 */
export const CHANGE_REQUEST_SETTLE_IDLE_MS = 60 * 60 * 1_000;

/**
 * Settled resolution over the server-backed settled lifecycle. Activity
 * blockers (pending approval/user-input, a live session, an unadjudicated
 * queued turn) are checked first and hold a thread active regardless of any
 * override. Past the blockers, the explicit user override (thread.settle /
 * thread.unsettle commands, projected into settledOverride + settledAt)
 * wins in both directions; without one, a thread auto-settles on a
 * merged/closed PR (once idle) or inactivity past the window. The server
 * un-settles on real activity (user message, session start, approval/
 * user-input request), so an override never goes stale silently.
 */
export function effectiveSettled(
  shell: EnvironmentThreadShell,
  options: {
    readonly now: string;
    readonly autoSettleAfterDays: number | null;
    readonly changeRequestState?: ChangeRequestStateLike | null;
  },
): boolean {
  // Blocked work must remain visible even when a user explicitly settled it.
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) return false;
  if (threadRuntimeIsActive(shell.runtime)) return false;
  if (hasQueuedTurnStart(shell, { now: options.now })) {
    // Trust a newer server-side settle acknowledgement near the grace
    // boundary; otherwise keep genuinely newer work visible.
    const serverAdjudicated =
      shell.settledOverride === "settled" &&
      shell.settledAt !== null &&
      shell.latestUserMessageAt !== null &&
      Date.parse(shell.settledAt) >= Date.parse(shell.latestUserMessageAt);
    if (!serverAdjudicated) return false;
  }
  if (shell.settledOverride === "settled") return true;
  // "active" is the explicit keep-active pin: it suppresses auto-settle
  // until real activity clears it server-side.
  if (shell.settledOverride === "active") return false;
  if (options.changeRequestState === "merged" || options.changeRequestState === "closed") {
    // Only an idle thread settles on the merge signal: the signal itself
    // never clears, so without this guard fresh activity (a message sent in
    // a settled thread) would re-settle the moment its turn completed.
    const lastActivityAt = threadLastActivityAt(shell);
    if (
      lastActivityAt === null ||
      Date.parse(lastActivityAt) < Date.parse(options.now) - CHANGE_REQUEST_SETTLE_IDLE_MS
    ) {
      return true;
    }
  }
  if (options.autoSettleAfterDays === null) return false;

  const lastActivityAt = threadLastActivityAt(shell);
  if (lastActivityAt === null) return false;

  // threadLastActivityAt only returns candidates whose Date.parse beat
  // -Infinity, so this parse is a real number; a malformed `now` yields NaN,
  // the comparison is false, and the thread stays active (never a surprise
  // auto-settle on bad input).
  return (
    Date.parse(lastActivityAt) < Date.parse(options.now) - options.autoSettleAfterDays * DAY_MS
  );
}
