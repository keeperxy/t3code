import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  type ModelSelection,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ThreadGoal,
  type OrchestrationV2ThreadProjection,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import { CommandReceiptStoreV2, type CommandReceiptV2 } from "./CommandReceiptStore.ts";
import { EventSinkV2 } from "./EventSink.ts";
import * as IdAllocator from "./IdAllocator.ts";
import {
  ProviderAdapterEnsureThreadError,
  type ProviderAdapterV2SessionRuntime,
  type ProviderAdapterV2Shape,
} from "./ProviderAdapter.ts";
import { ProviderAdapterRegistryV2 } from "./ProviderAdapterRegistry.ts";
import { ProviderSessionManagerV2 } from "./ProviderSessionManager.ts";
import {
  applyToProjection,
  ProjectionStoreV2,
  type ProjectionStoreV2Shape,
} from "./ProjectionStore.ts";
import * as RuntimePolicy from "./RuntimePolicy.ts";
import {
  layer as threadGoalServiceLayer,
  ThreadGoalService,
  ThreadGoalServiceError,
} from "./ThreadGoalService.ts";

const driver = ProviderDriverKind.make("codex");
const providerInstanceId = ProviderInstanceId.make("codex");
const alternateProviderInstanceId = ProviderInstanceId.make("codex-alternate");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.4",
} satisfies ModelSelection;
const isThreadGoalServiceError = Schema.is(ThreadGoalServiceError);

function emptyProjection(
  threadId: ThreadId,
  now: DateTime.Utc,
  goal: OrchestrationV2ThreadGoal | null = null,
): OrchestrationV2ThreadProjection {
  return {
    thread: {
      createdBy: "user",
      creationSource: "web",
      id: threadId,
      projectId: ProjectId.make("project:thread-goal"),
      title: "Thread goal",
      providerInstanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: "/workspace",
      activeProviderThreadId: goal?.providerThreadId ?? null,
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: threadId,
      },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      deletedAt: null,
    },
    goal,
    goalRevision:
      goal === null ? null : { providerThreadId: goal.providerThreadId, updatedAt: goal.updatedAt },
    runs: [],
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [],
    plans: [],
    turnItems: [],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    updatedAt: now,
  };
}

interface HarnessOptions {
  readonly nativeGoals?: boolean;
  readonly failGoalOperation?: boolean;
  readonly driftProviderDuringSet?: boolean;
  readonly initialProjection?: OrchestrationV2ThreadProjection;
}

const makeHarness = Effect.fn("ThreadGoalService.test.makeHarness")(function* (
  options: HarnessOptions = {},
) {
  const now = yield* DateTime.now;
  const threadId = options.initialProjection?.thread.id ?? ThreadId.make("thread:goal-service");
  const providerSessionId = ProviderSessionId.make("provider-session:goal-service");
  const providerThreadId = ProviderThreadId.make("provider-thread:goal-service");
  const projection = yield* Ref.make(options.initialProjection ?? emptyProjection(threadId, now));
  const receipts = yield* Ref.make(new Map<CommandId, CommandReceiptV2>());
  const sequence = yield* Ref.make(0);
  const nativeGoal = yield* Ref.make<OrchestrationV2ThreadGoal | null>(
    options.initialProjection?.goal ?? null,
  );
  const ensureCount = yield* Ref.make(0);
  const resumeCount = yield* Ref.make(0);
  const getCount = yield* Ref.make(0);
  const setCount = yield* Ref.make(0);
  const clearCount = yield* Ref.make(0);

  const makeProviderThread = (updatedAt: DateTime.Utc): OrchestrationV2ProviderThread => ({
    id: providerThreadId,
    driver,
    providerInstanceId,
    providerSessionId,
    appThreadId: threadId,
    ownerNodeId: null,
    nativeThreadRef: {
      driver,
      nativeId: "native-thread:goal-service",
      strength: "strong",
    },
    nativeConversationHeadRef: null,
    status: "active",
    firstRunOrdinal: null,
    lastRunOrdinal: null,
    handoffIds: [],
    forkedFrom: null,
    createdAt: updatedAt,
    updatedAt,
  });
  const providerSession = {
    id: providerSessionId,
    driver,
    providerInstanceId,
    status: "running" as const,
    cwd: "/workspace",
    model: modelSelection.model,
    capabilities: CodexProviderCapabilitiesV2,
    createdAt: now,
    updatedAt: now,
    lastError: null,
  };
  const operationFailure = () =>
    new ProviderAdapterEnsureThreadError({
      driver,
      threadId,
      cause: "native goal failure",
    });
  const runtimeBase: ProviderAdapterV2SessionRuntime = {
    instanceId: providerInstanceId,
    driver,
    providerSessionId,
    providerSession,
    events: Stream.empty,
    ensureThread: () =>
      Effect.gen(function* () {
        yield* Ref.update(ensureCount, (count) => count + 1);
        return makeProviderThread(yield* DateTime.now);
      }),
    resumeThread: ({ providerThread }) =>
      Ref.update(resumeCount, (count) => count + 1).pipe(Effect.as(providerThread)),
    startTurn: () => Effect.die("ThreadGoalService must not start a turn."),
    steerTurn: () => Effect.die("ThreadGoalService must not steer a turn."),
    interruptTurn: () => Effect.die("ThreadGoalService must not interrupt a turn."),
    respondToRuntimeRequest: () => Effect.die("unused respondToRuntimeRequest"),
    readThreadSnapshot: () => Effect.die("unused readThreadSnapshot"),
    rollbackThread: () => Effect.die("unused rollbackThread"),
    forkThread: () => Effect.die("unused forkThread"),
    ...(options.nativeGoals === false
      ? {}
      : {
          getThreadGoal: () =>
            options.failGoalOperation === true
              ? Effect.fail(operationFailure())
              : Ref.updateAndGet(getCount, (count) => count + 1).pipe(
                  Effect.andThen(Ref.get(nativeGoal)),
                ),
          setThreadGoal: (input) =>
            options.failGoalOperation === true
              ? Effect.fail(operationFailure())
              : Effect.gen(function* () {
                  yield* Ref.update(setCount, (count) => count + 1);
                  const existing = yield* Ref.get(nativeGoal);
                  if (existing === null && input.objective === undefined) {
                    return yield* operationFailure();
                  }
                  const updatedAt = yield* DateTime.now;
                  const updated: OrchestrationV2ThreadGoal = {
                    threadId,
                    providerThreadId,
                    objective: input.objective ?? existing!.objective,
                    status: input.status ?? existing?.status ?? "active",
                    tokenBudget:
                      input.tokenBudget === undefined
                        ? (existing?.tokenBudget ?? null)
                        : input.tokenBudget,
                    tokensUsed: existing?.tokensUsed ?? 0,
                    timeUsedSeconds: existing?.timeUsedSeconds ?? 0,
                    createdAt: existing?.createdAt ?? updatedAt,
                    updatedAt,
                  };
                  yield* Ref.set(nativeGoal, updated);
                  if (options.driftProviderDuringSet === true) {
                    yield* Ref.update(projection, (current) => ({
                      ...current,
                      thread: {
                        ...current.thread,
                        providerInstanceId: alternateProviderInstanceId,
                        modelSelection: {
                          ...current.thread.modelSelection,
                          instanceId: alternateProviderInstanceId,
                        },
                      },
                    }));
                  }
                  return updated;
                }),
          clearThreadGoal: () =>
            options.failGoalOperation === true
              ? Effect.fail(operationFailure())
              : Ref.update(clearCount, (count) => count + 1).pipe(
                  Effect.andThen(Ref.set(nativeGoal, null)),
                  Effect.as(true),
                ),
        }),
  };

  const receiptLayer = Layer.succeed(
    CommandReceiptStoreV2,
    CommandReceiptStoreV2.of({
      insertIfAbsent: (receipt) =>
        Ref.modify(receipts, (current) => {
          if (current.has(receipt.commandId)) return [false, current] as const;
          const next = new Map(current);
          next.set(receipt.commandId, receipt);
          return [true, next] as const;
        }),
      upsert: (receipt) =>
        Ref.update(receipts, (current) => {
          const next = new Map(current);
          next.set(receipt.commandId, receipt);
          return next;
        }),
      getByCommandId: (commandId) =>
        Ref.get(receipts).pipe(
          Effect.map((current) => Option.fromNullishOr(current.get(commandId))),
        ),
    }),
  );
  const projectionLayer = Layer.succeed(
    ProjectionStoreV2,
    ProjectionStoreV2.of({
      apply: (event) => Ref.update(projection, (current) => applyToProjection(current, event)),
      getShellSnapshot: () => Effect.die("unused getShellSnapshot"),
      getThreadProjection: () => Ref.get(projection),
      getThreadSnapshot: () => Effect.die("unused getThreadSnapshot"),
    } satisfies ProjectionStoreV2Shape),
  );
  const eventSinkLayer = Layer.succeed(
    EventSinkV2,
    EventSinkV2.of({
      write: () => Effect.die("ThreadGoalService must commit commands."),
      writeWithEffects: () => Effect.die("ThreadGoalService must commit commands."),
      writeIfRunCurrent: () => Effect.die("ThreadGoalService must not write run events."),
      commitCommand: (input) =>
        Effect.gen(function* () {
          const existing = yield* Ref.get(receipts).pipe(
            Effect.map((current) => current.get(input.commandId)),
          );
          if (existing !== undefined) {
            return {
              receipt: existing,
              storedEvents: [],
              committed: false as const,
              cancelledEffectCount: 0,
            };
          }
          yield* Effect.forEach(input.events, (event) =>
            Ref.update(projection, (current) => applyToProjection(current, event)),
          );
          const resultSequence = yield* Ref.updateAndGet(
            sequence,
            (current) => current + input.events.length,
          );
          const receipt: CommandReceiptV2 = {
            commandId: input.commandId,
            threadId: input.threadId,
            commandType: input.commandType,
            acceptedAt: input.acceptedAt,
            resultSequence,
            status: "accepted",
            error: null,
          };
          yield* Ref.update(receipts, (current) => {
            const next = new Map(current);
            next.set(receipt.commandId, receipt);
            return next;
          });
          return {
            receipt,
            storedEvents: input.events.map((event, index) => ({
              sequence: resultSequence - input.events.length + index + 1,
              commandId: input.commandId,
              event,
              recordedAt: input.acceptedAt,
            })),
            committed: true as const,
            cancelledEffectCount: 0,
          };
        }),
      commitRejectedCommand: (input) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(receipts);
          const existing = current.get(input.commandId);
          if (existing !== undefined) return existing;
          const resultSequence = yield* Ref.get(sequence);
          const receipt: CommandReceiptV2 = {
            commandId: input.commandId,
            threadId: input.threadId,
            commandType: input.commandType,
            acceptedAt: input.rejectedAt,
            resultSequence,
            status: "rejected",
            error: input.error,
          };
          yield* Ref.update(receipts, (entries) => {
            const next = new Map(entries);
            next.set(receipt.commandId, receipt);
            return next;
          });
          return receipt;
        }),
      stream: () => Stream.empty,
      latestSequence: () => Ref.get(sequence),
      readByCommandId: () => Stream.empty,
    }),
  );
  const adapter: ProviderAdapterV2Shape = {
    instanceId: providerInstanceId,
    driver,
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.die("unused planSelectionTransition"),
    openSession: () => Effect.die("ThreadGoalService uses ProviderSessionManagerV2."),
  };
  const adapterLayer = Layer.succeed(
    ProviderAdapterRegistryV2,
    ProviderAdapterRegistryV2.of({
      get: () => Effect.succeed(adapter),
      list: () => Effect.succeed([providerInstanceId]),
    }),
  );
  const sessionLayer = Layer.succeed(
    ProviderSessionManagerV2,
    ProviderSessionManagerV2.of({
      shutdown: Effect.void,
      open: () => Effect.succeed(runtimeBase),
      get: () => Effect.succeed(Option.some(runtimeBase)),
      close: () => Effect.void,
      release: () => Effect.void,
      detach: () => Effect.void,
    }),
  );
  const serviceLayer = threadGoalServiceLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        receiptLayer,
        eventSinkLayer,
        IdAllocator.layer,
        projectionLayer,
        adapterLayer,
        sessionLayer,
        RuntimePolicy.layer,
      ),
    ),
  );
  return {
    threadId,
    providerThreadId,
    projection,
    receipts,
    nativeGoal,
    ensureCount,
    resumeCount,
    getCount,
    setCount,
    clearCount,
    serviceLayer,
  };
});

describe("ThreadGoalService", () => {
  it.effect(
    "manages native goals without creating a run or message and reuses materialized threads",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const result = yield* Effect.gen(function* () {
          const service = yield* ThreadGoalService;
          const created = yield* service.execute({
            type: "set",
            commandId: CommandId.make("command:goal:set"),
            threadId: harness.threadId,
            objective: "Ship the nightly integration",
            tokenBudget: 10_000,
          });
          const sameDesiredState = yield* service.execute({
            type: "set",
            commandId: CommandId.make("command:goal:set-idempotent"),
            threadId: harness.threadId,
            objective: "Ship the nightly integration",
            tokenBudget: 10_000,
          });
          const paused = yield* service.execute({
            type: "set",
            commandId: CommandId.make("command:goal:pause"),
            threadId: harness.threadId,
            status: "paused",
          });
          const resumed = yield* service.execute({
            type: "set",
            commandId: CommandId.make("command:goal:resume"),
            threadId: harness.threadId,
            status: "active",
          });
          const refreshed = yield* service.execute({
            type: "refresh",
            commandId: CommandId.make("command:goal:refresh"),
            threadId: harness.threadId,
          });
          const cleared = yield* service.execute({
            type: "clear",
            commandId: CommandId.make("command:goal:clear"),
            threadId: harness.threadId,
          });
          const clearAgain = yield* service.execute({
            type: "clear",
            commandId: CommandId.make("command:goal:clear-idempotent"),
            threadId: harness.threadId,
          });
          const replayed = yield* service.execute({
            type: "clear",
            commandId: CommandId.make("command:goal:clear-idempotent"),
            threadId: harness.threadId,
          });
          return {
            created,
            sameDesiredState,
            paused,
            resumed,
            refreshed,
            cleared,
            clearAgain,
            replayed,
          };
        }).pipe(Effect.provide(harness.serviceLayer));

        assert.equal(result.created.goal?.objective, "Ship the nightly integration");
        assert.equal(result.sameDesiredState.goal?.objective, "Ship the nightly integration");
        assert.equal(result.paused.goal?.status, "paused");
        assert.equal(result.resumed.goal?.status, "active");
        assert.equal(result.refreshed.goal?.status, "active");
        assert.isNull(result.cleared.goal);
        assert.isNull(result.clearAgain.goal);
        assert.deepEqual(result.replayed, result.clearAgain);
        const projection = yield* Ref.get(harness.projection);
        assert.equal(projection.thread.activeProviderThreadId, harness.providerThreadId);
        assert.lengthOf(projection.providerThreads, 1);
        assert.lengthOf(projection.runs, 0);
        assert.lengthOf(projection.messages, 0);
        assert.equal(yield* Ref.get(harness.ensureCount), 1);
        assert.equal(yield* Ref.get(harness.resumeCount), 6);
        assert.equal(yield* Ref.get(harness.setCount), 3);
        assert.equal(yield* Ref.get(harness.getCount), 1);
        assert.equal(yield* Ref.get(harness.clearCount), 1);
      }),
  );

  it.effect("rejects an empty set before opening or materializing provider state", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const failure = yield* Effect.gen(function* () {
        const service = yield* ThreadGoalService;
        return yield* Effect.flip(
          service.execute({
            type: "set",
            commandId: CommandId.make("command:goal:empty-set"),
            threadId: harness.threadId,
          }),
        );
      }).pipe(Effect.provide(harness.serviceLayer));
      assert.equal(failure.operation, "validate-thread");
      assert.equal(yield* Ref.get(harness.ensureCount), 0);
      const receipt = (yield* Ref.get(harness.receipts)).get(
        CommandId.make("command:goal:empty-set"),
      );
      assert.equal(receipt?.status, "rejected");
      assert.match(receipt?.error ?? "", /objective, status, or token budget/u);
    }),
  );

  it.effect("rejects providers without native goal operations and persists the rejection", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ nativeGoals: false });
      const failure = yield* Effect.gen(function* () {
        const service = yield* ThreadGoalService;
        return yield* Effect.flip(
          service.execute({
            type: "refresh",
            commandId: CommandId.make("command:goal:unsupported"),
            threadId: harness.threadId,
          }),
        );
      }).pipe(Effect.provide(harness.serviceLayer));
      assert.equal(failure.operation, "resolve-provider");
      const receipt = (yield* Ref.get(harness.receipts)).get(
        CommandId.make("command:goal:unsupported"),
      );
      assert.equal(receipt?.status, "rejected");
      assert.match(receipt?.error ?? "", /does not implement native thread goals/u);
      assert.equal(yield* Ref.get(harness.ensureCount), 0);
    }),
  );

  it.effect(
    "persists provider failures as rejected receipts before a retry can repeat side effects",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({ failGoalOperation: true });
        const command = {
          type: "set" as const,
          commandId: CommandId.make("command:goal:provider-failure"),
          threadId: harness.threadId,
          objective: "Will fail",
        };
        const failures = yield* Effect.gen(function* () {
          const service = yield* ThreadGoalService;
          return yield* Effect.all([
            Effect.flip(service.execute(command)),
            Effect.flip(service.execute(command)),
          ]);
        }).pipe(Effect.provide(harness.serviceLayer));
        assert.deepEqual(
          failures.map((failure) => failure.operation),
          ["invoke-provider-goal", "read-receipt"],
        );
        assert.equal((yield* Ref.get(harness.receipts)).get(command.commandId)?.status, "rejected");
        assert.equal(yield* Ref.get(harness.ensureCount), 1);
      }),
  );

  it.effect(
    "rejects a command when the selected provider changes during its native operation",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({ driftProviderDuringSet: true });
        const commandId = CommandId.make("command:goal:provider-drift");
        const failure = yield* Effect.gen(function* () {
          const service = yield* ThreadGoalService;
          return yield* Effect.flip(
            service.execute({
              type: "set",
              commandId,
              threadId: harness.threadId,
              objective: "Drift",
            }),
          );
        }).pipe(Effect.provide(harness.serviceLayer));
        assert.isTrue(isThreadGoalServiceError(failure));
        assert.equal(failure.operation, "verify-provider");
        assert.equal((yield* Ref.get(harness.receipts)).get(commandId)?.status, "rejected");
        assert.lengthOf((yield* Ref.get(harness.projection)).runs, 0);
      }),
  );

  it.effect("clears a goal whose provider revision is ahead of the service clock", () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:goal-future-revision");
      const providerThreadId = ProviderThreadId.make("provider-thread:goal-service");
      const future = DateTime.add(now, { minutes: 1 });
      const goal: OrchestrationV2ThreadGoal = {
        threadId,
        providerThreadId,
        objective: "Future revision",
        status: "active",
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: future,
        updatedAt: future,
      };
      const initial: OrchestrationV2ThreadProjection = {
        ...emptyProjection(threadId, now, goal),
        providerThreads: [
          {
            id: providerThreadId,
            driver,
            providerInstanceId,
            providerSessionId: ProviderSessionId.make("provider-session:goal-service"),
            appThreadId: threadId,
            ownerNodeId: null,
            nativeThreadRef: {
              driver,
              nativeId: "native-thread:goal-service",
              strength: "strong",
            },
            nativeConversationHeadRef: null,
            status: "active",
            firstRunOrdinal: null,
            lastRunOrdinal: null,
            handoffIds: [],
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      };
      const harness = yield* makeHarness({ initialProjection: initial });
      const result = yield* Effect.gen(function* () {
        const service = yield* ThreadGoalService;
        return yield* service.execute({
          type: "clear",
          commandId: CommandId.make("command:goal:future-clear"),
          threadId,
        });
      }).pipe(Effect.provide(harness.serviceLayer));
      assert.isNull(result.goal);
      const projection = yield* Ref.get(harness.projection);
      assert.isNull(projection.goal);
      assert.equal(
        DateTime.toEpochMillis(projection.goalRevision!.updatedAt),
        DateTime.toEpochMillis(future),
      );
    }),
  );
});
