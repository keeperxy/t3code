import {
  findTaskUsageFence,
  WS_METHODS,
  type TaskUsageFence,
  type TaskUsageReadReportInput,
  type TaskUsageReadReportResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";

export interface TaskUsageCandidateMessage {
  readonly id: string;
  readonly role: string;
  readonly text: string;
  readonly turnId?: string | null | undefined;
  readonly streaming: boolean;
}

/**
 * Which loaded messages render a task usage table, keyed by message id.
 *
 * A reference counts only in the terminal, settled assistant message of an
 * ended turn, and only its first such message per task renders a table, so a
 * repeated reference later in the thread stays ordinary code. The server
 * checks the same binding again; this only decides where the client asks.
 */
export function selectTaskUsageReports(input: {
  /** The thread's loaded messages, oldest first. */
  readonly messages: Iterable<TaskUsageCandidateMessage>;
  readonly terminalAssistantMessageIds: ReadonlySet<string>;
  /** Turns still running or not yet settled; their messages are not final. */
  readonly unsettledTurnIds: ReadonlySet<string>;
  readonly failedTurnIds?: ReadonlySet<string>;
}): ReadonlyMap<string, TaskUsageFence> {
  const selected = new Map<string, TaskUsageFence>();
  const claimedTaskIds = new Set<string>();
  for (const message of input.messages) {
    if (
      message.role !== "assistant" ||
      message.streaming ||
      !message.turnId ||
      input.unsettledTurnIds.has(message.turnId) ||
      input.failedTurnIds?.has(message.turnId) ||
      !input.terminalAssistantMessageIds.has(message.id)
    ) {
      continue;
    }
    const fence = findTaskUsageFence(message.text);
    if (
      fence === null ||
      fence.closingTurnId !== message.turnId ||
      claimedTaskIds.has(fence.taskId)
    )
      continue;
    claimedTaskIds.add(fence.taskId);
    selected.set(message.id, fence);
  }
  return selected;
}

export type TaskUsageReportState =
  | TaskUsageReadReportResult
  | { readonly status: "unavailable"; readonly reason: "unsupported-server" }
  | { readonly status: "error" };

const UNSUPPORTED: TaskUsageReportState = { status: "unavailable", reason: "unsupported-server" };
const ERROR: TaskUsageReportState = { status: "error" };

/** Wait before the next poll of a pending report: 3 s doubling to 30 s. */
export function taskUsagePollDelayMs(pendingReads: number): number {
  return Math.min(3_000 * 2 ** Math.max(0, pendingReads - 1), 30_000);
}

function pollSession(
  session: RpcSession,
  input: TaskUsageReadReportInput,
): Stream.Stream<TaskUsageReportState> {
  const readOnce = session.client[WS_METHODS.taskUsageReadReport](input).pipe(
    Effect.map((result): TaskUsageReportState => result),
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.succeed(ERROR),
    ),
  );
  return Stream.unwrap(
    session.initialConfig.pipe(
      Effect.map((config) =>
        config.taskUsageReports === true
          ? Stream.unfold<number | null, TaskUsageReportState, never, never>(0, (pendingReads) =>
              pendingReads === null
                ? Effect.succeed(undefined)
                : Effect.sleep(pendingReads === 0 ? 0 : taskUsagePollDelayMs(pendingReads)).pipe(
                    Effect.andThen(readOnce),
                    Effect.map(
                      (state) =>
                        [state, state.status === "pending" ? pendingReads + 1 : null] as const,
                    ),
                  ),
            )
          : Stream.succeed(UNSUPPORTED),
      ),
      // A session whose config never arrived is going away; the next one retries.
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.succeed(Stream.empty),
      ),
    ),
  );
}

/**
 * Fresh reads of one report while it is pending, ending once it is complete
 * or permanently unavailable. Each new connection reads again, so a reload or
 * reconnect shows the retained report; servers without the capability are
 * never sent the method.
 */
export function watchTaskUsageReport(
  input: TaskUsageReadReportInput,
): Stream.Stream<TaskUsageReportState, never, EnvironmentSupervisor> {
  return Stream.unwrap(
    EnvironmentSupervisor.pipe(
      Effect.map((supervisor) =>
        SubscriptionRef.changes(supervisor.session).pipe(
          Stream.switchMap(
            Option.match({
              onNone: () => Stream.empty,
              onSome: (session) => pollSession(session, input),
            }),
          ),
        ),
      ),
    ),
  );
}

/** One plain sentence for every state that has no table. */
export function describeTaskUsageReportState(
  state: Exclude<TaskUsageReportState, { readonly status: "complete" }> | null,
): string {
  if (state === null || state.status === "pending") return "Waiting for the task usage report…";
  if (state.status === "error") return "The task usage report couldn't be loaded.";
  switch (state.reason) {
    case "not-found":
      return "This server has no usage report for the task.";
    case "not-bound":
      return "The usage report isn't shown because this reply isn't the task's final message.";
    case "aborted":
      return "The task's closing turn didn't complete, so no usage report was written.";
    case "finalizer-stopped":
      return "The usage report wasn't finalized. Run the task's finalize command to finish it.";
    case "legacy":
      return "This task's usage report was written before chat tables existed.";
    case "invalid":
      return "The task usage report failed validation and isn't shown.";
    case "unsupported-server":
      return "Update this server to see the task usage report.";
  }
}

export interface TaskUsageCellSpan {
  readonly text: string;
  readonly bold: boolean;
}

/** The helper marks labels with `**bold**`; every other character is literal. */
export function splitTaskUsageCell(cell: string): ReadonlyArray<TaskUsageCellSpan> {
  const spans: TaskUsageCellSpan[] = [];
  let cursor = 0;
  for (const match of cell.matchAll(/\*\*(.+?)\*\*/g)) {
    if (match.index > cursor) spans.push({ text: cell.slice(cursor, match.index), bold: false });
    spans.push({ text: match[1]!, bold: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < cell.length) spans.push({ text: cell.slice(cursor), bold: false });
  return spans;
}
