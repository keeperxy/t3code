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
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { serverEnvironment } from "../../state/server";

export interface TaskUsageReportTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly fence: TaskUsageFence;
}

const COLUMN_WIDTHS = ["28%", "28%", "24%", "20%"] as const;

function TaskUsageCell(props: { readonly text: string; readonly index: number }) {
  return (
    <View className="px-1 py-2" style={{ width: COLUMN_WIDTHS[props.index], minWidth: 0 }}>
      <Text className="text-xs text-foreground tabular-nums">
        {splitTaskUsageCell(props.text).map((span, index) =>
          span.bold ? (
            <Text key={index} className="font-t3-bold text-xs text-foreground">
              {span.text}
            </Text>
          ) : (
            span.text
          ),
        )}
      </Text>
    </View>
  );
}

/**
 * Pending text until the helper publishes, then the helper's four-column
 * table in the same place. Failures read as one sentence and never as rows.
 */
export function TaskUsageReport(props: { readonly target: TaskUsageReportTarget }) {
  const { environmentId, threadId, messageId, fence } = props.target;
  const query = useMemo(
    () =>
      serverEnvironment.taskUsageReport({
        environmentId,
        input: { threadId, messageId, taskId: fence.taskId },
      }),
    [environmentId, threadId, messageId, fence.taskId],
  );
  const result = useAtomValue(query);
  const state = Option.getOrNull(AsyncResult.value(result));

  if (state === null || state.status !== "complete") {
    return (
      <Text className="my-2 text-sm text-foreground-muted" accessibilityRole="text">
        {describeTaskUsageReportState(result._tag === "Failure" ? { status: "error" } : state)}
      </Text>
    );
  }

  return (
    <View className="my-2">
      <View accessibilityLabel="Task usage" className="rounded-lg border border-border">
        <View className="flex-row border-b border-border bg-subtle">
          {TASK_USAGE_COLUMNS.map((column, index) => (
            <View
              key={column}
              className="px-1 py-2"
              style={{ width: COLUMN_WIDTHS[index], minWidth: 0 }}
            >
              <Text className="font-t3-bold text-xs text-foreground">{column}</Text>
            </View>
          ))}
        </View>
        {state.report.rows.map((row, rowIndex) => (
          <View
            key={rowIndex}
            className={
              rowIndex < state.report.rows.length - 1
                ? "flex-row border-b border-border"
                : "flex-row"
            }
          >
            {[row.invocation, row.modelReasoning, row.totalTokens, row.elapsed].map(
              (cell, index) => (
                <TaskUsageCell key={index} text={cell} index={index} />
              ),
            )}
          </View>
        ))}
      </View>
      {state.report.notes.map((note, index) => (
        <Text key={index} className="mt-1.5 text-xs text-foreground-muted">
          {note}
        </Text>
      ))}
    </View>
  );
}
