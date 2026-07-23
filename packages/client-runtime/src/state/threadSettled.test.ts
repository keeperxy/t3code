import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentThreadShell } from "./models.ts";
import { v2ThreadShell } from "./orchestrationV2TestFixtures.ts";
import {
  canSettle,
  effectiveSettled,
  threadLastActivityAt,
  type ChangeRequestStateLike,
} from "./threadSettled.ts";

const NOW = "2026-04-10T00:00:00.000Z";
const FRESH = "2026-04-09T00:00:00.000Z";
const STALE = "2026-04-06T23:59:59.999Z";

function makeShell(input: {
  readonly settledOverride?: "settled" | "active" | null;
  readonly activityAt: string | null;
  readonly runtimeStatus?: "preparing" | "queued" | "starting" | "running" | "waiting";
  readonly pending?: "approval" | "user-input";
}): EnvironmentThreadShell {
  const threadId = ThreadId.make("thread-1");
  const providerInstanceId = ProviderInstanceId.make("codex");
  return {
    environmentId: EnvironmentId.make("environment-1"),
    id: threadId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    activeProviderThreadId: null,
    latestRun:
      input.activityAt === null
        ? null
        : {
            runId: RunId.make("run-1"),
            status: "completed",
            requestedAt: input.activityAt,
            startedAt: null,
            completedAt: null,
            assistantMessageId: null,
          },
    runtime:
      input.runtimeStatus === undefined
        ? null
        : {
            status: input.runtimeStatus,
            activeRunId: RunId.make("run-active"),
            providerInstanceId,
            providerName: "Codex",
            lastError: null,
            updatedAt: NOW,
          },
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: input.settledOverride ?? null,
    settledAt: input.settledOverride === "settled" ? NOW : null,
    deletedAt: null,
    latestUserMessageAt: null,
    hasPendingApprovals: input.pending === "approval",
    hasPendingUserInput: input.pending === "user-input",
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    source: {
      ...v2ThreadShell,
      id: threadId,
      projectId: ProjectId.make("project-1"),
      providerInstanceId,
      modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
      settledOverride: input.settledOverride ?? null,
      settledAt: null,
    },
  };
}

describe("threadLastActivityAt", () => {
  it("returns the latest real user or turn activity and ignores thread/session updates", () => {
    const shell = makeShell({ activityAt: null, runtimeStatus: "running" });
    const withActivity: EnvironmentThreadShell = {
      ...shell,
      latestUserMessageAt: "2026-04-04T00:00:00.000Z",
      latestRun: {
        runId: RunId.make("run-1"),
        status: "completed",
        requestedAt: "2026-04-03T00:00:00.000Z",
        startedAt: "2026-04-05T00:00:00.000Z",
        completedAt: "2026-04-06T00:00:00.000Z",
        assistantMessageId: null,
      },
    };

    expect(threadLastActivityAt(withActivity)).toBe("2026-04-06T00:00:00.000Z");
    expect(threadLastActivityAt(shell)).toBeNull();
  });
});

describe("effectiveSettled", () => {
  const overrideCases = [null, "settled", "active"] as const;
  const changeRequestStates = [undefined, "open", "merged"] as const;
  const inactivityCases = [
    ["fresh", FRESH],
    ["stale", STALE],
    ["no-activity", null],
  ] as const;
  const runningCases = [false, true] as const;
  const pendingCases = [undefined, "approval", "user-input"] as const;
  const truthTable = overrideCases.flatMap((settledOverride) =>
    changeRequestStates.flatMap((changeRequestState) =>
      inactivityCases.flatMap(([inactivity, activityAt]) =>
        runningCases.flatMap((running) =>
          pendingCases.map((pending) => ({
            settledOverride,
            changeRequestState,
            inactivity,
            activityAt,
            running,
            pending,
            // Settled iff nothing blocks (pending work / live session) AND
            // the override says settled, or (with no override) a merged PR
            // or staleness auto-settles. The "active" pin suppresses both
            // auto signals.
            expected:
              pending === undefined &&
              !running &&
              (settledOverride === "settled" ||
                (settledOverride === null &&
                  (changeRequestState === "merged" || inactivity === "stale"))),
          })),
        ),
      ),
    ),
  );

  it.each(truthTable)(
    "override=$settledOverride pr=$changeRequestState inactivity=$inactivity running=$running pending=$pending",
    ({ settledOverride, changeRequestState, activityAt, running, pending, expected }) => {
      const shell = makeShell({
        settledOverride,
        activityAt,
        ...(running ? { runtimeStatus: "running" as const } : {}),
        ...(pending === undefined ? {} : { pending }),
      });
      const changeRequestOptions =
        changeRequestState === undefined
          ? {}
          : { changeRequestState: changeRequestState as ChangeRequestStateLike };

      expect(
        effectiveSettled(shell, {
          now: NOW,
          autoSettleAfterDays: 3,
          ...changeRequestOptions,
        }),
      ).toBe(expected);
    },
  );

  it("treats closed change requests like merged ones", () => {
    const shell = makeShell({ activityAt: null });
    expect(
      effectiveSettled(shell, {
        now: NOW,
        autoSettleAfterDays: null,
        changeRequestState: "closed",
      }),
    ).toBe(true);
  });

  it("never settles a starting session, even with a settled override", () => {
    const shell = makeShell({
      settledOverride: "settled",
      activityAt: STALE,
      runtimeStatus: "starting",
    });
    expect(
      effectiveSettled(shell, {
        now: NOW,
        autoSettleAfterDays: 3,
        changeRequestState: "merged",
      }),
    ).toBe(false);
  });

  it("keeps V2 work active from preparation through waiting", () => {
    for (const runtimeStatus of [
      "preparing",
      "queued",
      "starting",
      "running",
      "waiting",
    ] as const) {
      const shell = makeShell({ settledOverride: "settled", activityAt: STALE, runtimeStatus });
      expect(
        effectiveSettled(shell, {
          now: NOW,
          autoSettleAfterDays: 3,
          changeRequestState: "merged",
        }),
      ).toBe(false);
    }
  });

  it("uses a strict inactivity boundary and honors a null threshold", () => {
    const boundary = makeShell({
      activityAt: "2026-04-07T00:00:00.000Z",
    });
    const stale = makeShell({ activityAt: STALE });

    expect(effectiveSettled(boundary, { now: NOW, autoSettleAfterDays: 3 })).toBe(false);
    expect(effectiveSettled(stale, { now: NOW, autoSettleAfterDays: null })).toBe(false);
  });
});

describe("canSettle", () => {
  it("blocks every state effectiveSettled refuses to classify as settled", () => {
    expect(canSettle(makeShell({ activityAt: FRESH }), { now: NOW })).toBe(true);
    expect(
      canSettle(makeShell({ activityAt: FRESH, runtimeStatus: "starting" }), { now: NOW }),
    ).toBe(false);
    expect(
      canSettle(makeShell({ activityAt: FRESH, runtimeStatus: "running" }), { now: NOW }),
    ).toBe(false);
    expect(canSettle(makeShell({ activityAt: FRESH, pending: "approval" }), { now: NOW })).toBe(
      false,
    );
    expect(canSettle(makeShell({ activityAt: FRESH, pending: "user-input" }), { now: NOW })).toBe(
      false,
    );
  });

  it("agrees with effectiveSettled's blockers for explicitly settled shells", () => {
    // Anything canSettle rejects must render as active even when the user
    // settled it earlier.
    const blocked = makeShell({
      settledOverride: "settled",
      activityAt: FRESH,
      pending: "user-input",
    });
    expect(canSettle(blocked, { now: NOW })).toBe(false);
    expect(effectiveSettled(blocked, { now: NOW, autoSettleAfterDays: 3 })).toBe(false);
  });
});
