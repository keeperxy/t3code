import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  type ScheduledTask,
} from "@t3tools/contracts";

import { ScheduledTaskRow } from "./ScheduledTasksSettings";

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: ScheduledTaskId.make("scheduled-task:test"),
    title: "Daily review",
    prompt: "Review the open pull requests.",
    enabled: true,
    schedule: { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
    projectId: ProjectId.make("project:test"),
    threadId: null,
    workspaceStrategy: { type: "root" },
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdBy: "user",
    creationSource: "web",
    createdAt: "2026-07-23T08:00:00.000Z",
    updatedAt: "2026-07-23T08:00:00.000Z",
    nextRunAt: "2026-07-24T09:00:00.000Z",
    lastRunAt: null,
    lastRunStatus: "never",
    lastRunError: null,
    runCount: 0,
    ...overrides,
  };
}

function renderTask(task: ScheduledTask, busy = false): string {
  return renderToStaticMarkup(
    <ScheduledTaskRow
      task={task}
      projectTitle="T3 Code"
      busy={busy}
      onRunNow={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onEnabledChange={vi.fn()}
    />,
  );
}

describe("ScheduledTaskRow", () => {
  it("shows project, server-local schedule, and direct pause control", () => {
    const markup = renderTask(makeTask());

    expect(markup).toContain("Project: T3 Code");
    expect(markup).toContain("Weekdays at 09:00 (server time)");
    expect(markup).toContain('aria-label="Pause Daily review"');
  });

  it("offers resume for paused tasks and exposes unavailable projects", () => {
    const task = makeTask({ enabled: false });
    const markup = renderToStaticMarkup(
      <ScheduledTaskRow
        task={task}
        projectTitle="Unavailable project"
        busy={false}
        onRunNow={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onEnabledChange={vi.fn()}
      />,
    );

    expect(markup).toContain("Project: Unavailable project");
    expect(markup).toContain('aria-label="Resume Daily review"');
  });

  it("disables run-now while the task is running", () => {
    const markup = renderTask(makeTask({ lastRunStatus: "running" }));

    expect(markup).toMatch(/aria-label="Run Daily review"[^>]*disabled/);
  });
});
