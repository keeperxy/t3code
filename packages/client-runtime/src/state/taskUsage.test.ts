import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  MessageId,
  ThreadId,
  WS_METHODS,
  type ServerConfig,
  type TaskUsageReadReportResult,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { RpcClientError } from "effect/unstable/rpc";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  describeTaskUsageReportState,
  selectTaskUsageReports,
  splitTaskUsageCell,
  watchTaskUsageReport,
  type TaskUsageCandidateMessage,
  type TaskUsageReportState,
} from "./taskUsage.ts";

const taskId = "20260930-orchestrator-totals-2qftombj";
const fenceFor = (turnId: string, id = taskId) =>
  `\`\`\`t3-task-usage\n{"version":1,"taskId":"${id}","closingTurnId":"${turnId}"}\n\`\`\``;

const fence = fenceFor("turn-a");

function message(
  id: string,
  overrides: Partial<TaskUsageCandidateMessage> = {},
): TaskUsageCandidateMessage {
  return {
    id,
    role: "assistant",
    text: `Finished.\n\n${fenceFor(`turn-${id}`)}`,
    turnId: `turn-${id}`,
    streaming: false,
    ...overrides,
  };
}

describe("selectTaskUsageReports", () => {
  const select = (
    messages: TaskUsageCandidateMessage[],
    options: { terminal?: string[]; unsettledTurnId?: string | null } = {},
  ) => [
    ...selectTaskUsageReports({
      messages,
      terminalAssistantMessageIds: new Set(options.terminal ?? messages.map(({ id }) => id)),
      unsettledTurnIds: new Set(options.unsettledTurnId ? [options.unsettledTurnId] : []),
    }).keys(),
  ];

  it("renders each task once, in the earliest final reply that references it", () => {
    const other = fenceFor("turn-c", "another-task");
    expect(
      select([
        message("a"),
        message("b", { text: fenceFor("turn-a") }),
        message("c", { text: `Again.\n\n${other}` }),
      ]),
    ).toEqual(["a", "c"]);
  });

  it("ignores replies that are not final, settled assistant messages", () => {
    expect(select([message("a", { role: "user" })])).toEqual([]);
    expect(select([message("a", { role: "reasoning" })])).toEqual([]);
    expect(select([message("a", { streaming: true })])).toEqual([]);
    expect(select([message("a", { turnId: null })])).toEqual([]);
    expect(select([message("a")], { terminal: [] })).toEqual([]);
    expect(select([message("a")], { unsettledTurnId: "turn-a" })).toEqual([]);
    // An ineligible earlier copy does not claim the task.
    expect(select([message("a", { streaming: true }), message("b")])).toEqual(["b"]);
  });

  it("rejects an earlier copied carrier before claiming the task", () => {
    expect(select([message("a", { text: fenceFor("turn-b") }), message("b")])).toEqual(["b"]);
    const selected = selectTaskUsageReports({
      messages: [message("a"), message("b")],
      terminalAssistantMessageIds: new Set(["a", "b"]),
      unsettledTurnIds: new Set(),
      failedTurnIds: new Set(["turn-a"]),
    });
    expect([...selected.keys()]).toEqual(["b"]);
    expect(
      select([message("a"), message("copy", { turnId: "turn-a", text: fence })], {
        terminal: ["copy"],
      }),
    ).toEqual(["copy"]);
  });

  it("leaves quoted and unclosed references as ordinary code", () => {
    expect(select([message("a", { text: fence.replace(/^/gm, "> ") })])).toEqual([]);
    expect(select([message("a", { text: fence.slice(0, -3) })])).toEqual([]);
  });
});

describe("task usage presentation", () => {
  it("renders only the helper's bold markers", () => {
    expect(splitTaskUsageCell("**task total** (orchestrator + 4 invocations)")).toEqual([
      { text: "task total", bold: true },
      { text: " (orchestrator + 4 invocations)", bold: false },
    ]);
    expect(splitTaskUsageCell("≥ 1,024 (incomplete) *not bold*")).toEqual([
      { text: "≥ 1,024 (incomplete) *not bold*", bold: false },
    ]);
  });

  it("explains every state without a table", () => {
    expect(describeTaskUsageReportState(null)).toBe("Waiting for the task usage report…");
    expect(describeTaskUsageReportState({ status: "error" })).toBe(
      "The task usage report couldn't be loaded.",
    );
    expect(
      describeTaskUsageReportState({ status: "unavailable", reason: "unsupported-server" }),
    ).toBe("Update this server to see the task usage report.");
  });
});

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("task-usage-environment"),
  label: "Task usage environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const INPUT = {
  threadId: ThreadId.make("thread-1"),
  messageId: MessageId.make("message-1"),
  taskId,
};
const COMPLETE: TaskUsageReadReportResult = {
  status: "complete",
  report: {
    rows: [
      { invocation: "Orchestrator", modelReasoning: "m", totalTokens: "1", elapsed: "1.0s" },
      { invocation: "**task total**", modelReasoning: "", totalTokens: "1", elapsed: "1.0s" },
    ],
    notes: [],
  },
};

function configFor(taskUsageReports: boolean): ServerConfig {
  return {
    settings: DEFAULT_SERVER_SETTINGS,
    environment: { serverVersion: "0.0.1", capabilities: {} },
    ...(taskUsageReports ? { taskUsageReports: true } : {}),
  } as ServerConfig;
}

const makeHarness = Effect.fn("TaskUsageTest.makeHarness")(function* (
  answers: ReadonlyArray<Effect.Effect<TaskUsageReadReportResult, RpcClientError.RpcClientError>>,
  options: { readonly supported?: boolean; readonly mounted?: boolean } = {},
) {
  let reads = 0;
  const client = {
    [WS_METHODS.taskUsageReadReport]: () =>
      Effect.suspend(() => answers[Math.min(reads++, answers.length - 1)]!),
  } as unknown as WsRpcProtocolClient;
  const makeSession = (): RpcSession => ({
    client,
    initialConfig: Effect.succeed(configFor(options.supported ?? true)),
    subscribeServerConfig: () => Stream.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  });
  const activeSession = yield* SubscriptionRef.make(Option.some(makeSession()));
  const supervisor = EnvironmentSupervisor.of({
    target: TARGET,
    state: yield* SubscriptionRef.make<SupervisorConnectionState>({
      ...AVAILABLE_CONNECTION_STATE,
      phase: "connected",
    }),
    session: activeSession,
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
  const states = yield* Queue.unbounded<TaskUsageReportState>();
  const stream = watchTaskUsageReport(INPUT).pipe(
    Stream.tap((state) => Queue.offer(states, state)),
    Stream.provideService(EnvironmentSupervisor, supervisor),
    Stream.provideService(Clock.Clock, yield* Clock.Clock),
  );
  let stop: Effect.Effect<unknown>;
  if (options.mounted) {
    const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
      Effect.sync(() => registry.dispose()),
    );
    const atom = Atom.make(stream).pipe(Atom.setIdleTTL(0));
    const unmount = registry.mount(atom);
    stop = Effect.sync(unmount);
  } else {
    const watcher = yield* stream.pipe(Stream.runDrain, Effect.forkChild);
    stop = Fiber.interrupt(watcher);
  }
  return {
    reads: () => reads,
    next: Queue.take(states),
    reconnect: SubscriptionRef.set(activeSession, Option.none()).pipe(
      Effect.andThen(SubscriptionRef.set(activeSession, Option.some(makeSession()))),
    ),
    stop,
  };
});

describe("watchTaskUsageReport", () => {
  it.effect("polls with fresh reads while pending and stops once complete", () =>
    Effect.gen(function* () {
      const pending = Effect.succeed<TaskUsageReadReportResult>({ status: "pending" });
      const harness = yield* makeHarness([pending, pending, Effect.succeed(COMPLETE)]);

      expect(yield* harness.next).toEqual({ status: "pending" });
      yield* TestClock.adjust(2_999);
      expect(harness.reads()).toBe(1);
      yield* TestClock.adjust(1);
      expect(yield* harness.next).toEqual({ status: "pending" });
      yield* TestClock.adjust(6_000);
      expect(yield* harness.next).toEqual(COMPLETE);

      yield* TestClock.adjust(10 * 60_000);
      expect(harness.reads()).toBe(3);
      yield* harness.stop;
    }),
  );

  it.effect("cancels pending reads when the subscriber stops", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([Effect.succeed({ status: "pending" })], {
        mounted: true,
      });
      expect(yield* harness.next).toEqual({ status: "pending" });
      yield* harness.stop;
      yield* TestClock.adjust(10 * 60_000);
      expect(harness.reads()).toBe(1);
    }),
  );

  it.effect("stops after an unavailable result", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([
        Effect.succeed({ status: "unavailable", reason: "invalid" }),
      ]);
      expect(yield* harness.next).toEqual({ status: "unavailable", reason: "invalid" });
      yield* TestClock.adjust(10 * 60_000);
      expect(harness.reads()).toBe(1);
      yield* harness.stop;
    }),
  );

  it.effect("reads a retained report again after reconnecting", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([Effect.succeed(COMPLETE)]);
      expect(yield* harness.next).toEqual(COMPLETE);
      yield* harness.reconnect;
      expect(yield* harness.next).toEqual(COMPLETE);
      expect(harness.reads()).toBe(2);
      yield* harness.stop;
    }),
  );

  it.effect("never sends the method to a server without the capability", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([Effect.succeed(COMPLETE)], { supported: false });
      expect(yield* harness.next).toEqual({ status: "unavailable", reason: "unsupported-server" });
      yield* TestClock.adjust(10 * 60_000);
      expect(harness.reads()).toBe(0);
      yield* harness.stop;
    }),
  );

  it.effect("shows a failed read once instead of retrying it", () =>
    Effect.gen(function* () {
      const failure = Effect.fail(
        new RpcClientError.RpcClientError({
          reason: new RpcClientError.RpcClientDefect({ message: "boom", cause: null }),
        }),
      );
      const harness = yield* makeHarness([failure]);
      expect(yield* harness.next).toEqual({ status: "error" });
      yield* TestClock.adjust(10 * 60_000);
      expect(harness.reads()).toBe(1);
      yield* harness.stop;
    }),
  );
});
