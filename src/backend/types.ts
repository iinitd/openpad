/** The writer's backend contract. Transport and provider SDK types stay private. */
export type BackendKind = "paseo" | (string & {});

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected" }
  | { status: "disconnected"; reason?: string }
  | { status: "disposed" };

export type BackendAgentStatus = "initializing" | "idle" | "running" | "error" | "closed";

export interface BackendAgent {
  /** An opaque writing-conversation ID, distinct from a configured runtime/profile ID. */
  id: string;
  provider: string;
  cwd: string;
  workspaceId?: string;
  model: string | null;
  status: BackendAgentStatus;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface BackendAgentEntry {
  agent: BackendAgent;
}

export interface BackendWorkspaceEntry {
  id: string;
  title: string | null;
  name: string;
  workspaceDirectory: string;
  projectRootPath: string;
  projectCustomName?: string | null;
  projectDisplayName: string;
}

export interface BackendPageInfo {
  hasMore: boolean;
  nextCursor: string | null;
}

export interface FetchAgentsOptions {
  scope?: "active";
  filter?: { includeArchived?: boolean };
  sort?: Array<{ key: "updated_at"; direction: "asc" | "desc" }>;
  page?: { limit: number; cursor?: string };
}

export interface BackendAgentsResult {
  entries: BackendAgentEntry[];
  pageInfo: BackendPageInfo;
}

export interface BackendWorkspacesResult {
  entries: BackendWorkspaceEntry[];
  pageInfo: BackendPageInfo;
}

export interface CreateAgentOptions {
  provider: string;
  cwd: string;
  model?: string;
  workspaceId?: string;
  initialPrompt?: string;
}

export interface BackendPermissionRequest {
  id: string;
  actions?: Array<{ id: string; behavior: "allow" | "deny" }>;
}

export interface BackendPermissionResponse {
  behavior: "allow";
  selectedActionId?: string;
}

export type BackendTimelineItem =
  | { type: "user_message"; text: string; messageId?: string; images?: string[] }
  // Live text is incremental; a history entry contains the text for that entry.
  | { type: "assistant_message"; text: string; messageId?: string; replace?: boolean }
  | { type: "reasoning"; text: string }
  | {
      type: "tool_call";
      callId?: string;
      name: string;
      status: "running" | "completed" | "failed" | "canceled";
      /** Optional detail shown in activity UI (e.g. shell command, file path, args). */
      detail?: string;
      input?: unknown;
    }
  | { type: "error"; message: string }
  | { type: "other" };

export type BackendStreamEvent =
  | { type: "timeline"; item: BackendTimelineItem }
  | { type: "timeline_invalidated" }
  | { type: "permission_requested"; request: BackendPermissionRequest }
  | { type: "thread_started" | "turn_started" | "turn_completed" | "turn_failed" | "turn_canceled" | "permission_resolved" | "attention_required" }
  | { type: "other" };

export interface BackendAgentStreamMessage {
  agentId: string;
  event: BackendStreamEvent;
  /** When present, uses the same sequence domain and epoch as fetchAgentTimeline. */
  seq?: number;
  epoch?: string;
}

export interface BackendAgentUpdateMessage {
  agentId: string;
  agent: BackendAgent;
}

export interface BackendPermissionRequestMessage {
  agentId: string;
  request: BackendPermissionRequest;
}

export interface FetchAgentTimelineOptions {
  direction?: "tail";
  projection?: "projected";
  limit?: number;
}

export interface BackendTimelineEntry {
  item: BackendTimelineItem;
  timestamp: string;
  seqStart: number;
  seqEnd: number;
  sourceSeqRanges: Array<{ startSeq: number; endSeq: number }>;
}

export interface BackendAgentTimeline {
  agentId: string;
  agent: BackendAgent | null;
  epoch: string;
  /** The snapshot includes events through maxSeq; newer live events are replayed after it. */
  window: { minSeq: number; maxSeq: number; nextSeq: number };
  entries: BackendTimelineEntry[];
}

export interface BackendDirectoryEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number;
  modifiedAt?: string;
}

export interface BackendDirectory {
  path: string;
  /** Complete listing of this directory; adapters resolve transport pagination internally. */
  entries: BackendDirectoryEntry[];
}

export interface BackendFile {
  bytes: Uint8Array;
  mime: string;
  size: number;
  path: string;
  kind: "text" | "image" | "binary";
  modifiedAt: string;
}

/** An image or file the user attaches to a single prompt. */
export interface BackendAttachment {
  name: string;
  mime: string;
  /** Base64 payload without the `data:` prefix. */
  base64: string;
}

export type ProviderStatus = "ready" | "loading" | "error" | "unavailable";

export interface AgentModelDefinition {
  id: string;
  label: string;
  provider: string;
  description?: string;
  isDefault?: boolean;
}

export interface BackendProviderEntry {
  provider: string;
  label?: string;
  status: ProviderStatus;
  enabled: boolean;
  error?: string;
  models: AgentModelDefinition[];
  defaultModeId?: string | null;
}

export interface BackendProvidersSnapshot {
  entries: BackendProviderEntry[];
}

export interface WriterBackend {
  readonly kind: BackendKind;
  connect(): Promise<void>;
  close(): Promise<void>;
  setReconnectEnabled(enabled: boolean): void;
  getConnectionState(): ConnectionState;
  subscribeConnectionStatus(listener: (state: ConnectionState) => void): () => void;
  getLastServerInfoMessage(): { version: string | null } | null;
  fetchWorkspaces(): Promise<BackendWorkspacesResult>;
  fetchAgents(options?: FetchAgentsOptions): Promise<BackendAgentsResult>;
  fetchAgent(agentId: string): Promise<{ agent: BackendAgent } | null>;
  /** Bind session-owned file projections when several conversations share a directory. */
  setActiveAgent?(agentId: string | null): void;
  createAgent(options: CreateAgentOptions): Promise<BackendAgent>;
  archiveAgent(agentId: string): Promise<void>;
  cancelAgent(agentId: string): Promise<void>;
  setAgentModel(agentId: string, model: string | null): Promise<void>;
  /**
   * Optional: an id the backend will also store for the message. When present,
   * the optimistic row, the live echo and history all share one key, so a
   * queued or retried send can be recognised instead of duplicated.
   */
  createMessageId?(): string;
  sendAgentMessage(
    agentId: string,
    text: string,
    options?: { messageId?: string; attachments?: BackendAttachment[] },
  ): Promise<void>;
  fetchAgentTimeline(agentId: string, options?: FetchAgentTimelineOptions): Promise<BackendAgentTimeline>;
  listDirectory(cwd: string, path: string): Promise<BackendDirectory>;
  readFile(cwd: string, path: string): Promise<BackendFile>;
  getProvidersSnapshot(options?: { cwd?: string }): Promise<BackendProvidersSnapshot>;
  respondToPermission(agentId: string, requestId: string, response: BackendPermissionResponse): Promise<void>;
  /** Subscriptions survive transport reconnects until the returned disposer is called. */
  onAgentStream(listener: (message: BackendAgentStreamMessage) => void): () => void;
  onAgentUpdate(listener: (message: BackendAgentUpdateMessage) => void): () => void;
  onPermissionRequest(listener: (message: BackendPermissionRequestMessage) => void): () => void;
}
