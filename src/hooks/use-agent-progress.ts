import { useShallow } from "zustand/react/shallow";
import { useSessionStore } from "../stores/session-store";
import type { StreamItem, ThoughtItem, ToolCallItem } from "../types/stream";

type ActivityItem = ThoughtItem | ToolCallItem;

export interface ActivitySummary {
  /** The newest action, named as it is: "Thinking" or the command. */
  label: string;
  /** How many reasoning/tool steps this run contains. */
  steps: number;
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

function toolPreview(item: ToolCallItem): string {
  if (item.detail?.trim()) return oneLine(item.detail);
  const input = item.input as Record<string, unknown> | undefined;
  if (input && typeof input === "object") {
    for (const key of ["command", "cmd", "filePath", "path", "file", "pattern", "query", "url", "description"]) {
      const value = input[key];
      if (typeof value === "string" && value.trim()) return oneLine(value);
    }
  }
  return "";
}

/**
 * Summarise one continuous run of reasoning and tool calls. Shared by the
 * transcript's activity row and the document banners so they describe a turn
 * in the same words: the newest action as the label, and the most recent
 * reasoning or tool detail as the preview.
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
  const latestToolDetail = latest.kind === "tool_call" ? toolPreview(latest) : "";
  const lastToolDetail = [...items]
    .reverse()
    .map((entry) => (entry.kind === "tool_call" ? toolPreview(entry) : ""))
    .find((value) => value.length > 0);

  return {
    label: latest.kind === "thought" ? "Thinking" : latest.name,
    steps: items.length,
    preview:
      latest.kind === "tool_call"
        ? latestToolDetail || (lastThought ? oneLine(lastThought.text) : lastToolDetail ?? "")
        : lastThought
          ? oneLine(lastThought.text)
          : lastToolDetail ?? "",
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
 * Live summary of the current turn for the document banners: label, step count
 * and reasoning preview, straight from the same function the transcript row
 * uses.
 */
export function useAgentActivitySummary(): ActivitySummary | null {
  return useSessionStore(
    useShallow((state) =>
      // The run can straddle the committed tail and the streaming head, so read
      // the timeline as one list; the split is an internal rendering detail.
      summarizeActivity(trailingRun([...state.tail, ...state.head])),
    ),
  );
}

/**
 * The same summary flattened to a single line, for banners that only have room
 * for one paragraph: "Thinking  <snippet>" or just the command name.
 */
export function useAgentProgressSummary(): string | null {
  const summary = useAgentActivitySummary();
  if (!summary) return null;
  return summary.preview ? `${summary.label}  ${summary.preview}` : summary.label;
}
