import type { ProviderDriverKind } from "@t3tools/contracts";

export type ThreadGoalSlashCommand =
  | { readonly type: "open" }
  | { readonly type: "edit" }
  | { readonly type: "set"; readonly objective: string }
  | { readonly type: "pause" }
  | { readonly type: "resume" }
  | { readonly type: "clear" };

export type ThreadGoalSubmissionResolution =
  | { readonly type: "normal-send" }
  | { readonly type: "unsupported"; readonly reason: string }
  | { readonly type: "goal-command"; readonly command: ThreadGoalSlashCommand };

export function parseThreadGoalSlashCommand(prompt: string): ThreadGoalSlashCommand | null {
  const match = /^\/goal(?:\s+(.*))?$/i.exec(prompt.trim());
  if (!match) return null;

  const argument = (match[1] ?? "").trim();
  if (argument.length === 0) return { type: "open" };

  switch (argument.toLowerCase()) {
    case "edit":
      return { type: "edit" };
    case "pause":
      return { type: "pause" };
    case "resume":
      return { type: "resume" };
    case "clear":
      return { type: "clear" };
    default:
      return { type: "set", objective: argument };
  }
}

export function resolveThreadGoalSubmission(input: {
  readonly prompt: string;
  readonly hasAdditionalContent: boolean;
  readonly isMaterializedThread: boolean;
  readonly provider: ProviderDriverKind;
}): ThreadGoalSubmissionResolution {
  const command = parseThreadGoalSlashCommand(input.prompt);
  if (command === null || input.hasAdditionalContent) {
    return { type: "normal-send" };
  }
  if (!input.isMaterializedThread) {
    return {
      type: "unsupported",
      reason: "Send a first message to create this thread before setting a goal.",
    };
  }
  if (input.provider !== "codex") {
    return {
      type: "unsupported",
      reason: "Native thread goals are currently available for Codex threads only.",
    };
  }
  return { type: "goal-command", command };
}

export function canShowThreadGoalComposerCommand(input: {
  readonly isMaterializedThread: boolean;
  readonly provider: ProviderDriverKind;
}): boolean {
  return input.isMaterializedThread && input.provider === "codex";
}
