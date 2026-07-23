import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ScheduledTaskSchedule,
} from "@t3tools/contracts";

export type ScheduledTaskScheduleMode = "fixed" | "interval";

export interface ScheduledTaskScheduleDraft {
  readonly scheduleMode: ScheduledTaskScheduleMode;
  readonly intervalMinutes: string;
  readonly timeOfDay: string;
  readonly weekdays: ReadonlySet<number>;
}

export interface ScheduledTaskProjectOption {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly title: string;
  readonly defaultModelSelection: ModelSelection | null;
}

export interface ScheduledTaskModelChoice {
  readonly modelKey: string;
  readonly baseModelSelection: ModelSelection | null;
  readonly modelExplicitlySelected: boolean;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function modelSelectionKey(selection: ModelSelection): string {
  return `${selection.instanceId}:${selection.model}`;
}

export function filterScheduledTaskProjects<T extends { readonly environmentId: EnvironmentId }>(
  projects: ReadonlyArray<T>,
  environmentId: EnvironmentId | null,
): ReadonlyArray<T> {
  if (environmentId === null) return [];
  return projects.filter((project) => project.environmentId === environmentId);
}

export function projectModelSelection(
  projects: ReadonlyArray<Pick<ScheduledTaskProjectOption, "id" | "defaultModelSelection">>,
  projectId: string,
  fallback: ModelSelection | null,
): ModelSelection | null {
  return projects.find((project) => project.id === projectId)?.defaultModelSelection ?? fallback;
}

export function adoptProjectModelSelection(
  current: ScheduledTaskModelChoice,
  selection: ModelSelection | null,
): ScheduledTaskModelChoice {
  if (current.modelExplicitlySelected) return current;
  return {
    modelKey: selection === null ? "" : modelSelectionKey(selection),
    baseModelSelection: selection,
    modelExplicitlySelected: false,
  };
}

export function scheduleFromDraft(draft: ScheduledTaskScheduleDraft): ScheduledTaskSchedule {
  if (draft.scheduleMode === "interval") {
    const minutes = Math.max(1, Number.parseInt(draft.intervalMinutes, 10) || 1);
    return { type: "interval", everyMs: minutes * 60_000 };
  }
  const selectedEveryDay = draft.weekdays.size === 0 || draft.weekdays.size === 7;
  return {
    type: "fixed_time",
    timeOfDay: draft.timeOfDay || "09:00",
    ...(selectedEveryDay ? {} : { weekdays: [...draft.weekdays].toSorted() }),
  };
}

export function scheduleLabel(schedule: ScheduledTaskSchedule): string {
  if (schedule.type === "interval") {
    const minutes = schedule.everyMs / 60_000;
    return Number.isInteger(minutes)
      ? `Every ${minutes} min`
      : `Every ${Math.round(schedule.everyMs / 1000)} sec`;
  }
  const weekdays = schedule.weekdays ?? [];
  const days =
    weekdays.length === 0
      ? "Daily"
      : weekdays.length === 5 && weekdays.every((day) => day >= 1 && day <= 5)
        ? "Weekdays"
        : weekdays.map((day) => WEEKDAY_LABELS[day]).join(", ");
  return `${days} at ${schedule.timeOfDay} (server time)`;
}

export type ScheduledTasksViewState = "disconnected" | "loading" | "error" | "empty" | "ready";

export function scheduledTasksViewState(input: {
  readonly hasEnvironment: boolean;
  readonly dataLoaded: boolean;
  readonly error: string | null;
  readonly taskCount: number;
}): ScheduledTasksViewState {
  if (!input.hasEnvironment) return "disconnected";
  if (input.error !== null) return "error";
  if (!input.dataLoaded) return "loading";
  if (input.taskCount === 0) return "empty";
  return "ready";
}
