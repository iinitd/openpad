import type {
  BackendAgentStreamMessage,
  BackendAttachment,
  BackendAgentTimeline,
  BackendAgentUpdateMessage,
  BackendPermissionRequest,
  BackendPermissionRequestMessage,
  BackendStreamEvent,
  BackendTimelineEntry,
  BackendTimelineItem,
  FetchAgentTimelineOptions,
} from "../types";
import { mapSessionMessage } from "./map";
import type { OpenCodeSessions } from "./sessions";
import type { OpenCodeTransport } from "./transport";
import { asNumber, asRecord, asString } from "./wire";

type Listener<T> = (value: T) => void;

function subscribe<T>(set: Set<Listener<T>>, listener: Listener<T>): () => void {
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

function notify<T>(set: Set<Listener<T>>, value: T): void {
  for (const listener of [...set]) {
    if (!set.has(listener)) continue;
    try {
      listener(value);
    } catch {
      // Isolate subscriber failures.
    }
  }
}

function uniqueId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A message id in the shape the OpenCode server stores for prompts. */
export function openCodeMessageId(): string {
  return `msg_kel_${uniqueId().replace(/-/g, "")}`;
}

interface Journal {
  epoch: string;
  seq: number;
  tools: Map<string, string>;
  reasoningSeen: Set<string>;
}

/** Maps the OpenCode event bus onto the writer's per-conversation stream contract. */
export class OpenCodeEvents {
  private readonly journals = new Map<string, Journal>();
  private readonly streamListeners = new Set<Listener<BackendAgentStreamMessage>>();
  private readonly updateListeners = new Set<Listener<BackendAgentUpdateMessage>>();
  private readonly permissionListeners = new Set<Listener<BackendPermissionRequestMessage>>();
  private readonly permissions = new Map<string, string>();
  private readonly stopEvents: () => void;
  private readonly stopStatus: () => void;
  private closed = false;
  private hadConnected = false;

  constructor(
    private readonly transport: OpenCodeTransport,
    private readonly sessions: OpenCodeSessions,
  ) {
    this.stopEvents = transport.onEvent((event) => this.receive(event));
    this.stopStatus = transport.subscribeConnectionStatus((state) => {
      if (state.status === "connected") {
        if (this.hadConnected) {
          // Events can be lost while the stream is down. Ask every open
          // conversation to reconcile from authoritative message history.
          for (const id of this.journals.keys()) this.invalidate(id);
        }
        this.hadConnected = true;
      }
    });
  }

  onAgentStream(listener: Listener<BackendAgentStreamMessage>): () => void {
    return subscribe(this.streamListeners, listener);
  }

  onAgentUpdate(listener: Listener<BackendAgentUpdateMessage>): () => void {
    return subscribe(this.updateListeners, listener);
  }

  onPermissionRequest(listener: Listener<BackendPermissionRequestMessage>): () => void {
    return subscribe(this.permissionListeners, listener);
  }

  track(id: string): Journal {
    let journal = this.journals.get(id);
    if (!journal) {
      journal = { epoch: `opencode-${uniqueId()}`, seq: 0, tools: new Map(), reasoningSeen: new Set() };
      this.journals.set(id, journal);
    }
    return journal;
  }

  publishAgent(id: string): void {
    const agent = this.sessions.getAgent(id);
    if (agent) notify(this.updateListeners, { agentId: id, agent });
  }

  reportError(id: string, error: unknown): void {
    const message = error instanceof Error && error.message
      ? error.message
      : "OpenCode request failed.";
    this.emit(id, { type: "timeline", item: { type: "error", message } });
    this.status(id, "error");
    this.emit(id, { type: "turn_failed" });
  }

  private journal(id: string): Journal {
    return this.track(id);
  }

  private emit(id: string, event: BackendStreamEvent): void {
    const journal = this.journal(id);
    const seq = ++journal.seq;
    notify(this.streamListeners, { agentId: id, event, epoch: journal.epoch, seq });
  }

  private invalidate(id: string): void {
    this.emit(id, { type: "timeline_invalidated" });
  }

  private status(id: string, status: "idle" | "running" | "error"): void {
    const updated = this.sessions.updateStatus(id, status);
    if (updated) this.publishAgent(id);
  }

  async sendMessage(
    id: string,
    text: string,
    clientMessageId?: string,
    attachments?: BackendAttachment[],
  ): Promise<void> {
    const journal = this.track(id);
    // The server stores the id the prompt carries, so a caller-supplied id is
    // also the history id. Reusing it keeps one key across the optimistic row,
    // the live echo and a later fetch.
    const serverId = clientMessageId ?? openCodeMessageId();
    // OpenCode reads attachments as data URIs; the inline source keeps the bytes
    // in the request instead of pointing at a path the server cannot see.
    const files = attachments?.map((attachment) => ({
      uri: `data:${attachment.mime};base64,${attachment.base64}`,
      name: attachment.name,
      source: { type: "inline" as const },
    }));
    await this.transport.requestJson(`/api/session/${encodeURIComponent(id)}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: serverId,
        text,
        ...(files && files.length > 0 ? { files } : {}),
      }),
    });
    const messageId = serverId;
    this.status(id, "running");
    this.emit(id, { type: "timeline", item: { type: "user_message", text, messageId } });
    journal.tools.clear();
    journal.reasoningSeen.clear();
  }

  private receive(event: Record<string, unknown>): void {
    if (this.closed) return;
    const type = asString(event.type);
    if (!type) return;

    const data = asRecord(event.data);
    if (type === "permission.asked") {
      this.ask(data);
      return;
    }
    if (type === "permission.replied") {
      const id = asString(data.id) ?? asString(asRecord(data.request).id);
      if (!id) return;
      const sessionID = this.permissions.get(id);
      if (sessionID && this.permissions.delete(id)) this.emit(sessionID, { type: "permission_resolved" });
      return;
    }

    const sessionID = asString(data.sessionID) ?? asString(asRecord(data.info).sessionID);
    if (!sessionID || !type.startsWith("session.")) return;

    if (type === "session.created" || type === "session.renamed" ||
      type === "session.archived" || type === "session.unarchived" ||
      type === "session.model.selected" || type === "session.agent.selected" ||
      type === "session.metadata.updated") {
      void this.refreshAgent(sessionID);
      return;
    }

    const assistantMessageID = asString(data.assistantMessageID) ?? "assistant";
    const ordinal = asNumber(data.ordinal) ?? 0;

    switch (type) {
      case "session.execution.started":
        this.status(sessionID, "running");
        this.emit(sessionID, { type: "turn_started" });
        return;
      case "session.execution.succeeded":
        this.status(sessionID, "idle");
        this.emit(sessionID, { type: "turn_completed" });
        this.invalidate(sessionID);
        return;
      case "session.execution.failed": {
        const error = asRecord(data.error);
        const message = asString(error.message) ?? "OpenCode execution failed.";
        this.emit(sessionID, { type: "timeline", item: { type: "error", message } });
        this.status(sessionID, "error");
        this.emit(sessionID, { type: "turn_failed" });
        this.invalidate(sessionID);
        return;
      }
      case "session.execution.interrupted":
        this.status(sessionID, "idle");
        this.emit(sessionID, { type: "turn_canceled" });
        this.invalidate(sessionID);
        return;
      case "session.text.delta": {
        const delta = asString(data.delta);
        if (!delta) return;
        this.emit(sessionID, {
          type: "timeline",
          item: { type: "assistant_message", text: delta, messageId: `${assistantMessageID}:t${ordinal}` },
        });
        return;
      }
      case "session.text.ended": {
        const text = asString(data.text);
        if (text === undefined) return;
        this.emit(sessionID, {
          type: "timeline",
          item: { type: "assistant_message", text, messageId: `${assistantMessageID}:t${ordinal}`, replace: true },
        });
        return;
      }
      case "session.reasoning.delta": {
        const delta = asString(data.delta);
        if (delta) {
          this.journal(sessionID).reasoningSeen.add(`${assistantMessageID}:r${ordinal}`);
          this.emit(sessionID, { type: "timeline", item: { type: "reasoning", text: delta } });
        }
        return;
      }
      case "session.reasoning.ended": {
        // Some providers only send the final reasoning text without deltas.
        const key = `${assistantMessageID}:r${ordinal}`;
        const journal = this.journal(sessionID);
        const text = asString(data.text);
        if (text && !journal.reasoningSeen.has(key)) {
          journal.reasoningSeen.add(key);
          this.emit(sessionID, { type: "timeline", item: { type: "reasoning", text } });
        }
        return;
      }
      case "session.tool.input.started": {
        const callId = asString(data.id);
        const name = asString(data.name) ?? "tool";
        if (callId) this.journal(sessionID).tools.set(callId, name);
        this.emit(sessionID, {
          type: "timeline",
          item: { type: "tool_call", callId, name, status: "running" },
        });
        return;
      }
      case "session.tool.called": {
        const callId = asString(data.id);
        const name = (callId ? this.journal(sessionID).tools.get(callId) : undefined) ?? "tool";
        this.emit(sessionID, {
          type: "timeline",
          item: { type: "tool_call", callId, name, status: "running" },
        });
        return;
      }
      case "session.tool.success":
      case "session.tool.failed": {
        const callId = asString(data.id);
        const name = (callId ? this.journal(sessionID).tools.get(callId) : undefined) ?? "tool";
        this.emit(sessionID, {
          type: "timeline",
          item: {
            type: "tool_call",
            callId,
            name,
            status: type === "session.tool.success" ? "completed" : "failed",
          },
        });
        return;
      }
      default:
        return;
    }
  }

  private async refreshAgent(id: string): Promise<void> {
    try {
      const result = await this.sessions.fetchAgent(id);
      if (result && !this.closed) this.publishAgent(id);
    } catch {
      // A deleted session is reconciled by the catalog refresh.
    }
  }

  private ask(data: Record<string, unknown>): void {
    const request = asRecord(data.request ?? data);
    const id = asString(request.id);
    const sessionID = asString(request.sessionID) ?? asString(data.sessionID);
    if (!id || !sessionID || this.permissions.has(id)) return;
    const permission: BackendPermissionRequest = {
      id,
      actions: [
        { id: "once", behavior: "allow" },
        { id: "reject", behavior: "deny" },
      ],
    };
    this.permissions.set(id, sessionID);
    this.track(sessionID);
    this.emit(sessionID, { type: "permission_requested", request: permission });
    notify(this.permissionListeners, { agentId: sessionID, request: permission });
  }

  async respondToPermission(id: string, requestId: string, decision: "once" | "reject"): Promise<void> {
    const sessionID = this.permissions.get(requestId);
    if (!sessionID || sessionID !== id) {
      throw new Error("This OpenCode permission request is no longer pending for this conversation.");
    }
    await this.transport.requestJson(
      `/api/session/${encodeURIComponent(id)}/permission/${encodeURIComponent(requestId)}/reply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    );
    if (this.permissions.delete(requestId)) this.emit(id, { type: "permission_resolved" });
  }

  async fetchTimeline(id: string, options?: FetchAgentTimelineOptions): Promise<BackendAgentTimeline> {
    await this.sessions.ensureAgent(id);
    const journal = this.track(id);
    const limit = Math.max(1, Math.min(1000, options?.limit ?? 500));
    // Everything emitted after this point is replayed by the writer on top of
    // the snapshot, so the snapshot itself must not also contain assistant
    // messages that were still in flight when capture began.
    const captureSeq = journal.seq;
    const startedAt = Date.now();
    let rows: unknown[] = [];
    // History must not claim coverage of events that arrived while it was being
    // read. Re-read once (twice at most) until the live sequence is stable.
    for (let attempt = 0; ; attempt++) {
      const seqBefore = journal.seq;
      rows = await this.sessions.fetchMessages(id, limit);
      if (journal.seq === seqBefore || attempt >= 2) break;
    }
    // A message completed after capture started is rebuilt from its captured
    // events. Keeping it here as well would duplicate text, reasoning or tool
    // rows when the writer replays those events.
    rows = rows.filter((row) => {
      const message = asRecord(row);
      if (asString(message.type) !== "assistant") return true;
      const completed = asNumber(asRecord(message.time).completed);
      return completed !== undefined && completed < startedAt;
    });
    const entries: BackendTimelineEntry[] = [];
    for (const row of rows) {
      for (const part of mapSessionMessage(row)) {
        entries.push({
          item: part.item,
          timestamp: part.timestamp,
          seqStart: 0,
          seqEnd: 0,
          sourceSeqRanges: [],
        });
      }
    }
    const agent = this.sessions.getAgent(id);
    const maxSeq = captureSeq;
    return {
      agentId: id,
      agent,
      epoch: journal.epoch,
      window: { minSeq: 0, maxSeq, nextSeq: maxSeq + 1 },
      entries: entries.slice(-limit),
    };
  }

  async cancel(id: string): Promise<void> {
    await this.sessions.ensureAgent(id);
    await this.transport.requestJson(`/api/session/${encodeURIComponent(id)}/interrupt`, { method: "POST" });
  }

  close(): void {
    this.closed = true;
    this.stopEvents();
    this.stopStatus();
    this.streamListeners.clear();
    this.updateListeners.clear();
    this.permissionListeners.clear();
    this.permissions.clear();
    this.journals.clear();
  }
}
