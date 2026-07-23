import {
  CommandId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ThreadGoal,
  type OrchestrationV2ThreadGoalCommand,
  type OrchestrationV2ThreadGoalCommandResult,
  type OrchestrationV2ThreadProjection,
  type ProviderInstanceId,
  type ProviderSessionId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { CommandReceiptStoreV2 } from "./CommandReceiptStore.ts";
import { EventSinkV2 } from "./EventSink.ts";
import { IdAllocatorV2 } from "./IdAllocator.ts";
import { makeKeyedSerialExecutor } from "./KeyedSerialExecutor.ts";
import {
  type ProviderAdapterV2SessionRuntime,
  type ProviderAdapterV2Shape,
} from "./ProviderAdapter.ts";
import { ProviderAdapterRegistryV2 } from "./ProviderAdapterRegistry.ts";
import { ProviderSessionManagerV2 } from "./ProviderSessionManager.ts";
import { ProjectionStoreV2 } from "./ProjectionStore.ts";
import { RuntimePolicyV2 } from "./RuntimePolicy.ts";

const THREAD_GOAL_COMMAND_TYPE = "thread.goal.command";

export class ThreadGoalServiceError extends Schema.TaggedErrorClass<ThreadGoalServiceError>()(
  "ThreadGoalServiceError",
  {
    operation: Schema.Literals([
      "read-receipt",
      "read-projection",
      "validate-thread",
      "resolve-provider",
      "open-provider-session",
      "load-provider-thread",
      "invoke-provider-goal",
      "verify-provider",
      "commit-command",
      "reject-command",
    ]),
    commandId: CommandId,
    threadId: ThreadId,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface ThreadGoalServiceShape {
  readonly execute: (
    command: OrchestrationV2ThreadGoalCommand,
  ) => Effect.Effect<OrchestrationV2ThreadGoalCommandResult, ThreadGoalServiceError>;
}

export class ThreadGoalService extends Context.Service<ThreadGoalService, ThreadGoalServiceShape>()(
  "t3/orchestration-v2/ThreadGoalService",
) {}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function latestRootProviderThread(
  projection: OrchestrationV2ThreadProjection,
  providerInstanceId: ProviderInstanceId,
): OrchestrationV2ProviderThread | undefined {
  const active = projection.providerThreads.find(
    (candidate) =>
      candidate.id === projection.thread.activeProviderThreadId &&
      candidate.appThreadId === projection.thread.id &&
      candidate.ownerNodeId === null &&
      candidate.providerInstanceId === providerInstanceId,
  );
  if (active !== undefined) return active;

  return projection.providerThreads
    .filter(
      (candidate) =>
        candidate.appThreadId === projection.thread.id &&
        candidate.ownerNodeId === null &&
        candidate.providerInstanceId === providerInstanceId,
    )
    .toSorted(
      (left, right) =>
        (right.lastRunOrdinal ?? 0) - (left.lastRunOrdinal ?? 0) ||
        DateTime.toEpochMillis(right.updatedAt) - DateTime.toEpochMillis(left.updatedAt),
    )[0];
}

function setAlreadyMatches(
  command: Extract<OrchestrationV2ThreadGoalCommand, { readonly type: "set" }>,
  goal: OrchestrationV2ThreadGoal | null,
  providerThread: OrchestrationV2ProviderThread,
): goal is OrchestrationV2ThreadGoal {
  return (
    goal !== null &&
    goal.providerThreadId === providerThread.id &&
    (command.objective === undefined || command.objective === goal.objective) &&
    (command.status === undefined || command.status === goal.status) &&
    (command.tokenBudget === undefined || command.tokenBudget === goal.tokenBudget)
  );
}

export const make = Effect.gen(function* () {
  const receipts = yield* CommandReceiptStoreV2;
  const eventSink = yield* EventSinkV2;
  const ids = yield* IdAllocatorV2;
  const providerAdapters = yield* ProviderAdapterRegistryV2;
  const providerSessions = yield* ProviderSessionManagerV2;
  const projections = yield* ProjectionStoreV2;
  const runtimePolicy = yield* RuntimePolicyV2;
  const serial = yield* makeKeyedSerialExecutor<ThreadId>();

  const error =
    (
      command: OrchestrationV2ThreadGoalCommand,
      operation: ThreadGoalServiceError["operation"],
      message: string,
    ) =>
    (cause?: unknown) =>
      new ThreadGoalServiceError({
        operation,
        commandId: command.commandId,
        threadId: command.threadId,
        message,
        ...(cause === undefined ? {} : { cause }),
      });

  const providerSessionIdFor = Effect.fn("ThreadGoalService.providerSessionIdFor")(
    function* (input: {
      readonly command: OrchestrationV2ThreadGoalCommand;
      readonly adapter: ProviderAdapterV2Shape;
      readonly providerInstanceId: ProviderInstanceId;
      readonly threadId: ThreadId;
    }) {
      const capabilities = yield* input.adapter
        .getCapabilities()
        .pipe(
          Effect.mapError(
            error(
              input.command,
              "resolve-provider",
              `Could not read capabilities for provider ${input.providerInstanceId}.`,
            ),
          ),
        );
      const providerSessionId = capabilities.sessions.supportsMultipleProviderThreadsPerSession
        ? ids.derive.providerSession({ providerInstanceId: input.providerInstanceId })
        : yield* ids.allocate
            .providerSession({
              providerInstanceId: input.providerInstanceId,
              threadId: input.threadId,
            })
            .pipe(
              Effect.mapError(
                error(
                  input.command,
                  "resolve-provider",
                  `Could not allocate a provider session for ${input.providerInstanceId}.`,
                ),
              ),
            );
      return { capabilities, providerSessionId };
    },
  );

  const loadProviderThread = Effect.fn("ThreadGoalService.loadProviderThread")(function* (input: {
    readonly command: OrchestrationV2ThreadGoalCommand;
    readonly projection: OrchestrationV2ThreadProjection;
    readonly runtime: ProviderAdapterV2SessionRuntime;
    readonly providerSessionId: ProviderSessionId;
    readonly existing: OrchestrationV2ProviderThread | undefined;
  }) {
    const resolvedRuntimePolicy = yield* runtimePolicy
      .resolve({
        thread: input.projection.thread,
        modelSelection: input.projection.thread.modelSelection,
      })
      .pipe(
        Effect.mapError(
          error(
            input.command,
            "load-provider-thread",
            "Could not resolve the provider runtime policy for the thread goal.",
          ),
        ),
      );

    const loaded =
      input.existing === undefined || input.existing.nativeThreadRef === null
        ? yield* input.runtime
            .ensureThread({
              threadId: input.projection.thread.id,
              modelSelection: input.projection.thread.modelSelection,
              runtimePolicy: resolvedRuntimePolicy,
              providerSessionId: input.providerSessionId,
            })
            .pipe(
              Effect.mapError(
                error(
                  input.command,
                  "load-provider-thread",
                  "The provider could not materialize a native thread for the goal.",
                ),
              ),
            )
        : yield* input.runtime
            .resumeThread({
              providerThread: input.existing,
              threadId: input.projection.thread.id,
              modelSelection: input.projection.thread.modelSelection,
              runtimePolicy: resolvedRuntimePolicy,
            })
            .pipe(
              Effect.mapError(
                error(
                  input.command,
                  "load-provider-thread",
                  "The provider could not resume the native thread for the goal.",
                ),
              ),
            );
    const now = yield* DateTime.now;
    return {
      ...loaded,
      ...(input.existing === undefined ? {} : { id: input.existing.id }),
      driver: input.runtime.driver,
      providerInstanceId: input.projection.thread.providerInstanceId,
      providerSessionId: input.providerSessionId,
      appThreadId: input.projection.thread.id,
      ownerNodeId: null,
      firstRunOrdinal: input.existing?.firstRunOrdinal ?? loaded.firstRunOrdinal,
      lastRunOrdinal: input.existing?.lastRunOrdinal ?? loaded.lastRunOrdinal,
      handoffIds: input.existing?.handoffIds ?? loaded.handoffIds,
      forkedFrom: input.existing?.forkedFrom ?? loaded.forkedFrom,
      status: "active" as const,
      createdAt: input.existing?.createdAt ?? loaded.createdAt,
      updatedAt: now,
    } satisfies OrchestrationV2ProviderThread;
  });

  const perform = Effect.fn("ThreadGoalService.perform")(function* (
    command: OrchestrationV2ThreadGoalCommand,
  ) {
    const existingReceipt = yield* receipts
      .getByCommandId(command.commandId)
      .pipe(
        Effect.mapError(
          error(command, "read-receipt", `Could not read receipt ${command.commandId}.`),
        ),
      );
    if (Option.isSome(existingReceipt)) {
      const receipt = existingReceipt.value;
      if (
        receipt.threadId !== command.threadId ||
        receipt.commandType !== THREAD_GOAL_COMMAND_TYPE
      ) {
        return yield* error(
          command,
          "read-receipt",
          `Command id ${command.commandId} is already used by another command.`,
        )();
      }
      if (receipt.status === "rejected") {
        return yield* error(
          command,
          "read-receipt",
          receipt.error ?? `Goal command ${command.commandId} was previously rejected.`,
        )();
      }
      const projection = yield* projections
        .getThreadProjection(command.threadId)
        .pipe(
          Effect.mapError(
            error(command, "read-projection", `Could not read thread ${command.threadId}.`),
          ),
        );
      return { sequence: receipt.resultSequence, goal: projection.goal };
    }

    const projection = yield* projections
      .getThreadProjection(command.threadId)
      .pipe(
        Effect.mapError(
          error(command, "read-projection", `Could not read thread ${command.threadId}.`),
        ),
      );
    if (projection.thread.deletedAt !== null || projection.thread.archivedAt !== null) {
      return yield* error(
        command,
        "validate-thread",
        `Thread ${command.threadId} is ${projection.thread.deletedAt !== null ? "deleted" : "archived"} and cannot manage a goal.`,
      )();
    }
    if (
      command.type === "set" &&
      command.objective === undefined &&
      command.status === undefined &&
      command.tokenBudget === undefined
    ) {
      return yield* error(
        command,
        "validate-thread",
        "A goal update must specify an objective, status, or token budget.",
      )();
    }
    const providerInstanceId = projection.thread.providerInstanceId;
    if (projection.thread.modelSelection.instanceId !== providerInstanceId) {
      return yield* error(
        command,
        "validate-thread",
        `Thread ${command.threadId} has an inconsistent provider selection.`,
      )();
    }
    const adapter = yield* providerAdapters
      .get(providerInstanceId)
      .pipe(
        Effect.mapError(
          error(
            command,
            "resolve-provider",
            `Provider ${providerInstanceId} is unavailable for native goals.`,
          ),
        ),
      );
    const existingProviderThread = latestRootProviderThread(projection, providerInstanceId);
    const sessionDetails =
      existingProviderThread?.providerSessionId === null ||
      existingProviderThread?.providerSessionId === undefined
        ? yield* providerSessionIdFor({
            command,
            adapter,
            providerInstanceId,
            threadId: command.threadId,
          })
        : {
            capabilities: yield* adapter
              .getCapabilities()
              .pipe(
                Effect.mapError(
                  error(
                    command,
                    "resolve-provider",
                    `Could not read capabilities for provider ${providerInstanceId}.`,
                  ),
                ),
              ),
            providerSessionId: existingProviderThread.providerSessionId,
          };
    if (
      existingProviderThread === undefined &&
      !sessionDetails.capabilities.threads.canCreateEmptyThread
    ) {
      return yield* error(
        command,
        "resolve-provider",
        `Provider ${providerInstanceId} cannot create an empty native thread required for goals.`,
      )();
    }
    const existingSession = projection.providerSessions.find(
      (candidate) => candidate.id === sessionDetails.providerSessionId,
    );
    const resolvedRuntimePolicy = yield* runtimePolicy
      .resolve({
        thread: projection.thread,
        modelSelection: projection.thread.modelSelection,
      })
      .pipe(
        Effect.mapError(
          error(
            command,
            "open-provider-session",
            "Could not resolve the provider runtime policy for the goal session.",
          ),
        ),
      );
    const runtime = yield* providerSessions
      .open({
        threadId: command.threadId,
        providerSessionId: sessionDetails.providerSessionId,
        modelSelection: projection.thread.modelSelection,
        runtimePolicy: resolvedRuntimePolicy,
        ...(existingSession === undefined ? {} : { resumeFromSession: existingSession }),
      })
      .pipe(
        Effect.mapError(
          error(
            command,
            "open-provider-session",
            `Could not open provider ${providerInstanceId} for native goals.`,
          ),
        ),
      );
    if (
      runtime.getThreadGoal === undefined ||
      runtime.setThreadGoal === undefined ||
      runtime.clearThreadGoal === undefined
    ) {
      return yield* error(
        command,
        "resolve-provider",
        `Provider ${providerInstanceId} does not implement native thread goals.`,
      )();
    }

    const providerThread = yield* loadProviderThread({
      command,
      projection,
      runtime,
      providerSessionId: sessionDetails.providerSessionId,
      existing: existingProviderThread,
    });

    const desiredSetMatches =
      command.type === "set" && setAlreadyMatches(command, projection.goal, providerThread);
    const desiredClearMatches =
      command.type === "clear" &&
      projection.goal === null &&
      projection.goalRevision?.providerThreadId === providerThread.id;

    const nativeGoal: OrchestrationV2ThreadGoal | null =
      command.type === "refresh"
        ? yield* runtime
            .getThreadGoal({ threadId: command.threadId, providerThread })
            .pipe(
              Effect.mapError(
                error(command, "invoke-provider-goal", "Could not refresh the native thread goal."),
              ),
            )
        : command.type === "set"
          ? desiredSetMatches
            ? projection.goal
            : yield* runtime
                .setThreadGoal({
                  threadId: command.threadId,
                  providerThread,
                  ...(command.objective === undefined ? {} : { objective: command.objective }),
                  ...(command.status === undefined ? {} : { status: command.status }),
                  ...(command.tokenBudget === undefined
                    ? {}
                    : { tokenBudget: command.tokenBudget }),
                })
                .pipe(
                  Effect.mapError(
                    error(
                      command,
                      "invoke-provider-goal",
                      "Could not update the native thread goal.",
                    ),
                  ),
                )
          : desiredClearMatches
            ? null
            : yield* runtime
                .clearThreadGoal({ threadId: command.threadId, providerThread })
                .pipe(
                  Effect.mapError(
                    error(
                      command,
                      "invoke-provider-goal",
                      "Could not clear the native thread goal.",
                    ),
                  ),
                  Effect.as(null),
                );

    const current = yield* projections
      .getThreadProjection(command.threadId)
      .pipe(
        Effect.mapError(
          error(
            command,
            "verify-provider",
            "Could not verify the provider selection after the native goal operation.",
          ),
        ),
      );
    const activeProviderDrifted =
      current.thread.activeProviderThreadId !== projection.thread.activeProviderThreadId &&
      current.thread.activeProviderThreadId !== null &&
      current.thread.activeProviderThreadId !== providerThread.id;
    if (
      current.thread.providerInstanceId !== providerInstanceId ||
      current.thread.modelSelection.instanceId !== providerInstanceId ||
      activeProviderDrifted
    ) {
      return yield* error(
        command,
        "verify-provider",
        `Provider selection changed while goal command ${command.commandId} was running.`,
      )();
    }

    const now = yield* DateTime.now;
    const clearUpdatedAt =
      projection.goalRevision !== null &&
      DateTime.toEpochMillis(projection.goalRevision.updatedAt) > DateTime.toEpochMillis(now)
        ? projection.goalRevision.updatedAt
        : now;
    const goalEvent: OrchestrationV2DomainEvent =
      nativeGoal === null
        ? {
            id: yield* ids.allocate
              .event({ threadId: command.threadId, commandId: command.commandId })
              .pipe(
                Effect.mapError(
                  error(command, "commit-command", "Could not allocate the goal clear event."),
                ),
              ),
            type: "thread.goal-cleared",
            threadId: command.threadId,
            driver: runtime.driver,
            providerInstanceId,
            occurredAt: now,
            payload: { providerThreadId: providerThread.id, updatedAt: clearUpdatedAt },
          }
        : {
            id: yield* ids.allocate
              .event({ threadId: command.threadId, commandId: command.commandId })
              .pipe(
                Effect.mapError(
                  error(command, "commit-command", "Could not allocate the goal update event."),
                ),
              ),
            type: "thread.goal-updated",
            threadId: command.threadId,
            driver: runtime.driver,
            providerInstanceId,
            occurredAt: now,
            payload: {
              ...nativeGoal,
              threadId: command.threadId,
              providerThreadId: providerThread.id,
            },
          };
    const providerThreadEvent: OrchestrationV2DomainEvent = {
      id: yield* ids.allocate
        .event({
          threadId: command.threadId,
          providerSessionId: sessionDetails.providerSessionId,
          commandId: command.commandId,
        })
        .pipe(
          Effect.mapError(
            error(command, "commit-command", "Could not allocate the provider thread event."),
          ),
        ),
      type: "provider-thread.updated",
      threadId: command.threadId,
      driver: runtime.driver,
      providerInstanceId,
      occurredAt: now,
      payload: { ...providerThread, updatedAt: now },
    };
    const committed = yield* eventSink
      .commitCommand({
        commandId: command.commandId,
        threadId: command.threadId,
        commandType: THREAD_GOAL_COMMAND_TYPE,
        acceptedAt: now,
        events: [providerThreadEvent, goalEvent],
        effects: [],
      })
      .pipe(
        Effect.mapError(
          error(command, "commit-command", `Could not commit goal command ${command.commandId}.`),
        ),
      );
    if (committed.receipt.status === "rejected") {
      return yield* error(
        command,
        "commit-command",
        committed.receipt.error ?? `Goal command ${command.commandId} was rejected.`,
      )();
    }
    const updatedProjection = yield* projections
      .getThreadProjection(command.threadId)
      .pipe(
        Effect.mapError(
          error(
            command,
            "read-projection",
            `Could not read goal state after command ${command.commandId}.`,
          ),
        ),
      );
    return {
      sequence: committed.receipt.resultSequence,
      goal: updatedProjection.goal,
    } satisfies OrchestrationV2ThreadGoalCommandResult;
  });

  const execute: ThreadGoalServiceShape["execute"] = (command) =>
    serial.withLock(
      command.threadId,
      perform(command).pipe(
        Effect.catch((failure) =>
          Effect.gen(function* () {
            const rejectedAt = yield* DateTime.now;
            yield* eventSink
              .commitRejectedCommand({
                commandId: command.commandId,
                threadId: command.threadId,
                commandType: THREAD_GOAL_COMMAND_TYPE,
                rejectedAt,
                error: failure.message,
              })
              .pipe(
                Effect.mapError((cause) =>
                  error(
                    command,
                    "reject-command",
                    `Goal command failed (${failure.message}) and its rejection receipt could not be persisted: ${causeMessage(cause)}.`,
                  )(cause),
                ),
              );
            return yield* failure;
          }),
        ),
      ),
    );

  return ThreadGoalService.of({ execute });
});

export const layer: Layer.Layer<
  ThreadGoalService,
  never,
  | CommandReceiptStoreV2
  | EventSinkV2
  | IdAllocatorV2
  | ProjectionStoreV2
  | ProviderAdapterRegistryV2
  | ProviderSessionManagerV2
  | RuntimePolicyV2
> = Layer.effect(ThreadGoalService, make);
