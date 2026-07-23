import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";

import {
  canShowThreadGoalComposerCommand,
  parseThreadGoalSlashCommand,
  resolveThreadGoalSubmission,
} from "./threadGoalLogic";

const codex = ProviderDriverKind.make("codex");
const claude = ProviderDriverKind.make("claude");

describe("parseThreadGoalSlashCommand", () => {
  it("parses the editor and lifecycle commands", () => {
    expect(parseThreadGoalSlashCommand("/goal")).toEqual({ type: "open" });
    expect(parseThreadGoalSlashCommand("/goal edit")).toEqual({ type: "edit" });
    expect(parseThreadGoalSlashCommand("/goal pause")).toEqual({ type: "pause" });
    expect(parseThreadGoalSlashCommand("/goal resume")).toEqual({ type: "resume" });
    expect(parseThreadGoalSlashCommand("/goal clear")).toEqual({ type: "clear" });
  });

  it("treats other arguments as an objective without matching lookalike commands", () => {
    expect(parseThreadGoalSlashCommand("/goal Ship the nightly build")).toEqual({
      type: "set",
      objective: "Ship the nightly build",
    });
    expect(parseThreadGoalSlashCommand("/goalkeeper")).toBeNull();
    expect(parseThreadGoalSlashCommand("Please /goal now")).toBeNull();
  });
});

describe("resolveThreadGoalSubmission", () => {
  it("intercepts a supported goal command instead of sending a message or run", () => {
    expect(
      resolveThreadGoalSubmission({
        prompt: "/goal Complete the native goal UI",
        hasAdditionalContent: false,
        isMaterializedThread: true,
        provider: codex,
      }),
    ).toEqual({
      type: "goal-command",
      command: { type: "set", objective: "Complete the native goal UI" },
    });
  });

  it("keeps attachment and context-bearing goal text on the normal send path", () => {
    expect(
      resolveThreadGoalSubmission({
        prompt: "/goal Complete the native goal UI",
        hasAdditionalContent: true,
        isMaterializedThread: true,
        provider: codex,
      }),
    ).toEqual({ type: "normal-send" });
  });

  it("returns guidance for drafts and non-Codex threads", () => {
    expect(
      resolveThreadGoalSubmission({
        prompt: "/goal",
        hasAdditionalContent: false,
        isMaterializedThread: false,
        provider: codex,
      }),
    ).toMatchObject({ type: "unsupported" });
    expect(
      resolveThreadGoalSubmission({
        prompt: "/goal",
        hasAdditionalContent: false,
        isMaterializedThread: true,
        provider: claude,
      }),
    ).toMatchObject({ type: "unsupported" });
  });

  it("only advertises the built-in command for materialized Codex threads", () => {
    expect(canShowThreadGoalComposerCommand({ isMaterializedThread: true, provider: codex })).toBe(
      true,
    );
    expect(canShowThreadGoalComposerCommand({ isMaterializedThread: false, provider: codex })).toBe(
      false,
    );
    expect(canShowThreadGoalComposerCommand({ isMaterializedThread: true, provider: claude })).toBe(
      false,
    );
  });
});
