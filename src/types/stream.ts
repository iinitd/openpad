export type StreamItem =
  | UserMessageItem
  | AssistantMessageItem
  | ThoughtItem
  | ToolCallItem
  | ErrorMessageItem;

export interface UserMessageItem {
  kind: "user_message";
  id: string;
  messageId?: string;
  text: string;
  /** Attached images as data URIs, in the order they were chosen. */
  images?: string[];
  timestamp: string;
  optimistic?: boolean;
}

export interface AssistantMessageItem {
  kind: "assistant_message";
  id: string;
  messageId?: string;
  text: string;
  timestamp: string;
}

export interface ThoughtItem {
  kind: "thought";
  id: string;
  text: string;
  timestamp: string;
  status: "loading" | "ready";
}

export interface ToolCallItem {
  kind: "tool_call";
  id: string;
  name: string;
  status: "running" | "completed" | "failed";
  timestamp: string;
  /** Optional detail shown in activity UI (e.g. shell command, file path, args). */
  detail?: string;
  input?: unknown;
}

export interface ErrorMessageItem {
  kind: "error";
  id: string;
  message: string;
  timestamp: string;
}
