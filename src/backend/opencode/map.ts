import type { BackendTimelineItem } from "../types";
import { asNumber, asRecord, asString, isoTime } from "./wire";

export interface MappedMessage {
  item: BackendTimelineItem;
  timestamp: string;
}

export type MappedPart = MappedMessage;

/** Translate one OpenCode v2 session message into writer timeline items. */
export function mapSessionMessage(raw: unknown): MappedPart[] {
  const message = asRecord(raw);
  const type = asString(message.type);
  const timestamp = isoTime(asRecord(message.time).created);
  const messageId = asString(message.id);

  if (type === "user") {
    const text = asString(message.text) ?? "";
    const images = Array.isArray(message.files)
      ? message.files
          .map((value) => {
            const file = asRecord(value);
            const data = asString(file.data);
            if (!data) return null;
            const mime = asString(file.mime) ?? asString(file.mediaType) ?? "image/jpeg";
            return data.startsWith("data:") ? data : `data:${mime};base64,${data}`;
          })
          .filter((value): value is string => Boolean(value))
      : [];
    // An image-only prompt has no text, and dropping it would lose the message.
    if (!text && images.length === 0) return [];
    return [
      {
        item: {
          type: "user_message",
          text,
          messageId,
          ...(images.length > 0 ? { images } : {}),
        },
        timestamp,
      },
    ];
  }

  if (type === "assistant") {
    const content = Array.isArray(message.content)
      ? message.content
      : Array.isArray(message.parts) ? message.parts : [];
    const parts = content;
    const mapped: MappedPart[] = [];
    let hasText = false;
    let hasReasoning = false;
    parts.forEach((partValue, index) => {
      const part = asRecord(partValue);
      const partType = asString(part.type);
      if (partType === "text") {
        const text = asString(part.text);
        if (text) {
          hasText = true;
          mapped.push({
            item: { type: "assistant_message", text, messageId: `${messageId ?? "assistant"}:t${index}` },
            timestamp,
          });
        }
      } else if (partType === "reasoning" || partType === "thinking") {
        const text = asString(part.text);
        if (text) {
          hasReasoning = true;
          mapped.push({ item: { type: "reasoning", text }, timestamp });
        }
      } else if (partType === "tool" || partType === "tool-invocation") {
        const rawState: unknown = part.state;
        const state = typeof rawState === "string" ? { status: rawState } : asRecord(rawState);
        const status = asString(state.status) ?? asString(part.status);
        const input = asRecord(part.input ?? part.args ?? state.input);
        const command = asString(input.command) ?? asString(input.cmd);
        const detail =
          command ??
          asString(input.filePath) ??
          asString(input.path) ??
          asString(input.pattern) ??
          asString(input.query) ??
          asString(input.url) ??
          asString(input.description);
        const name = asString(part.name) ?? asString(part.tool) ?? "tool";
        mapped.push({
          item: {
            type: "tool_call",
            callId: asString(part.id) ?? asString(part.callId),
            name,
            status: status === "completed" || status === "success" ? "completed"
              : status === "error" || status === "failed" ? "failed"
              : "running",
            ...(detail ? { detail } : {}),
            ...(Object.keys(input).length > 0 ? { input } : {}),
          },
          timestamp: isoTime(asRecord(part.time).created, Date.parse(timestamp)),
        });
      }
    });
    // Some providers/proxies expose a single reasoning string on the message
    // instead of reasoning content parts. Keep those sessions readable too.
    if (!hasReasoning) {
      const reasoning = asString(message.reasoning);
      if (reasoning) mapped.unshift({ item: { type: "reasoning", text: reasoning }, timestamp });
    }
    if (!hasText) {
      const text = asString(message.text);
      if (text) mapped.push({
        item: { type: "assistant_message", text, messageId: `${messageId ?? "assistant"}:t0` },
        timestamp,
      });
    }
    if (message.error) {
      const error = asRecord(message.error);
      const text = asString(error.message) ?? asString(message.finish);
      if (text) mapped.push({ item: { type: "error", message: text }, timestamp });
    }
    return mapped;
  }

  if (type === "idle") {
    const error = asRecord(message.error);
    const text = asString(error.message);
    return text ? [{ item: { type: "error", message: text }, timestamp }] : [];
  }

  if (type === "shell") {
    const status = asString(message.status);
    const command = asString(message.command);
    return [{
      item: {
        type: "tool_call",
        callId: asString(message.shellID) ?? messageId,
        name: "shell",
        status: status === "running" ? "running" : status === "exited" ? "completed" : "failed",
        ...(command ? { detail: command, input: { command } } : {}),
      },
      timestamp,
    }];
  }

  // system/synthetic/skill/compaction/switch markers are not conversation.
  return [];
}

export function sessionTimestamp(info: Record<string, unknown>): { created: string; updated: string } {
  const time = asRecord(info.time);
  const created = asNumber(time.created) ?? Date.now();
  const updated = asNumber(time.updated) ?? asNumber(time.idle) ?? created;
  return { created: new Date(created).toISOString(), updated: new Date(updated).toISOString() };
}

export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.split("/").filter(Boolean).pop() ?? trimmed ?? path;
}
