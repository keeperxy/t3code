import { ProviderThreadId, ThreadId, OrchestrationV2ThreadGoal } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  ThreadGoalHeaderBadge,
  ThreadGoalSection,
  statusLabel,
  threadGoalLifecycleAction,
  threadGoalMutationDisabled,
} from "./ThreadGoalControls";

const goal: OrchestrationV2ThreadGoal = {
  threadId: ThreadId.make("thread:test"),
  providerThreadId: ProviderThreadId.make("provider-thread:test"),
  objective: "Ship the nightly integration",
  status: "active",
  tokenBudget: 50_000,
  tokensUsed: 12_500,
  timeUsedSeconds: 5_400,
  createdAt: Option.getOrThrow(DateTime.make("2026-07-23T08:00:00.000Z")),
  updatedAt: Option.getOrThrow(DateTime.make("2026-07-23T09:00:00.000Z")),
};

describe("ThreadGoalControls", () => {
  it("renders a clickable header badge with objective and status", () => {
    const markup = renderToStaticMarkup(<ThreadGoalHeaderBadge goal={goal} onOpen={vi.fn()} />);
    expect(markup).toContain("Ship the nightly integration");
    expect(markup).toContain("Active");
    expect(markup).toContain('aria-label="Open thread goal: Ship the nightly integration"');
  });

  it("shows objective, usage, budget, time, and lifecycle actions", () => {
    const markup = renderToStaticMarkup(
      <ThreadGoalSection
        goal={goal}
        availability="available"
        busy={false}
        error={null}
        onEdit={vi.fn()}
        onStatusChange={vi.fn()}
        onClear={vi.fn(async () => true)}
      />,
    );
    expect(markup).toContain("Ship the nightly integration");
    expect(markup).toContain("12.5K / 50K");
    expect(markup).toContain("1h 30m");
    expect(markup).toContain("Edit");
    expect(markup).toContain("Pause");
    expect(markup).toContain("Clear");
  });

  it("disables goal creation with explicit draft and provider guidance", () => {
    const draftMarkup = renderToStaticMarkup(
      <ThreadGoalSection
        goal={null}
        availability="draft"
        busy={false}
        error={null}
        onEdit={vi.fn()}
        onStatusChange={vi.fn()}
        onClear={vi.fn(async () => true)}
      />,
    );
    const providerMarkup = renderToStaticMarkup(
      <ThreadGoalSection
        goal={null}
        availability="unsupported-provider"
        busy={false}
        error={null}
        onEdit={vi.fn()}
        onStatusChange={vi.fn()}
        onClear={vi.fn(async () => true)}
      />,
    );
    expect(draftMarkup).toContain("Send a first message");
    expect(draftMarkup).toMatch(/disabled[^>]*>.*Set goal/s);
    expect(providerMarkup).toContain("Codex threads only");
  });

  it("keeps an existing goal visible but disables mutation after a provider handoff", () => {
    const markup = renderToStaticMarkup(
      <ThreadGoalSection
        goal={goal}
        availability="unsupported-provider"
        busy={false}
        error={null}
        onEdit={vi.fn()}
        onStatusChange={vi.fn()}
        onClear={vi.fn(async () => true)}
      />,
    );
    expect(markup).toContain("Ship the nightly integration");
    expect(markup).toContain("Codex threads only");
    expect(markup).toMatch(/disabled[^>]*>.*Edit/s);
    expect(markup).toMatch(/disabled[^>]*>.*Pause/s);
    expect(markup).toMatch(/disabled[^>]*>.*Clear/s);
  });

  it("disables the editor while busy or after goal capability becomes unavailable", () => {
    expect(threadGoalMutationDisabled({ available: true, busy: false })).toBe(false);
    expect(threadGoalMutationDisabled({ available: true, busy: true })).toBe(true);
    expect(threadGoalMutationDisabled({ available: false, busy: false })).toBe(true);
  });

  it("covers every provider goal status label", () => {
    expect(
      (["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"] as const).map(
        statusLabel,
      ),
    ).toEqual(["Active", "Paused", "Blocked", "Usage limited", "Budget reached", "Complete"]);
  });

  it("maps every provider status to an explicit lifecycle action", () => {
    expect(threadGoalLifecycleAction("active")).toEqual({
      label: "Pause",
      nextStatus: "paused",
    });
    for (const status of ["paused", "blocked", "usageLimited", "budgetLimited"] as const) {
      expect(threadGoalLifecycleAction(status)).toEqual({
        label: "Resume",
        nextStatus: "active",
      });
    }
    expect(threadGoalLifecycleAction("complete")).toEqual({
      label: "Reopen",
      nextStatus: "active",
    });

    for (const status of [
      "active",
      "paused",
      "blocked",
      "usageLimited",
      "budgetLimited",
      "complete",
    ] as const) {
      const markup = renderToStaticMarkup(
        <ThreadGoalSection
          goal={{ ...goal, status }}
          availability="available"
          busy={false}
          error={null}
          onEdit={vi.fn()}
          onStatusChange={vi.fn()}
          onClear={vi.fn(async () => true)}
        />,
      );
      expect(markup).toContain(statusLabel(status));
      expect(markup).toContain(threadGoalLifecycleAction(status).label);
    }
  });
});
