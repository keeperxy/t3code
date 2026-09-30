// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import {
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type TaskUsageReadReportInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { afterEach, beforeEach } from "vite-plus/test";

import {
  ProjectionThreadMessageRepository,
  type ProjectionThreadMessage,
} from "../persistence/Services/ProjectionThreadMessages.ts";
import {
  ProjectionTurnRepository,
  type ProjectionTurnById,
} from "../persistence/Services/ProjectionTurns.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "../provider/Services/ProviderSessionDirectory.ts";
import { make } from "./TaskUsageReports.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const uid = process.geteuid?.() ?? 0;
const taskId = "20260930-orchestrator-totals-2qftombj";
const codexThreadId = "01a0ef91-324b-78a0-9367-4834a7cb08d8";
const closingTurnId = "01a0efe3-c303-7741-9daf-48c2232f65b8";
const threadId = ThreadId.make("t3-thread");
const messageId = MessageId.make("assistant-final");
const now = "2026-09-30T02:00:00.000Z";
const fence = `\`\`\`t3-task-usage\n{"version":1,"taskId":"${taskId}","closingTurnId":"${closingTurnId}"}\n\`\`\`\n`;

const input: TaskUsageReadReportInput = { threadId, messageId, taskId };

const chatReport = {
  schema_version: 1,
  task_id: "cbfccce54f344e7eaae9c3792744fe0e",
  thread_id: codexThreadId,
  session_id: codexThreadId,
  closing_turn: closingTurnId,
  closing_terminal: "task_complete",
  columns: ["Invocation", "Model / reasoning", "Total tokens", "Elapsed"],
  rows: [
    ["Orchestrator", "gpt-6.1-sol xhigh → medium", "3,869,596", "18m 08.0s"],
    ["research-1", "claude-opus-5-5 medium, 1m", "1,204,113", "6m 12.4s"],
    ["**task total** (orchestrator + 1 invocations)", "", "5,073,709", "18m 08.0s"],
  ],
  notes: ["Total = input + output tokens; ≥ marks lower bounds."],
};

let root = "";
let taskDir = "";

beforeEach(() => {
  root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-task-usage-"));
  taskDir = NodePath.join(root, taskId);
  NodeFS.mkdirSync(taskDir, { mode: 0o700 });
  writeFile("task.json", {
    schema_version: 1,
    task_id: chatReport.task_id,
    created_at: now,
    main: {
      thread_id: codexThreadId,
      session_id: codexThreadId,
      rollout: "/home/user/.codex/sessions/rollout.jsonl",
      model: "gpt-6.1-sol",
      reasoning: "xhigh → medium",
      context: null,
    },
    turns: [closingTurnId],
    workers: [],
    sealed: { closing_turn: closingTurnId, turns: [closingTurnId], workers: [], sealed_at: now },
  });
});

afterEach(() => {
  NodeFS.rmSync(root, { recursive: true, force: true });
});

function writeFile(name: string, value: unknown, mode = 0o600) {
  const path = NodePath.join(taskDir, name);
  NodeFS.writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
  NodeFS.chmodSync(path, mode);
}

function publishChatReport(report: unknown = chatReport) {
  const text = typeof report === "string" ? report : `${encodeJson(report)}\n`;
  writeFile("chat-report.json", text);
  return NodeCrypto.createHash("sha256").update(text).digest("hex");
}

function writeFinalMeasurement(overrides: Record<string, unknown> = {}) {
  writeFile("measurement.json", {
    schema_version: 1,
    task_id: chatReport.task_id,
    state: "final",
    finalized_at: now,
    evidence: {
      source: "codex rollout token_usage_record ledger",
      rollout: "/home/user/.codex/sessions/rollout.jsonl",
      thread_id: codexThreadId,
      session_id: codexThreadId,
    },
    orchestrator: { closing_turn: closingTurnId, closing_terminal: "task_complete" },
    turns: [],
    workers: [],
    report_sha256: "0".repeat(64),
    ...overrides,
  });
}

interface World {
  message?: Partial<ProjectionThreadMessage> | null;
  turn?: Partial<ProjectionTurnById> | null;
  binding?: Partial<ProviderRuntimeBinding> | null;
  uid?: number | undefined;
}

function readReport(world: World = {}, request: TaskUsageReadReportInput = input) {
  const message: ProjectionThreadMessage | null =
    world.message === null
      ? null
      : {
          messageId,
          threadId,
          turnId: TurnId.make(closingTurnId),
          role: "assistant",
          text: `Done.\n\n${fence}`,
          isStreaming: false,
          createdAt: now,
          updatedAt: now,
          ...world.message,
        };
  const turn: ProjectionTurnById | null =
    world.turn === null
      ? null
      : {
          threadId,
          turnId: TurnId.make(closingTurnId),
          pendingMessageId: null,
          sourceProposedPlanThreadId: null,
          sourceProposedPlanId: null,
          assistantMessageId: messageId,
          state: "completed",
          requestedAt: now,
          startedAt: now,
          completedAt: now,
          checkpointTurnCount: null,
          checkpointRef: null,
          checkpointStatus: null,
          checkpointFiles: [],
          ...world.turn,
        };
  const binding: ProviderRuntimeBinding | null =
    world.binding === null
      ? null
      : {
          threadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: ProviderInstanceId.make("codex"),
          resumeCursor: { threadId: codexThreadId },
          ...world.binding,
        };
  return Effect.gen(function* () {
    const service = yield* make({ root, uid: "uid" in world ? world.uid : uid });
    return yield* service.readReport(request);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ProjectionThreadMessageRepository)({
          getByMessageId: ({ messageId: id }) =>
            Effect.succeed(message?.messageId === id ? Option.some(message) : Option.none()),
        }),
        Layer.mock(ProjectionTurnRepository)({
          getByTurnId: () => Effect.succeed(Option.fromNullOr(turn)),
        }),
        Layer.mock(ProviderSessionDirectory)({
          getBinding: () => Effect.succeed(Option.fromNullOr(binding)),
        }),
      ),
    ),
  );
}

describe("TaskUsageReports", () => {
  it.effect("stays pending until the helper publishes, then returns its rows", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* readReport(), { status: "pending" });

      const digest = NodeCrypto.createHash("sha256")
        .update(`${encodeJson(chatReport)}\n`)
        .digest("hex");
      writeFinalMeasurement({ chat_report_sha256: digest });
      // The digest is frozen before the report file lands.
      assert.deepStrictEqual(yield* readReport(), { status: "pending" });

      publishChatReport();
      const result = yield* readReport();
      assert.deepStrictEqual(result, {
        status: "complete",
        report: {
          rows: chatReport.rows.map(([invocation, modelReasoning, totalTokens, elapsed]) => ({
            invocation: invocation!,
            modelReasoning: modelReasoning!,
            totalTokens: totalTokens!,
            elapsed: elapsed!,
          })),
          notes: chatReport.notes,
        },
      });
      // Nothing private crosses the wire.
      const wire = encodeJson(result);
      assert.notInclude(wire, root);
      assert.notInclude(wire, codexThreadId);
      assert.notInclude(wire, "rollout");
    }),
  );

  it.effect("waits while the task is unsealed or the closing turn still runs", () =>
    Effect.gen(function* () {
      writeFinalMeasurement({ chat_report_sha256: publishChatReport() });
      assert.deepStrictEqual(yield* readReport({ turn: { state: "running" } }), {
        status: "pending",
      });
      writeFile("task.json", {
        schema_version: 1,
        task_id: chatReport.task_id,
        main: { thread_id: codexThreadId, session_id: codexThreadId },
        turns: [closingTurnId],
        sealed: null,
      });
      assert.deepStrictEqual(yield* readReport(), { status: "pending" });
    }),
  );

  it.effect("rejects references it cannot bind to this thread, message, turn, and session", () =>
    Effect.gen(function* () {
      writeFinalMeasurement({ chat_report_sha256: publishChatReport() });
      const notBound = { status: "unavailable", reason: "not-bound" } as const;

      // Another thread's message id.
      assert.deepStrictEqual(
        yield* readReport({ message: { threadId: ThreadId.make("other-thread") } }),
        notBound,
      );
      // A message that names a different task, or only quotes the fence.
      assert.deepStrictEqual(
        yield* readReport({}, { ...input, taskId: "20260930-someone-else" }),
        notBound,
      );
      assert.deepStrictEqual(
        yield* readReport({ message: { text: `> ${fence.replaceAll("\n", "\n> ")}` } }),
        notBound,
      );
      assert.deepStrictEqual(
        yield* readReport({ message: { text: fence.replace(closingTurnId, "other-turn") } }),
        notBound,
      );
      // Not the assistant's terminal, settled message.
      assert.deepStrictEqual(yield* readReport({ message: { role: "user" } }), notBound);
      assert.deepStrictEqual(yield* readReport({ message: { isStreaming: true } }), notBound);
      assert.deepStrictEqual(
        yield* readReport({ turn: { assistantMessageId: MessageId.make("later") } }),
        notBound,
      );
      assert.deepStrictEqual(yield* readReport({ turn: { state: "interrupted" } }), notBound);
      assert.deepStrictEqual(yield* readReport({ turn: { state: "error" } }), notBound);
      // A turn other than the sealed closing turn.
      assert.deepStrictEqual(
        yield* readReport({ message: { turnId: TurnId.make("01a0efcc-813a-7c12-a297") } }),
        notBound,
      );
      // The thread is not bound to the task's Codex session.
      assert.deepStrictEqual(
        yield* readReport({ binding: { resumeCursor: { threadId: "01a0ffff-other" } } }),
        notBound,
      );
      assert.deepStrictEqual(
        yield* readReport({ binding: { provider: ProviderDriverKind.make("claudeAgent") } }),
        notBound,
      );
      assert.deepStrictEqual(yield* readReport({ binding: null }), notBound);
      assert.deepStrictEqual(yield* readReport({ message: null }), notBound);
    }),
  );

  it.effect("refuses links, foreign or shared files, and oversized or malformed reports", () =>
    Effect.gen(function* () {
      const invalid = { status: "unavailable", reason: "invalid" } as const;
      writeFinalMeasurement({ chat_report_sha256: publishChatReport() });
      assert.equal((yield* readReport()).status, "complete");

      assert.deepStrictEqual(yield* readReport({ uid: uid + 1 }), invalid);
      assert.deepStrictEqual(yield* readReport({ uid: undefined }), invalid);

      NodeFS.chmodSync(NodePath.join(taskDir, "chat-report.json"), 0o620);
      assert.deepStrictEqual(yield* readReport(), invalid);

      // A symlinked report, even to an identical file.
      const outside = NodePath.join(root, "outside.json");
      NodeFS.renameSync(NodePath.join(taskDir, "chat-report.json"), outside);
      NodeFS.chmodSync(outside, 0o600);
      NodeFS.symlinkSync(outside, NodePath.join(taskDir, "chat-report.json"));
      assert.deepStrictEqual(yield* readReport(), invalid);
      NodeFS.rmSync(NodePath.join(taskDir, "chat-report.json"));

      writeFinalMeasurement({ chat_report_error: "unsupported-size" });
      assert.deepStrictEqual(yield* readReport(), { status: "unavailable", reason: "invalid" });
      writeFinalMeasurement({ chat_report_error: "invalid-cells" });
      assert.deepStrictEqual(yield* readReport(), { status: "unavailable", reason: "invalid" });
      writeFinalMeasurement({ chat_report_sha256: publishChatReport("x".repeat(300 * 1024)) });
      assert.deepStrictEqual(yield* readReport(), invalid);

      writeFinalMeasurement({ chat_report_sha256: publishChatReport("{not json") });
      assert.deepStrictEqual(yield* readReport(), invalid);

      writeFinalMeasurement({
        chat_report_sha256: publishChatReport({ ...chatReport, path: "/home/user/secret" }),
      });
      assert.deepStrictEqual(yield* readReport(), invalid);

      writeFinalMeasurement({
        chat_report_sha256: publishChatReport({ ...chatReport, rows: [["a", "b", "c"]] }),
      });
      assert.deepStrictEqual(yield* readReport(), invalid);

      writeFinalMeasurement({
        chat_report_sha256: publishChatReport({ ...chatReport, closing_turn: "01a0efcc-other" }),
      });
      assert.deepStrictEqual(yield* readReport(), invalid);
    }),
  );

  it.effect("refuses a symlinked task directory", () =>
    Effect.gen(function* () {
      writeFinalMeasurement({ chat_report_sha256: publishChatReport() });
      const moved = NodePath.join(root, "elsewhere");
      NodeFS.renameSync(taskDir, moved);
      NodeFS.symlinkSync(moved, taskDir);
      assert.deepStrictEqual(yield* readReport(), { status: "unavailable", reason: "invalid" });
    }),
  );

  it.effect("reports why a task has no table", () =>
    Effect.gen(function* () {
      const reason = readReport().pipe(
        Effect.map((result) => (result.status === "unavailable" ? result.reason : result.status)),
      );

      writeFinalMeasurement({ report_sha256: "1".repeat(64) });
      assert.equal(yield* reason, "legacy");

      writeFinalMeasurement({
        chat_report_sha256: publishChatReport(),
        orchestrator: { closing_turn: closingTurnId, closing_terminal: "turn_aborted" },
      });
      assert.equal(yield* reason, "aborted");

      writeFile("measurement.json", {
        schema_version: 1,
        task_id: chatReport.task_id,
        state: "timed_out",
        reason: "No terminal event within 3600 seconds.",
        updated_at: now,
      });
      assert.equal(yield* reason, "finalizer-stopped");

      writeFile("measurement.json", {
        schema_version: 1,
        task_id: chatReport.task_id,
        state: "failed",
        chat_report_error: "unsupported-size",
      });
      assert.equal(yield* reason, "invalid");
      writeFile("task.json", {
        schema_version: 1,
        task_id: chatReport.task_id,
        main: { thread_id: codexThreadId, session_id: codexThreadId },
        turns: [closingTurnId],
        sealed: null,
      });
      assert.equal(yield* reason, "invalid");

      NodeFS.rmSync(taskDir, { recursive: true });
      assert.equal(yield* reason, "not-found");
    }),
  );
});
