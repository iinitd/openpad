/**
 * Simplified head/tail stream reducer for Clacko.
 * Adapted from Paseo's packages/app/src/types/stream.ts
 *
 * - Tail: committed history items
 * - Head: active streaming items
 * - Streamable items (assistant_message, thought) → head
 * - Non-streamable items (user_message, tool_call, error) → flush head to tail, then append to tail
 * - Turn completion events → flush all head to tail
 */

import type { BackendStreamEvent } from "../backend";
import type {
  StreamItem,
  UserMessageItem,
  AssistantMessageItem,
  ThoughtItem,
  ToolCallItem,
  ErrorMessageItem,
} from "../types/stream";

const STREAMABLE_KINDS = new Set<StreamItem["kind"]>(["assistant_message", "thought"]);

function isStreamableKind(kind: StreamItem["kind"]): kind is "assistant_message" | "thought" {
  return STREAMABLE_KINDS.has(kind);
}

// ---------------------------------------------------------------------------
// Reducer: timeline event → StreamItem[]
// ---------------------------------------------------------------------------

function reduceTimelineEvent(
  state: StreamItem[],
  event: Extract<BackendStreamEvent, { type: "timeline" }>,
): StreamItem[] {
  const item = event.item;

  switch (item.type) {
    case "user_message": {
      const id = item.messageId
        ? `user-${item.messageId}`
        : `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const existingIdx = state.findIndex((existing) => existing.id === id);
      if (existingIdx !== -1) {
        return state.map((existing, index) =>
          index === existingIdx && existing.kind === "user_message"
            ? {
                ...existing,
                text: item.text || existing.text,
                messageId: item.messageId,
                // The live echo has no attachments; keep the ones the optimistic
                // row was created with.
                images: item.images ?? existing.images,
                optimistic: false,
              }
            : existing,
        );
      }
      return [
        ...state,
        {
          kind: "user_message",
          id,
          messageId: item.messageId,
          text: item.text,
          images: item.images,
          timestamp: new Date().toISOString(),
        } satisfies UserMessageItem,
      ];
    }

    case "assistant_message":
      return reduceAssistantMessage(state, item.text, item.messageId, item.replace);

    case "reasoning":
      return reduceThought(state, item.text);

    case "tool_call": {
      const id = item.callId ?? `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const status: ToolCallItem["status"] =
        item.status === "completed" ? "completed" : item.status === "failed" ? "failed" : "running";
      // The daemon emits the same call id multiple times (running → completed).
      // Update the existing row in place instead of appending a duplicate, which
      // would otherwise collide on React keys once grouped.
      const existingIdx = state.findIndex((s) => s.kind === "tool_call" && s.id === id);
      if (existingIdx !== -1) {
        const existing = state[existingIdx] as ToolCallItem;
        return state.map((s, i) =>
          i === existingIdx
            ? {
                ...existing,
                name: item.name ?? existing.name,
                status,
                detail: item.detail ?? existing.detail,
                input: item.input ?? existing.input,
              }
            : s,
        );
      }
      return [
        ...state,
        {
          kind: "tool_call",
          id,
          name: item.name,
          status,
          timestamp: new Date().toISOString(),
          ...(item.detail ? { detail: item.detail } : {}),
          ...(item.input !== undefined ? { input: item.input } : {}),
        } satisfies ToolCallItem,
      ];
    }

    case "error":
      return [
        ...state,
        {
          kind: "error",
          id: `error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          message: item.message,
          timestamp: new Date().toISOString(),
        } satisfies ErrorMessageItem,
      ];

    default:
      return state;
  }
}

function reduceAssistantMessage(
  state: StreamItem[],
  text: string,
  messageId?: string,
  replace = false,
): StreamItem[] {
  if (replace && messageId) {
    const index = state.findIndex((item) => item.kind === "assistant_message" && item.messageId === messageId);
    if (index >= 0) return state.map((item, position) => position === index ? { ...item, text } as AssistantMessageItem : item);
  }
  // Append to last assistant message if it exists
  const lastItem = state[state.length - 1];
  if (lastItem && lastItem.kind === "assistant_message" &&
      (!messageId || !lastItem.messageId || lastItem.messageId === messageId)) {
    return [
      ...state.slice(0, -1),
      { ...lastItem, text: replace ? text : lastItem.text + text, messageId: messageId ?? lastItem.messageId },
    ];
  }

  return [
    ...state,
    {
      kind: "assistant_message",
      id: `asst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      messageId,
      text,
      timestamp: new Date().toISOString(),
    } satisfies AssistantMessageItem,
  ];
}

function reduceThought(state: StreamItem[], text: string): StreamItem[] {
  // Append to last thought if it exists and is still loading
  const lastItem = state[state.length - 1];
  if (lastItem && lastItem.kind === "thought" && lastItem.status === "loading") {
    return [...state.slice(0, -1), { ...lastItem, text: lastItem.text + text }];
  }

  // Finalize any previous loading thought
  const finalized = state.map((item) =>
    item.kind === "thought" && item.status === "loading" ? { ...item, status: "ready" as const } : item,
  );

  return [
    ...finalized,
    {
      kind: "thought",
      id: `thought-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      timestamp: new Date().toISOString(),
      status: "loading",
    } satisfies ThoughtItem,
  ];
}

function finalizeActiveThoughts(state: StreamItem[]): StreamItem[] {
  return state.map((item) =>
    item.kind === "thought" && item.status === "loading" ? { ...item, status: "ready" as const } : item,
  );
}

// ---------------------------------------------------------------------------
// Public: reduceStreamUpdate
// ---------------------------------------------------------------------------

export function reduceStreamUpdate(
  state: StreamItem[],
  event: BackendStreamEvent,
): StreamItem[] {
  switch (event.type) {
    case "timeline":
      return reduceTimelineEvent(state, event);
    case "thread_started":
    case "turn_started":
    case "turn_completed":
    case "turn_failed":
    case "turn_canceled":
    case "permission_requested":
    case "permission_resolved":
    case "attention_required":
      return finalizeActiveThoughts(state);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Head/Tail model
// ---------------------------------------------------------------------------

export interface ApplyStreamEventResult {
  tail: StreamItem[];
  head: StreamItem[];
  changedTail: boolean;
  changedHead: boolean;
}

function shouldFlushHead(head: StreamItem[], incomingKind: StreamItem["kind"] | null): boolean {
  if (head.length === 0) return false;
  if (incomingKind === null) return false;
  if (!isStreamableKind(incomingKind)) return true;

  // Find last streamable item in head
  for (let i = head.length - 1; i >= 0; i--) {
    if (isStreamableKind(head[i]?.kind)) {
      return head[i]!.kind !== incomingKind;
    }
  }
  return true;
}

function flushHeadToTail(tail: StreamItem[], head: StreamItem[]): StreamItem[] {
  if (head.length === 0) return tail;
  const finalized = finalizeActiveThoughts(head);
  const tailIds = new Set(tail.map((item) => item.id));
  const newItems = finalized.filter((item) => !tailIds.has(item.id));
  if (newItems.length === 0) return tail;
  return [...tail, ...newItems];
}

function getEventItemKind(event: BackendStreamEvent): StreamItem["kind"] | null {
  if (event.type !== "timeline") return null;
  switch (event.item.type) {
    case "user_message":
      return "user_message";
    case "assistant_message":
      return "assistant_message";
    case "reasoning":
      return "thought";
    case "tool_call":
      return "tool_call";
    case "error":
      return "error";
    default:
      return null;
  }
}

/**
 * Apply a stream event using the head/tail model.
 *
 * - Streamable items (assistant_message, thought) → head
 * - Non-streamable items → flush head to tail first, then append to tail
 * - Turn completion events → flush all head to tail
 */
export function applyStreamEvent(
  tail: StreamItem[],
  head: StreamItem[],
  event: BackendStreamEvent,
): ApplyStreamEventResult {
  if (event.type === "timeline" && event.item.type === "assistant_message" && event.item.replace && event.item.messageId) {
    const { messageId } = event.item;
    const replaceIn = (items: StreamItem[]) => items.some((item) => item.kind === "assistant_message" && item.messageId === messageId);
    if (replaceIn(head)) return { tail, head: reduceTimelineEvent(head, event), changedTail: false, changedHead: true };
    if (replaceIn(tail)) return { tail: reduceTimelineEvent(tail, event), head, changedTail: true, changedHead: false };
  }
  // Turn completion → flush all head to tail
  if (event.type === "turn_completed" || event.type === "turn_failed" || event.type === "turn_canceled") {
    const newTail = flushHeadToTail(tail, head);
    return {
      tail: newTail,
      head: [],
      changedTail: newTail.length !== tail.length,
      changedHead: head.length > 0,
    };
  }

  const incomingKind = getEventItemKind(event);

  // Non-timeline events just finalize thoughts, no flush needed
  if (incomingKind === null) {
    const newHead = finalizeActiveThoughts(head);
    return {
      tail,
      head: newHead,
      changedTail: false,
      changedHead: newHead !== head,
    };
  }

  // Decide whether to flush head to tail
  const flush = shouldFlushHead(head, incomingKind);
  let currentTail = tail;
  let currentHead = head;

  if (flush) {
    currentTail = flushHeadToTail(tail, head);
    currentHead = [];
  }

  // Apply the event to the appropriate buffer
  if (isStreamableKind(incomingKind)) {
    const newHead = reduceStreamUpdate(currentHead, event);
    return {
      tail: currentTail,
      head: newHead,
      changedTail: currentTail !== tail,
      changedHead: true,
    };
  }

  // Non-streamable → append to tail
  const newTail = reduceStreamUpdate(currentTail, event);
  return {
    tail: newTail,
    head: currentHead,
    changedTail: true,
    changedHead: currentHead !== head,
  };
}
