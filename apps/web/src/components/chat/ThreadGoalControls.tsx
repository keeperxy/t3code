import type {
  OrchestrationV2ThreadGoal,
  OrchestrationV2ThreadGoalStatus,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { CirclePauseIcon, CirclePlayIcon, PencilIcon, TargetIcon, Trash2Icon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { cn } from "~/lib/utils";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

const STATUS_PRESENTATION: Record<
  OrchestrationV2ThreadGoalStatus,
  { readonly label: string; readonly className: string }
> = {
  active: { label: "Active", className: "bg-success/12 text-success" },
  paused: { label: "Paused", className: "bg-muted text-muted-foreground" },
  blocked: { label: "Blocked", className: "bg-warning/12 text-warning" },
  usageLimited: { label: "Usage limited", className: "bg-warning/12 text-warning" },
  budgetLimited: { label: "Budget reached", className: "bg-warning/12 text-warning" },
  complete: { label: "Complete", className: "bg-success/12 text-success" },
};

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function statusLabel(status: OrchestrationV2ThreadGoalStatus): string {
  return STATUS_PRESENTATION[status].label;
}

export function threadGoalMutationDisabled(input: {
  readonly available: boolean;
  readonly busy: boolean;
}): boolean {
  return !input.available || input.busy;
}

export function threadGoalLifecycleAction(status: OrchestrationV2ThreadGoalStatus): {
  readonly label: "Pause" | "Resume" | "Reopen";
  readonly nextStatus: "active" | "paused";
} {
  if (status === "active") return { label: "Pause", nextStatus: "paused" };
  if (status === "complete") return { label: "Reopen", nextStatus: "active" };
  return { label: "Resume", nextStatus: "active" };
}

export function ThreadGoalStatusBadge(props: {
  status: OrchestrationV2ThreadGoalStatus;
  className?: string;
}) {
  const presentation = STATUS_PRESENTATION[props.status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
        presentation.className,
        props.className,
      )}
    >
      {presentation.label}
    </span>
  );
}

export function ThreadGoalHeaderBadge(props: {
  goal: OrchestrationV2ThreadGoal;
  onOpen: () => void;
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      className="min-w-0 max-w-64 gap-1.5 rounded-full px-2"
      aria-label={`Open thread goal: ${props.goal.objective}`}
      title={props.goal.objective}
      onClick={props.onOpen}
    >
      <TargetIcon className="size-3.5 shrink-0" />
      <span className="truncate">{props.goal.objective}</span>
      <ThreadGoalStatusBadge status={props.goal.status} />
    </Button>
  );
}

export function ThreadGoalDialog(props: {
  open: boolean;
  goal: OrchestrationV2ThreadGoal | null;
  available: boolean;
  unavailableReason: string | null;
  busy: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: (input: { objective: string; tokenBudget: number | null }) => Promise<boolean>;
}) {
  const objectiveId = useId();
  const tokenBudgetId = useId();
  const [objective, setObjective] = useState(props.goal?.objective ?? "");
  const [tokenBudget, setTokenBudget] = useState(
    props.goal?.tokenBudget === null || props.goal?.tokenBudget === undefined
      ? ""
      : String(props.goal.tokenBudget),
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const mutationDisabled = threadGoalMutationDisabled({
    available: props.available,
    busy: props.busy,
  });

  useEffect(() => {
    if (!props.open) return;
    setObjective(props.goal?.objective ?? "");
    setTokenBudget(
      props.goal?.tokenBudget === null || props.goal?.tokenBudget === undefined
        ? ""
        : String(props.goal.tokenBudget),
    );
    setValidationError(null);
  }, [props.goal, props.open]);

  const submit = async () => {
    if (!props.available) return;
    const normalizedObjective = objective.trim();
    if (normalizedObjective.length === 0) {
      setValidationError("Enter an objective.");
      return;
    }
    const normalizedBudget = tokenBudget.trim();
    const parsedBudget = normalizedBudget.length === 0 ? null : Number(normalizedBudget);
    if (parsedBudget !== null && (!Number.isSafeInteger(parsedBudget) || parsedBudget < 0)) {
      setValidationError("Token budget must be a whole number greater than or equal to zero.");
      return;
    }
    setValidationError(null);
    const saved = await props.onSave({
      objective: normalizedObjective,
      tokenBudget: parsedBudget,
    });
    if (saved) props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !props.busy && props.onOpenChange(open)}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{props.goal ? "Edit thread goal" : "Set thread goal"}</DialogTitle>
          <DialogDescription>
            Codex tracks this objective natively without adding a chat message or starting a run.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={objectiveId} className="text-sm font-medium">
              Objective
            </label>
            <Textarea
              id={objectiveId}
              autoFocus
              value={objective}
              disabled={mutationDisabled}
              placeholder="Describe the outcome this thread should pursue."
              onChange={(event) => setObjective(event.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={tokenBudgetId} className="text-sm font-medium">
              Token budget <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input
              id={tokenBudgetId}
              nativeInput
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={tokenBudget}
              disabled={mutationDisabled}
              placeholder="No limit"
              onChange={(event) => setTokenBudget(event.currentTarget.value)}
            />
          </div>
          {props.unavailableReason ? (
            <p role="status" className="text-sm text-muted-foreground">
              {props.unavailableReason}
            </p>
          ) : null}
          {validationError || props.error ? (
            <p role="alert" className="text-sm text-destructive">
              {validationError ?? props.error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={props.busy} />}>
            Cancel
          </DialogClose>
          <Button disabled={mutationDisabled} onClick={() => void submit()}>
            {props.busy ? "Saving..." : props.goal ? "Save goal" : "Set goal"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function ThreadGoalSection(props: {
  goal: OrchestrationV2ThreadGoal | null;
  availability: "available" | "draft" | "unsupported-provider";
  busy: boolean;
  error: string | null;
  onEdit: () => void;
  onStatusChange: (status: "active" | "paused") => void;
  onClear: () => Promise<boolean>;
}) {
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const lifecycleAction = props.goal ? threadGoalLifecycleAction(props.goal.status) : null;
  const unavailableCopy =
    props.availability === "draft"
      ? "Send a first message to create this thread before setting a goal."
      : props.availability === "unsupported-provider"
        ? "Native goals are currently available for Codex threads only."
        : null;

  return (
    <section aria-labelledby="thread-details-goal-heading" className="border-t border-border/65">
      <div className="flex items-center justify-between gap-2 px-3.5 pb-1 pt-3">
        <h3
          id="thread-details-goal-heading"
          className="text-[11px] font-medium text-muted-foreground"
        >
          Goal
        </h3>
        {props.goal ? <ThreadGoalStatusBadge status={props.goal.status} /> : null}
      </div>
      <div className="px-3 pb-3">
        {props.goal ? (
          <div className="space-y-3 rounded-xl border border-border/70 bg-foreground/[0.025] p-3">
            <p className="text-sm leading-relaxed text-foreground">{props.goal.objective}</p>
            {unavailableCopy ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{unavailableCopy}</p>
            ) : null}
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
              <div>
                <dt className="text-muted-foreground">Tokens</dt>
                <dd className="font-medium">
                  {compactNumber(props.goal.tokensUsed)}
                  {props.goal.tokenBudget === null
                    ? ""
                    : ` / ${compactNumber(props.goal.tokenBudget)}`}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Time</dt>
                <dd className="font-medium">{formatDuration(props.goal.timeUsedSeconds)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Budget</dt>
                <dd className="font-medium">
                  {props.goal.tokenBudget === null
                    ? "No token limit"
                    : `${compactNumber(props.goal.tokenBudget)} tokens`}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Updated</dt>
                <dd className="font-medium">
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(DateTime.formatIso(props.goal.updatedAt)))}
                </dd>
              </div>
            </dl>
            {props.error ? (
              <p role="alert" className="text-xs text-destructive">
                {props.error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="xs"
                variant="outline"
                disabled={props.busy || props.availability !== "available"}
                title={unavailableCopy ?? undefined}
                onClick={props.onEdit}
              >
                <PencilIcon className="size-3.5" />
                Edit
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={props.busy || props.availability !== "available"}
                title={unavailableCopy ?? undefined}
                onClick={() => lifecycleAction && props.onStatusChange(lifecycleAction.nextStatus)}
              >
                {lifecycleAction?.nextStatus === "active" ? (
                  <CirclePlayIcon className="size-3.5" />
                ) : (
                  <CirclePauseIcon className="size-3.5" />
                )}
                {lifecycleAction?.label}
              </Button>
              <Button
                size="xs"
                variant="destructive-outline"
                disabled={props.busy || props.availability !== "available"}
                title={unavailableCopy ?? undefined}
                onClick={() => setClearConfirmOpen(true)}
              >
                <Trash2Icon className="size-3.5" />
                Clear
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/70 p-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {unavailableCopy ??
                "Give Codex a durable objective for this thread. Goal commands do not create chat messages or runs."}
            </p>
            <Button
              size="xs"
              variant="outline"
              className="mt-2"
              disabled={props.busy || props.availability !== "available"}
              title={unavailableCopy ?? undefined}
              onClick={props.onEdit}
            >
              <TargetIcon className="size-3.5" />
              Set goal
            </Button>
            {props.error ? (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {props.error}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <AlertDialog
        open={clearConfirmOpen}
        onOpenChange={(open) => {
          if (!props.busy) setClearConfirmOpen(open);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this thread goal?</AlertDialogTitle>
            <AlertDialogDescription>
              Codex will stop tracking &quot;{props.goal?.objective ?? "this objective"}&quot;. The
              conversation remains unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" disabled={props.busy} />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={props.busy}
              onClick={() => {
                void props.onClear().then((cleared) => {
                  if (cleared) setClearConfirmOpen(false);
                });
              }}
            >
              {props.busy ? "Clearing..." : "Clear goal"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </section>
  );
}

export { statusLabel };
