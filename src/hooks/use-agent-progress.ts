import { useSessionStore } from "../stores/session-store";
import type { StreamItem } from "../types/stream";

// Collapse whitespace/newlines and clip to a single legible line for the banner.
function oneLine(text: string, max = 140): string {
  let flat = "";
  let pendingSpace = false;
  let index = 0;
  // The banner only displays a short prefix. Stop as soon as that prefix is
  // known instead of running a regex over an ever-growing streamed reply.
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

// Find the freshest sign of life in the transcript to show while the agent is
// mid-turn: prefer the assistant's actual reply text, fall back to its current
// thought, and finally to the running tool. `head` holds the streaming items so
// we look there first, then the finalized `tail`.
function latestSummary(items: StreamItem[]): string | null {
  let sawToolCall = false;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === "assistant_message" && item.text.trim()) {
      return oneLine(item.text);
    }
    if (item.kind === "thought" && item.text.trim()) {
      return oneLine(item.text);
    }
    // Tool names say nothing about what the agent is producing, so keep looking
    // for its own words. A turn that is only running commands reads as thinking.
    if (item.kind === "tool_call") {
      sawToolCall = true;
    }
  }
  return sawToolCall ? "Thinking…" : null;
}

// A short, live one-liner summarizing what the agent is doing right now. Drives
// the document-view "revising" banner so the wait shows real progress (the
// streaming reply) instead of a static message. Returns null when there's
// nothing to show yet.
export function useAgentProgressSummary(): string | null {
  return useSessionStore((state) =>
    // Returning the derived string lets Zustand skip the React render once the
    // visible 140-character summary stops changing.
    latestSummary(state.head) ?? latestSummary(state.tail),
  );
}
