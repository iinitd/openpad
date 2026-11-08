import { useShallow } from "zustand/react/shallow";
import { useSessionStore } from "../stores/session-store";
import type { StreamItem, ThoughtItem, ToolCallItem } from "../types/stream";

type ActivityItem = ThoughtItem | ToolCallItem;

export interface ActivitySummary {
  /** The newest action, named as it is: "Thinking" or the command. */
  label: string;
  /** The last thing the agent reasoned about in this run, if anything. */
  preview: string;
}

// Collapse whitespace/newlines and clip to a short legible line for a banner.
function oneLine(text: string, max = 140): string {
  let flat = "";
  let pendingSpace = false;
  let index = 0;
  for (; index < text.length && flat.length <= max; index++) {
    const char = text[index]!;
    if (/\s/.test(char)) {
      if (flat.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      flat += " ";
      pendingSpace = false;
    }
    flat += char;
  }
  const trimmed = flat.trim();
  if (index >= text.length && trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Summarise one continuous run of reasoning and tool calls. Shared by the
 * transcript's activity row and the document banners so they describe a turn
 * in the same words: the newest action as the label, and the most recent
 * reasoning as the preview. Tool names never stand in for the agent's words.
 */
export function summarizeActivity(items: Array<StreamItem>): ActivitySummary | null {
  if (items.length === 0) return null;
  const latest = items[items.length - 1]!;
  if (latest.kind !== "thought" && latest.kind !== "tool_call") return null;

  const lastThought = [...items]
    .reverse()
    .find(
      (entry): entry is ThoughtItem =>
        entry.kind === "thought" && entry.text.trim().length > 0,
    );

  return {
    label: latest.kind === "thought" ? "Thinking" : latest.name,
    preview: lastThought ? oneLine(lastThought.text) : "",
  };
}

/** The reasoning/tool run that ends at the newest item of the stream. */
function trailingRun(items: StreamItem[]): ActivityItem[] {
  const run: ActivityItem[] = [];
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!;
    if (item.kind !== "thought" && item.kind !== "tool_call") break;
    run.unshift(item);
  }
  return run;
}

/**
 * Live summary of the current turn for the document banners. Returns a single
 * line: "Thinking  <snippet>" or just the command name when nothing was
 * reasoned about yet.
 */
export function useAgentProgressSummary(): string | null {
  return useSessionStore(
    useShallow((state) => {
      const source = state.head.length > 0 ? state.head : state.tail;
      const summary = summarizeActivity(trailingRun(source));
      if (!summary) return null;
      return summary.preview ? `${summary.label}  ${summary.preview}` : summary.label;
    }),
  );
}
