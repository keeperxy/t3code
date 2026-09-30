import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { MessageId, ThreadId } from "./baseSchemas.ts";

/**
 * A multi-model task's usage table in chat. The orchestrator's final reply
 * carries one reserved fence naming its private task directory; the server
 * validates that reference against the helper's files and answers with the
 * helper's own four-column cells. Nothing else is persisted.
 */
export const TASK_USAGE_FENCE_LANGUAGE = "t3-task-usage";
export const TASK_USAGE_COLUMNS = [
  "Invocation",
  "Model / reasoning",
  "Total tokens",
  "Elapsed",
] as const;
export const TASK_USAGE_MAX_ROWS = 256;
export const TASK_USAGE_MAX_CELL_LENGTH = 1024;
export const TASK_USAGE_MAX_NOTES = 4;
export const TASK_USAGE_MAX_NOTE_LENGTH = 2048;
const TASK_USAGE_FENCE_MAX_BODY_LENGTH = 512;

/** The private task directory's basename: no dots, so never `.` or `..`. */
export const TaskUsageTaskId = Schema.String.check(
  Schema.isPattern(/^[0-9A-Za-z][0-9A-Za-z_-]{0,127}$/),
);
export type TaskUsageTaskId = typeof TaskUsageTaskId.Type;

const TaskUsageFenceBody = Schema.Struct({
  version: Schema.Literal(1),
  taskId: TaskUsageTaskId,
  closingTurnId: Schema.String.check(Schema.isPattern(/^[0-9A-Za-z_-]{1,128}$/)),
});
const decodeTaskUsageFenceBody = Schema.decodeUnknownOption(
  Schema.fromJsonString(TaskUsageFenceBody),
  { onExcessProperty: "error" },
);

export interface TaskUsageFence {
  readonly taskId: TaskUsageTaskId;
  readonly closingTurnId: string;
  /** Offset of the opening fence line in the message text. */
  readonly start: number;
  /** Offset just past the closing fence line, including its line break. */
  readonly end: number;
}

interface SourceLine {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function sourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start <= text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline + 1;
    const content = text.slice(start, newline === -1 ? text.length : newline);
    lines.push({ text: content.endsWith("\r") ? content.slice(0, -1) : content, start, end });
    if (newline === -1) break;
    start = end;
  }
  return lines;
}

const FENCE_OPENING = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const BLANK_LINE = /^[ \t]*$/;
const RESERVED_OPENING = /^```t3-task-usage[ \t]*$/;
const RESERVED_CLOSING = /^```[ \t]*$/;

// CommonMark HTML blocks 1–5 may span blank lines, so a fence inside one is
// raw HTML, not code. Blocks 6–7 end at a blank line, which the reserved
// fence already requires before it.
const HTML_BLOCKS: ReadonlyArray<{ readonly open: RegExp; readonly close: RegExp }> = [
  {
    open: /^ {0,3}<(?:pre|script|style|textarea)(?:[\s>]|$)/i,
    close: /<\/(?:pre|script|style|textarea)>/i,
  },
  { open: /^ {0,3}<!--/, close: /-->/ },
  { open: /^ {0,3}<\?/, close: /\?>/ },
  { open: /^ {0,3}<![A-Za-z]/, close: />/ },
  { open: /^ {0,3}<!\[CDATA\[/, close: /\]\]>/ },
];

function reservedFenceAt(lines: ReadonlyArray<SourceLine>, index: number): TaskUsageFence | null {
  const body = lines[index + 1];
  const closing = lines[index + 2];
  if (
    body === undefined ||
    closing === undefined ||
    body.text.length > TASK_USAGE_FENCE_MAX_BODY_LENGTH ||
    !RESERVED_CLOSING.test(closing.text)
  ) {
    return null;
  }
  return Option.match(decodeTaskUsageFenceBody(body.text), {
    onNone: () => null,
    onSome: ({ taskId, closingTurnId }) => ({
      taskId,
      closingTurnId,
      start: lines[index]!.start,
      end: closing.end,
    }),
  });
}

/**
 * The message's one task usage reference, or null. Accepts only a whole,
 * closed, top-level fence after a blank line with a strict JSON body; a
 * quoted, nested, unclosed, or malformed one stays ordinary code, and two
 * references make the message ambiguous. The server and every client use this
 * same scan, so they agree on which text is a reference.
 */
export function findTaskUsageFence(text: string): TaskUsageFence | null {
  if (!text.includes(`\`\`\`${TASK_USAGE_FENCE_LANGUAGE}`)) return null;

  const lines = sourceLines(text);
  let found: TaskUsageFence | null = null;
  let openFence: { readonly marker: string; readonly length: number } | null = null;
  let htmlClose: RegExp | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.text;
    if (openFence !== null) {
      const closing = FENCE_OPENING.exec(line);
      if (
        closing !== null &&
        closing[1]![0] === openFence.marker &&
        closing[1]!.length >= openFence.length &&
        BLANK_LINE.test(closing[2]!)
      ) {
        openFence = null;
      }
      continue;
    }
    if (htmlClose !== null) {
      if (htmlClose.test(line)) htmlClose = null;
      continue;
    }

    const afterBlank = index === 0 || BLANK_LINE.test(lines[index - 1]!.text);
    if (afterBlank && RESERVED_OPENING.test(line)) {
      const fence = reservedFenceAt(lines, index);
      if (fence !== null) {
        if (found !== null) return null;
        found = fence;
        index += 2;
        continue;
      }
    }

    const opening = FENCE_OPENING.exec(line);
    // A backtick fence's info string cannot contain a backtick.
    if (opening !== null && !(opening[1]![0] === "`" && opening[2]!.includes("`"))) {
      openFence = { marker: opening[1]![0]!, length: opening[1]!.length };
      continue;
    }
    const html = HTML_BLOCKS.find((block) => block.open.test(line));
    if (html !== undefined && !html.close.test(line.replace(html.open, ""))) {
      htmlClose = html.close;
    }
  }
  return found;
}

export const TaskUsageReadReportInput = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  taskId: TaskUsageTaskId,
});
export type TaskUsageReadReportInput = typeof TaskUsageReadReportInput.Type;

const TaskUsageCell = Schema.String.check(Schema.isMaxLength(TASK_USAGE_MAX_CELL_LENGTH));

/** One helper-approved row; cells are shown verbatim apart from `**bold**`. */
export const TaskUsageReportRow = Schema.Struct({
  invocation: TaskUsageCell,
  modelReasoning: TaskUsageCell,
  totalTokens: TaskUsageCell,
  elapsed: TaskUsageCell,
});
export type TaskUsageReportRow = typeof TaskUsageReportRow.Type;

export const TaskUsageReport = Schema.Struct({
  rows: Schema.Array(TaskUsageReportRow).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(TASK_USAGE_MAX_ROWS),
  ),
  notes: Schema.Array(Schema.String.check(Schema.isMaxLength(TASK_USAGE_MAX_NOTE_LENGTH))).check(
    Schema.isMaxLength(TASK_USAGE_MAX_NOTES),
  ),
});
export type TaskUsageReport = typeof TaskUsageReport.Type;

export const TaskUsageUnavailableReason = Schema.Literals([
  "not-found",
  "not-bound",
  "aborted",
  "finalizer-stopped",
  "legacy",
  "invalid",
]);
export type TaskUsageUnavailableReason = typeof TaskUsageUnavailableReason.Type;

export const TaskUsageReadReportResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending") }),
  Schema.Struct({ status: Schema.Literal("complete"), report: TaskUsageReport }),
  Schema.Struct({ status: Schema.Literal("unavailable"), reason: TaskUsageUnavailableReason }),
]);
export type TaskUsageReadReportResult = typeof TaskUsageReadReportResult.Type;
