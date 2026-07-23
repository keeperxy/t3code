import type { EnvironmentId } from "@t3tools/contracts";
import { memo } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProjectFavicon } from "../ProjectFavicon";
import { cn } from "~/lib/utils";

interface ChatHeaderProps {
  activeThreadTitle: string;
  activeThreadEnvironmentId?: EnvironmentId;
  activeProjectName?: string;
  activeProjectCwd?: string | null;
  rightPanelOpen: boolean;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadTitle,
  activeThreadEnvironmentId,
  activeProjectName,
  activeProjectCwd,
  rightPanelOpen,
}: ChatHeaderProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 sm:gap-3",
        rightPanelOpen ? "pr-10" : "pr-24",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        {/* The project always leads the header: knowing which project a
            thread lives in is priority zero, and the thread title alone
            doesn't answer it. */}
        {activeProjectName ? (
          <span className="inline-flex shrink-0 items-center gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {activeThreadEnvironmentId ? (
                <ProjectFavicon
                  environmentId={activeThreadEnvironmentId}
                  cwd={activeProjectCwd ?? ""}
                  className="size-3.5"
                />
              ) : null}
              <span className="max-w-40 truncate text-sm font-medium text-muted-foreground">
                {activeProjectName}
              </span>
            </span>
            <span aria-hidden className="text-muted-foreground/40">
              /
            </span>
          </span>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <h2
                aria-label={activeThreadTitle}
                className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
              >
                {activeThreadTitle}
              </h2>
            }
          />
          <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});
