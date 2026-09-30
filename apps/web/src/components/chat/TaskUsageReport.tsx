import { useAtomValue } from "@effect/atom-react";
import {
  describeTaskUsageReportState,
  splitTaskUsageCell,
} from "@t3tools/client-runtime/state/task-usage";
import {
  TASK_USAGE_COLUMNS,
  type EnvironmentId,
  type MessageId,
  type TaskUsageFence,
  type ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { serverEnvironment } from "../../state/server";

/** A final reply's task usage reference, rendered in place of its fence. */
export interface TaskUsageReportTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly fence: TaskUsageFence;
}

function TaskUsageCell({ text }: { text: string }) {
  return splitTaskUsageCell(text).map((span, index) =>
    span.bold ? <strong key={index}>{span.text}</strong> : span.text,
  );
}

/**
 * Pending text until the helper publishes, then the helper's four-column
 * table in the same place. Failures read as one sentence and never as rows.
 */
export function TaskUsageReport({ target }: { target: TaskUsageReportTarget }) {
  const query = useMemo(
    () =>
      serverEnvironment.taskUsageReport({
        environmentId: target.environmentId,
        input: {
          threadId: target.threadId,
          messageId: target.messageId,
          taskId: target.fence.taskId,
        },
      }),
    [target.environmentId, target.threadId, target.messageId, target.fence.taskId],
  );
  const result = useAtomValue(query);
  const state = Option.getOrNull(AsyncResult.value(result));

  if (state === null || state.status !== "complete") {
    return (
      <p className="chat-markdown-task-usage text-muted-foreground" role="status">
        {describeTaskUsageReportState(result._tag === "Failure" ? { status: "error" } : state)}
      </p>
    );
  }

  return (
    <div className="chat-markdown-task-usage">
      <table aria-label="Task usage">
        <thead>
          <tr>
            {TASK_USAGE_COLUMNS.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.report.rows.map((row, index) => (
            <tr key={index}>
              <td>
                <TaskUsageCell text={row.invocation} />
              </td>
              <td>
                <TaskUsageCell text={row.modelReasoning} />
              </td>
              <td>
                <TaskUsageCell text={row.totalTokens} />
              </td>
              <td>
                <TaskUsageCell text={row.elapsed} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {state.report.notes.map((note, index) => (
        <p key={index} className="mt-1.5 text-muted-foreground text-xs">
          {note}
        </p>
      ))}
    </div>
  );
}
