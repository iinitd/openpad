import type { BackendTimelineItem } from "../types";
import { isoTime } from "./sessions";
import { asRecord, asString, isRecord } from "./wire";

export interface OpenClawHistoryItem {
  key: string;
  item: BackendTimelineItem;
  timestamp: string;
  /** Canonical transcript ID plus exact run/input custody IDs, never WS seq. */
  aliases: string[];
}

export function messageMetadata(message: unknown): Record<string, unknown> {
  return asRecord(asRecord(message).__openclaw);
}

export function messageText(message: unknown): string {
  const row = asRecord(message);
  if (typeof row.content === "string") return row.content;
  if (Array.isArray(row.content)) return row.content.filter(isRecord).filter((block) => block.type === "text" || block.type === "output_text").map((block) => asString(block.text) ?? "").join("");
  return asString(row.text) ?? "";
}

export function messageId(message: unknown, envelope?: Record<string, unknown>): string | undefined {
  const row = asRecord(message);
  return asString(envelope?.messageId) ?? asString(messageMetadata(message).id) ?? asString(row.id);
}

/** The gateway suffixes persisted user receipts; Clacko keeps the original send ID. */
export function inputMessageId(message: unknown, envelope?: Record<string, unknown>): string | undefined {
  const meta = messageMetadata(message);
  const input = asString(meta.idempotencyKey) ?? asString(asRecord(message).idempotencyKey) ?? asString(envelope?.idempotencyKey);
  return input?.endsWith(":user") ? input.slice(0, -5) : input;
}

export function messageAliases(message: unknown, envelope?: Record<string, unknown>): string[] {
  const meta = messageMetadata(message);
  const id = messageId(message, envelope);
  const input = inputMessageId(message, envelope);
  const runId = asRecord(message).role === "assistant" ? asString(meta.runId) : undefined;
  return [...(id ? [`message:${id}`] : []), ...(input ? [`input:${input}`] : []), ...(runId ? [`run:${runId}`] : [])];
}

/** Convert provider-neutral transcript content without leaking OpenClaw envelopes. */
export function projectMessage(message: unknown, fallbackKey: string, envelope?: Record<string, unknown>): OpenClawHistoryItem[] {
  const row = asRecord(message);
  if (row.display === false || row.role === "system" || row.customType !== undefined) return [];
  const id = messageId(message, envelope);
  const aliases = messageAliases(message, envelope);
  const prefix = id ? `message:${id}` : fallbackKey;
  const timestamp = isoTime(row.timestamp ?? envelope?.ts ?? messageMetadata(message).timestamp);
  const make = (item: BackendTimelineItem, suffix: string): OpenClawHistoryItem => ({ key: `${prefix}:${suffix}`, item, timestamp, aliases });
  if (row.role === "user") {
    const receiptId = inputMessageId(message, envelope) ?? id;
    return [make({ type: "user_message", text: messageText(row), ...(receiptId ? { messageId: receiptId } : {}) }, "user")];
  }
  if (row.role === "toolResult" || row.role === "tool") {
    const callId = asString(row.toolCallId) ?? asString(row.tool_call_id);
    return [make({ type: "tool_call", callId, name: asString(row.toolName) ?? asString(row.name) ?? "tool", status: row.isError === true || row.status === "error" ? "failed" : "completed" }, `tool:${callId ?? "result"}`)];
  }
  if (row.role !== "assistant") return [];
  const content = Array.isArray(row.content) ? row.content : [{ type: "text", text: messageText(row) }];
  const items: OpenClawHistoryItem[] = [];
  content.forEach((raw, index) => {
    const block = asRecord(raw);
    if (block.type === "text" || block.type === "output_text") {
      const text = asString(block.text) ?? "";
      if (text) items.push(make({ type: "assistant_message", text, ...(id ? { messageId: id } : {}) }, `text:${index}`));
    } else if (block.type === "thinking" || block.type === "reasoning") {
      const text = asString(block.thinking) ?? asString(block.text) ?? "";
      if (text) items.push(make({ type: "reasoning", text }, `reasoning:${index}`));
    } else if (block.type === "toolCall" || block.type === "tool_use" || block.type === "function_call") {
      const callId = asString(block.id) ?? asString(block.callId);
      items.push(make({ type: "tool_call", callId, name: asString(block.name) ?? "tool", status: "running" }, `tool:${callId ?? index}`));
    }
  });
  if (row.stopReason === "error" && typeof row.errorMessage === "string") items.push(make({ type: "error", message: row.errorMessage }, "error"));
  return items;
}

export function projectHistory(messages: unknown[]): OpenClawHistoryItem[] {
  return messages.flatMap((raw, index) => {
    // Cursor catch-up payloads are session.message envelopes; tail pages contain messages.
    const row = asRecord(raw);
    return isRecord(row.message) && typeof row.sessionKey === "string"
      ? projectMessage(row.message, `history:${index}`, row)
      : projectMessage(raw, `history:${index}`);
  });
}

export function sameHistoryItem(left: OpenClawHistoryItem, right: OpenClawHistoryItem): boolean {
  if (left.item.type !== right.item.type) return false;
  if (left.item.type === "tool_call" && right.item.type === "tool_call") return Boolean(left.item.callId && left.item.callId === right.item.callId);
  if (left.key === right.key) return true;
  const leftId = left.aliases.find((alias) => alias.startsWith("message:"));
  const rightId = right.aliases.find((alias) => alias.startsWith("message:"));
  // Distinct canonical transcript occurrences (including content blocks in
  // one message) must remain separate even when they share a run/input receipt.
  if (leftId && rightId) return false;
  // A terminal snapshot may be revised before commit. Exact idempotency custody
  // identifies that occurrence without assuming its text or run ID is stable.
  const sameInput = left.aliases.some((alias) => alias.startsWith("input:") && right.aliases.includes(alias));
  if (sameInput) return true;
  const identity = left.aliases.some((alias) => right.aliases.includes(alias));
  if (!identity) return false;
  // A turn can contain several assistant entries; the idempotency receipt alone
  // is insufficient to collapse different texts or different reasoning blocks.
  if ((left.item.type === "assistant_message" && right.item.type === "assistant_message") || (left.item.type === "reasoning" && right.item.type === "reasoning")) {
    return left.item.text === right.item.text || right.item.text.startsWith(left.item.text) || left.item.text.startsWith(right.item.text);
  }
  return true;
}
