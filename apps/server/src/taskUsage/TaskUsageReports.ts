// @effect-diagnostics nodeBuiltinImport:off
/**
 * TaskUsageReports - answers `taskUsage.readReport` for a multi-model task's
 * usage table in chat.
 *
 * The orchestrator's final reply names its private task directory in a
 * reserved fence. This service checks that the persisted message, its ended
 * turn, and the thread's Codex binding match the helper's sealed task, then
 * returns the helper's frozen four-column cells. It derives every path itself,
 * writes nothing, and never returns file contents beyond those cells. The
 * helper side of this bridge is documented next to `task_usage.py`.
 *
 * @module TaskUsageReports
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  findTaskUsageFence,
  TASK_USAGE_COLUMNS,
  TASK_USAGE_MAX_CELL_LENGTH,
  TASK_USAGE_MAX_NOTE_LENGTH,
  TASK_USAGE_MAX_NOTES,
  TASK_USAGE_MAX_ROWS,
  type TaskUsageReadReportInput,
  type TaskUsageReadReportResult,
  type TaskUsageUnavailableReason,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ProjectionThreadMessageRepository } from "../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionTurnRepository } from "../persistence/Services/ProjectionTurns.ts";
import { ProviderSessionDirectory } from "../provider/Services/ProviderSessionDirectory.ts";

const MANIFEST_MAX_BYTES = 256 * 1024;
const MEASUREMENT_MAX_BYTES = 1024 * 1024;
const CHAT_REPORT_MAX_BYTES = 256 * 1024;

const HelperId = Schema.String.check(Schema.isPattern(/^[0-9A-Za-z_-]{1,128}$/));
const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const Cell = Schema.String.check(
  Schema.isMaxLength(TASK_USAGE_MAX_CELL_LENGTH),
  Schema.isPattern(/^[^\r\n]*$/),
);

/** The fields of the helper's task.json this bridge relies on. */
const TaskManifest = Schema.Struct({
  schema_version: Schema.Literal(1),
  task_id: HelperId,
  main: Schema.Struct({ thread_id: HelperId, session_id: HelperId }),
  turns: Schema.Array(HelperId),
  sealed: Schema.NullOr(Schema.Struct({ closing_turn: HelperId, turns: Schema.Array(HelperId) })),
});

const Measurement = Schema.Union([
  Schema.Struct({
    schema_version: Schema.Literal(1),
    task_id: HelperId,
    state: Schema.Literal("final"),
    evidence: Schema.Struct({ thread_id: HelperId, session_id: HelperId }),
    orchestrator: Schema.Struct({
      closing_turn: HelperId,
      closing_terminal: Schema.NullOr(Schema.String),
    }),
    report_sha256: Sha256,
    chat_report_sha256: Schema.optionalKey(Sha256),
    chat_report_error: Schema.optionalKey(Schema.Literals(["unsupported-size", "invalid-cells"])),
  }),
  Schema.Struct({
    schema_version: Schema.Literal(1),
    task_id: HelperId,
    state: Schema.Literals(["timed_out", "interrupted", "failed"]),
    chat_report_error: Schema.optionalKey(Schema.Literals(["unsupported-size", "invalid-cells"])),
  }),
]);

/** The helper's chat publication. Strict: an unknown key is a new version. */
const ChatReport = Schema.Struct({
  schema_version: Schema.Literal(1),
  task_id: HelperId,
  thread_id: HelperId,
  session_id: HelperId,
  closing_turn: HelperId,
  closing_terminal: Schema.Literal("task_complete"),
  columns: Schema.Tuple([
    Schema.Literal(TASK_USAGE_COLUMNS[0]),
    Schema.Literal(TASK_USAGE_COLUMNS[1]),
    Schema.Literal(TASK_USAGE_COLUMNS[2]),
    Schema.Literal(TASK_USAGE_COLUMNS[3]),
  ]),
  rows: Schema.Array(Schema.Tuple([Cell, Cell, Cell, Cell])).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(TASK_USAGE_MAX_ROWS),
  ),
  notes: Schema.Array(Schema.String.check(Schema.isMaxLength(TASK_USAGE_MAX_NOTE_LENGTH))).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(TASK_USAGE_MAX_NOTES),
  ),
});

const CodexResumeCursor = Schema.Struct({ threadId: HelperId });

const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(TaskManifest));
const decodeMeasurement = Schema.decodeUnknownOption(Schema.fromJsonString(Measurement));
const decodeChatReport = Schema.decodeUnknownOption(Schema.fromJsonString(ChatReport), {
  onExcessProperty: "error",
});
const decodeCodexResumeCursor = Schema.decodeUnknownOption(CodexResumeCursor);

type OwnedFile =
  | { readonly _tag: "missing" }
  | { readonly _tag: "invalid" }
  | { readonly _tag: "ok"; readonly bytes: Buffer; readonly stat: NodeFS.Stats };

const MISSING: OwnedFile = { _tag: "missing" };
const INVALID: OwnedFile = { _tag: "invalid" };

function isMissing(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/** Owned by us and not writable by anyone else. */
function isPrivate(stat: NodeFS.Stats, uid: number): boolean {
  return stat.uid === uid && (stat.mode & 0o022) === 0;
}

/**
 * Reads one helper file without following links: lstat, open with
 * O_NOFOLLOW, then fstat must name the same inode. A swap between the two
 * reads as invalid rather than as someone else's file.
 */
async function readOwnedFile(path: string, maxBytes: number, uid: number): Promise<OwnedFile> {
  let linkStat: NodeFS.Stats;
  try {
    linkStat = await NodeFSP.lstat(path);
  } catch (cause) {
    return isMissing(cause) ? MISSING : INVALID;
  }
  if (!linkStat.isFile() || !isPrivate(linkStat, uid) || linkStat.size > maxBytes) return INVALID;

  let handle: NodeFSP.FileHandle;
  try {
    handle = await NodeFSP.open(
      path,
      NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW | NodeFS.constants.O_NONBLOCK,
    );
  } catch (cause) {
    return isMissing(cause) ? MISSING : INVALID;
  }
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.dev !== linkStat.dev ||
      stat.ino !== linkStat.ino ||
      !isPrivate(stat, uid) ||
      stat.size > maxBytes
    ) {
      return INVALID;
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    const current = await NodeFSP.lstat(path);
    if (
      length > maxBytes ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs ||
      current.dev !== stat.dev ||
      current.ino !== stat.ino ||
      !isPrivate(current, uid)
    )
      return INVALID;
    return { _tag: "ok", bytes: buffer.subarray(0, length), stat: after };
  } catch {
    return INVALID;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

type TaskDirectory =
  | { readonly _tag: "missing" }
  | { readonly _tag: "invalid" }
  | { readonly _tag: "ok"; readonly path: string; readonly stat: NodeFS.Stats };

/** The task directory must be a real, private directory directly under the root. */
async function statTaskDirectory(
  root: string,
  taskId: string,
  uid: number,
): Promise<TaskDirectory> {
  const path = NodePath.join(root, taskId);
  try {
    const stat = await NodeFSP.lstat(path);
    if (!stat.isDirectory() || !isPrivate(stat, uid)) return { _tag: "invalid" };
    const [realRoot, realPath] = await Promise.all([
      NodeFSP.realpath(root),
      NodeFSP.realpath(path),
    ]);
    return realPath === NodePath.join(realRoot, taskId)
      ? { _tag: "ok", path, stat }
      : { _tag: "invalid" };
  } catch (cause) {
    return isMissing(cause) ? { _tag: "missing" } : { _tag: "invalid" };
  }
}

async function isSameDirectory(path: string, stat: NodeFS.Stats): Promise<boolean> {
  try {
    const current = await NodeFSP.lstat(path);
    return (
      current.isDirectory() &&
      current.dev === stat.dev &&
      current.ino === stat.ino &&
      isPrivate(current, stat.uid)
    );
  } catch {
    return false;
  }
}

async function isSameFile(
  path: string,
  file: Extract<OwnedFile, { _tag: "ok" }>,
): Promise<boolean> {
  try {
    const current = await NodeFSP.lstat(path);
    return (
      current.isFile() &&
      isPrivate(current, file.stat.uid) &&
      current.dev === file.stat.dev &&
      current.ino === file.stat.ino &&
      current.size === file.stat.size &&
      current.mtimeMs === file.stat.mtimeMs &&
      current.ctimeMs === file.stat.ctimeMs
    );
  } catch {
    return false;
  }
}

const PENDING: TaskUsageReadReportResult = { status: "pending" };
const unavailable = (reason: TaskUsageUnavailableReason): TaskUsageReadReportResult => ({
  status: "unavailable",
  reason,
});

/**
 * Reads the helper's files for a task already bound to a Codex thread and
 * closing turn. Pure over the filesystem so tests can drive every outcome.
 */
export async function readTaskUsageFiles(input: {
  readonly root: string;
  readonly taskId: string;
  readonly uid: number;
  readonly codexThreadId: string;
  readonly closingTurnId: string;
}): Promise<TaskUsageReadReportResult> {
  const directory = await statTaskDirectory(input.root, input.taskId, input.uid);
  if (directory._tag === "missing") return unavailable("not-found");
  if (directory._tag === "invalid") return unavailable("invalid");

  const read = (name: string, maxBytes: number) =>
    readOwnedFile(NodePath.join(directory.path, name), maxBytes, input.uid);

  const manifestFile = await read("task.json", MANIFEST_MAX_BYTES);
  if (manifestFile._tag === "missing") return unavailable("not-found");
  if (manifestFile._tag === "invalid") return unavailable("invalid");
  const manifest = Option.getOrNull(decodeManifest(manifestFile.bytes.toString("utf8")));
  if (manifest === null) return unavailable("invalid");
  if (manifest.main.thread_id !== input.codexThreadId) return unavailable("not-bound");
  if (manifest.sealed !== null) {
    if (
      !manifest.sealed.turns.includes(manifest.sealed.closing_turn) ||
      !manifest.turns.includes(manifest.sealed.closing_turn)
    )
      return unavailable("invalid");
    if (manifest.sealed.closing_turn !== input.closingTurnId) return unavailable("not-bound");
  }

  const measurementFile = await read("measurement.json", MEASUREMENT_MAX_BYTES);
  if (measurementFile._tag === "missing") return PENDING;
  if (measurementFile._tag === "invalid") return unavailable("invalid");
  const measurement = Option.getOrNull(decodeMeasurement(measurementFile.bytes.toString("utf8")));
  if (measurement === null || measurement.task_id !== manifest.task_id) {
    return unavailable("invalid");
  }
  if (measurement.chat_report_error !== undefined) return unavailable("invalid");
  // Seal validation can fail before a manifest is frozen; known bridge errors
  // remain invalid, while a reply that simply landed before seal stays pending.
  if (manifest.sealed === null) return PENDING;
  if (measurement.state !== "final") return unavailable("finalizer-stopped");
  if (
    measurement.evidence.thread_id !== manifest.main.thread_id ||
    measurement.evidence.session_id !== manifest.main.session_id ||
    measurement.orchestrator.closing_turn !== manifest.sealed.closing_turn
  ) {
    return unavailable("invalid");
  }
  if (measurement.orchestrator.closing_terminal !== "task_complete") {
    return unavailable("aborted");
  }
  if (measurement.chat_report_sha256 === undefined) return unavailable("legacy");

  const chatFile = await read("chat-report.json", CHAT_REPORT_MAX_BYTES);
  if (chatFile._tag === "invalid") return unavailable("invalid");
  // The measurement freezes the digest first; the report file follows it.
  if (
    chatFile._tag === "missing" ||
    NodeCrypto.createHash("sha256").update(chatFile.bytes).digest("hex") !==
      measurement.chat_report_sha256
  ) {
    return PENDING;
  }
  const chat = Option.getOrNull(decodeChatReport(chatFile.bytes.toString("utf8")));
  if (
    chat === null ||
    chat.task_id !== manifest.task_id ||
    chat.thread_id !== manifest.main.thread_id ||
    chat.session_id !== manifest.main.session_id ||
    chat.closing_turn !== manifest.sealed.closing_turn
  ) {
    return unavailable("invalid");
  }
  const unchanged = await Promise.all([
    isSameDirectory(directory.path, directory.stat),
    isSameFile(NodePath.join(directory.path, "task.json"), manifestFile),
    isSameFile(NodePath.join(directory.path, "measurement.json"), measurementFile),
    isSameFile(NodePath.join(directory.path, "chat-report.json"), chatFile),
  ]);
  if (unchanged.some((same) => !same)) return unavailable("invalid");

  return {
    status: "complete",
    report: {
      rows: chat.rows.map(([invocation, modelReasoning, totalTokens, elapsed]) => ({
        invocation,
        modelReasoning,
        totalTokens,
        elapsed,
      })),
      notes: chat.notes,
    },
  };
}

export class TaskUsageReports extends Context.Service<
  TaskUsageReports,
  {
    readonly readReport: (
      input: TaskUsageReadReportInput,
    ) => Effect.Effect<TaskUsageReadReportResult>;
  }
>()("t3/taskUsage/TaskUsageReports") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.fn("TaskUsageReports.make")(function* (options: {
  /** Directory holding one private directory per task. */
  readonly root: string;
  /** Owner every helper file must have; the server's own effective UID. */
  readonly uid: number | undefined;
}) {
  const messages = yield* ProjectionThreadMessageRepository;
  const turns = yield* ProjectionTurnRepository;
  const providerSessions = yield* ProviderSessionDirectory;

  const readReport = Effect.fn("TaskUsageReports.readReport")(
    function* (input: TaskUsageReadReportInput) {
      const message = Option.getOrNull(
        yield* messages.getByMessageId({ messageId: input.messageId }),
      );
      const reference = message === null ? null : findTaskUsageFence(message.text);
      if (
        message === null ||
        message.threadId !== input.threadId ||
        message.role !== "assistant" ||
        message.isStreaming ||
        message.turnId === null ||
        reference?.taskId !== input.taskId ||
        reference.closingTurnId !== message.turnId
      ) {
        return unavailable("not-bound");
      }

      const turn = Option.getOrNull(
        yield* turns.getByTurnId({ threadId: input.threadId, turnId: message.turnId }),
      );
      if (turn === null || turn.state === "pending" || turn.state === "running") return PENDING;
      // Only the last assistant message of a turn that ended normally.
      if (turn.state !== "completed" || turn.assistantMessageId !== message.messageId) {
        return unavailable("not-bound");
      }

      const binding = Option.getOrNull(yield* providerSessions.getBinding(input.threadId));
      const cursor =
        binding?.provider === "codex"
          ? Option.getOrNull(decodeCodexResumeCursor(binding.resumeCursor))
          : null;
      if (cursor === null) return unavailable("not-bound");
      if (options.uid === undefined) return unavailable("invalid");

      return yield* Effect.promise(() =>
        readTaskUsageFiles({
          root: options.root,
          taskId: input.taskId,
          uid: options.uid!,
          codexThreadId: cursor.threadId,
          closingTurnId: message.turnId!,
        }),
      );
    },
    // Projection reads fail only when the database does; that is not an answer.
    Effect.orDie,
  );

  return TaskUsageReports.of({ readReport });
});

export const layer = Layer.effect(
  TaskUsageReports,
  Effect.suspend(() =>
    make({
      root: NodePath.join(NodeOS.homedir(), ".local", "state", "multi-model-task"),
      uid: process.geteuid?.(),
    }),
  ),
);
