import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";

import {
  adoptProjectModelSelection,
  filterScheduledTaskProjects,
  projectModelSelection,
  scheduleFromDraft,
  scheduleLabel,
  scheduledTasksViewState,
} from "./ScheduledTasksSettings.logic";

const environmentA = EnvironmentId.make("environment-a");
const environmentB = EnvironmentId.make("environment-b");
const projectId = ProjectId.make("project-shared");
const fallbackSelection: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
};
const projectSelection: ModelSelection = {
  instanceId: ProviderInstanceId.make("claude"),
  model: "claude-opus-4-6",
  options: [{ id: "thinking", value: "high" }],
};

describe("ScheduledTasksSettings logic", () => {
  it("keeps projects scoped to the selected environment even when ids collide", () => {
    const projects = [
      { environmentId: environmentA, id: projectId, title: "Project A" },
      { environmentId: environmentB, id: projectId, title: "Project B" },
    ];

    expect(filterScheduledTaskProjects(projects, environmentB)).toEqual([projects[1]]);
    expect(filterScheduledTaskProjects(projects, null)).toEqual([]);
  });

  it("uses the project default model and preserves it until the user overrides it", () => {
    const projects = [{ id: projectId, defaultModelSelection: projectSelection }];
    const resolved = projectModelSelection(projects, projectId, fallbackSelection);

    expect(resolved).toBe(projectSelection);
    expect(
      adoptProjectModelSelection(
        { modelKey: "", baseModelSelection: null, modelExplicitlySelected: false },
        resolved,
      ),
    ).toEqual({
      modelKey: "claude:claude-opus-4-6",
      baseModelSelection: projectSelection,
      modelExplicitlySelected: false,
    });

    const explicit = {
      modelKey: "codex:gpt-5.4",
      baseModelSelection: fallbackSelection,
      modelExplicitlySelected: true,
    } as const;
    expect(adoptProjectModelSelection(explicit, projectSelection)).toBe(explicit);
  });

  it("falls back to the environment model when a project has no default", () => {
    expect(
      projectModelSelection(
        [{ id: projectId, defaultModelSelection: null }],
        projectId,
        fallbackSelection,
      ),
    ).toBe(fallbackSelection);
  });

  it("builds interval and fixed schedules and labels fixed times as server-local", () => {
    expect(
      scheduleFromDraft({
        scheduleMode: "interval",
        intervalMinutes: "5",
        timeOfDay: "09:00",
        weekdays: new Set([1]),
      }),
    ).toEqual({ type: "interval", everyMs: 300_000 });
    const fixed = scheduleFromDraft({
      scheduleMode: "fixed",
      intervalMinutes: "5",
      timeOfDay: "13:30",
      weekdays: new Set([1, 2, 3, 4, 5]),
    });
    expect(fixed).toEqual({ type: "fixed_time", timeOfDay: "13:30", weekdays: [1, 2, 3, 4, 5] });
    expect(scheduleLabel(fixed)).toBe("Weekdays at 13:30 (server time)");
  });

  it("distinguishes disconnected, loading, error, empty, and ready states", () => {
    const base = {
      hasEnvironment: true,
      dataLoaded: false,
      error: null,
      taskCount: 0,
    } as const;
    expect(scheduledTasksViewState({ ...base, hasEnvironment: false })).toBe("disconnected");
    expect(scheduledTasksViewState(base)).toBe("loading");
    expect(scheduledTasksViewState({ ...base, error: "boom" })).toBe("error");
    expect(scheduledTasksViewState({ ...base, dataLoaded: true })).toBe("empty");
    expect(scheduledTasksViewState({ ...base, dataLoaded: true, taskCount: 1 })).toBe("ready");
  });
});
