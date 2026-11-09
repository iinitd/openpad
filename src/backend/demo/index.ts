import type {
  BackendAgent,
  BackendAgentStreamMessage,
  BackendAgentTimeline,
  BackendAgentUpdateMessage,
  BackendAgentsResult,
  BackendAttachment,
  BackendDirectory,
  BackendFile,
  BackendPermissionRequest,
  BackendPermissionRequestMessage,
  BackendPermissionResponse,
  BackendProvidersSnapshot,
  BackendTimelineEntry,
  BackendTimelineItem,
  BackendWorkspacesResult,
  ConnectionState,
  CreateAgentOptions,
  FetchAgentTimelineOptions,
  FetchAgentsOptions,
  WriterBackend,
} from "../types";

/**
 * A self-contained demo backend. It exists so a new install can be explored
 * without a server: one project, a couple of files and an agent that answers
 * with canned text. Everything lives in memory and resets on reload.
 */

const CWD = "/Demo Project";
const AGENT_ID = "demo-agent";
const WORKSPACE_ID = "demo-workspace";

const README = `# Demo Project

This is a sandbox that ships with OpenPad. Nothing here touches a server: edits,
messages and files live in memory and reset when the app restarts.

## What to try

- **Chat** — send a message and watch the agent think, run a step and answer.
- **Files** — open a file in the document pane; the tree below this README is real.
- **Workspace** — this demo is one project. Add your own with *New project*.

When you are ready, add a real backend from the projects sheet.
`;

const NOTES = `# Notes

## Why a demo?

A first launch used to open a connection form, which asks people to configure a
server before they can see anything. Starting in a working copy is a better
introduction: the shape of the app is visible immediately.

## What is fake

- The agent's replies are canned.
- Files are strings in memory, not on disk.
- Nothing is persisted between launches.
`;

const IDEAS = `# Ideas

- A session list that groups by day.
- Offline drafts for the composer.
- Diff view for revisions.
`;

interface DemoFile {
  path: string;
  content: string;
}

const DEMO_FILES: DemoFile[] = [
  { path: "README.md", content: README },
  { path: "notes/welcome.md", content: NOTES },
  { path: "ideas.md", content: IDEAS },
];

function makeAgent(overrides: Partial<BackendAgent> = {}): BackendAgent {
  const now = new Date().toISOString();
  return {
    id: AGENT_ID,
    provider: "demo",
    cwd: CWD,
    workspaceId: WORKSPACE_ID,
    model: "demo-model",
    status: "idle" as const,
    title: "Welcome tour",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createDemoBackend(): WriterBackend {
  let state: ConnectionState = { status: "idle" };
  let agent = makeAgent();
  let seq = 0;
  let epoch = "demo-epoch";
  let timers: ReturnType<typeof setTimeout>[] = [];
  const streamListeners = new Set<(message: BackendAgentStreamMessage) => void>();
  const updateListeners = new Set<(message: BackendAgentUpdateMessage) => void>();
  const permissionListeners = new Set<(message: BackendPermissionRequestMessage) => void>();
  const statusListeners = new Set<(state: ConnectionState) => void>();

  const now = () => new Date().toISOString();

  const entry = (item: BackendTimelineItem, id: number): BackendTimelineEntry => ({
    item,
    timestamp: now(),
    seqStart: id,
    seqEnd: id,
    sourceSeqRanges: [],
  });

  let entries: BackendTimelineEntry[] = [];

  const emit = (event: BackendAgentStreamMessage["event"]) => {
    const message: BackendAgentStreamMessage = {
      agentId: agent.id,
      event,
      seq: ++seq,
      epoch,
    };
    for (const listener of [...streamListeners]) listener(message);
  };

  const push = (item: BackendTimelineItem) => {
    const id = ++seq;
    entries = [...entries, entry(item, id)];
    return id;
  };

  const emitItem = (item: BackendTimelineItem) => {
    push(item);
    emit({ type: "timeline", item });
  };

  const publishStatus = (status: BackendAgent["status"]) => {
    agent = { ...agent, status, updatedAt: now() };
    for (const listener of [...updateListeners]) {
      listener({ agentId: agent.id, agent });
    }
  };

  const setState = (next: ConnectionState) => {
    state = next;
    for (const listener of [...statusListeners]) listener(next);
  };

  // The opening exchange: something already in the transcript, so the first
  // launch does not look like an empty product.
  push({ type: "user_message", text: "What can I do here?", messageId: "demo-user-1" });
  push({
    type: "assistant_message",
    text:
      "This is a demo workspace. Ask me anything — the reply is canned, but everything around it is real: the transcript streams, the activity row reports steps, and the files below open in the document pane.\n\nOpen `README.md` to see the notes, or send a message to try the composer.",
    messageId: "demo-assistant-1",
  });

  const directoryEntries = (path: string) => {
    const prefix = path.replace(/^\/+|\/+$/g, "");
    const seen = new Set<string>();
    const out: BackendDirectory["entries"] = [];
    for (const file of DEMO_FILES) {
      const relative = prefix ? file.path.slice(prefix.length + 1) : file.path;
      if (prefix && !file.path.startsWith(`${prefix}/`)) continue;
      const [head, ...rest] = relative.split("/");
      if (!head || seen.has(head)) continue;
      seen.add(head);
      out.push({
        name: head,
        path: prefix ? `${prefix}/${head}` : head,
        kind: rest.length > 0 ? "directory" : "file",
        size: rest.length > 0 ? 0 : (DEMO_FILES.find((entry) => entry.path === file.path)?.content.length ?? 0),
      });
    }
    return out.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1,
    );
  };

  return {
    kind: "opencode",
    async connect() {
      setState({ status: "connected" });
    },
    async close() {
      setState({ status: "disposed" });
    },
    setReconnectEnabled() {
      // Nothing to reconnect.
    },
    getConnectionState() {
      return state;
    },
    subscribeConnectionStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    getLastServerInfoMessage() {
      return { version: "demo" };
    },
    async fetchWorkspaces(): Promise<BackendWorkspacesResult> {
      return {
        entries: [
          {
            id: WORKSPACE_ID,
            title: "Demo Project",
            name: "Demo Project",
            workspaceDirectory: CWD,
            projectRootPath: CWD,
            projectDisplayName: "Demo Project",
          },
        ],
        pageInfo: { hasMore: false, nextCursor: null },
      };
    },
    async fetchAgents(_options?: FetchAgentsOptions): Promise<BackendAgentsResult> {
      return {
        entries: [{ agent }],
        pageInfo: { hasMore: false, nextCursor: null },
      };
    },
    async fetchAgent(id: string) {
      return id === agent.id ? { agent } : null;
    },
    async createAgent(options: CreateAgentOptions) {
      agent = makeAgent({ cwd: options.cwd, workspaceId: options.workspaceId, title: null });
      publishStatus("idle");
      return agent;
    },
    async archiveAgent() {
      agent = { ...agent, archivedAt: now() };
    },
    async cancelAgent() {
      timers.forEach(clearTimeout);
      timers = [];
      publishStatus("idle");
      emit({ type: "turn_canceled" });
    },
    async setAgentModel(_id: string, model: string | null) {
      agent = { ...agent, model };
      publishStatus(agent.status);
    },
    createMessageId() {
      return `demo-${Date.now().toString(36)}`;
    },
    async sendAgentMessage(_id: string, text: string, options?: {
      messageId?: string;
      attachments?: BackendAttachment[];
    }) {
      emitItem({
        type: "user_message",
        text,
        messageId: options?.messageId ?? `demo-user-${Date.now()}`,
      });
      publishStatus("running");
      emit({ type: "turn_started" });

      const reply =
        `You said: “${text.trim()}”.\n\n` +
        "In a real session this would reach your own backend. Here the answer is fixed, but the pieces around it are the product: the activity row above reported this step, the composer queued and sent the message, and the project list on the left is where other workspaces would live.";

      timers.push(
        setTimeout(() => {
          emitItem({ type: "reasoning", text: "Reading the request and shaping a short answer." });
        }, 350),
      );
      timers.push(
        setTimeout(() => {
          emitItem({
            type: "tool_call",
            callId: `demo-tool-${seq}`,
            name: "demo_lookup",
            status: "running",
          });
        }, 700),
      );
      timers.push(
        setTimeout(() => {
          emitItem({
            type: "tool_call",
            callId: `demo-tool-${seq}`,
            name: "demo_lookup",
            status: "completed",
          });
        }, 1100),
      );
      timers.push(
        setTimeout(() => {
          emitItem({
            type: "assistant_message",
            text: reply,
            messageId: `demo-assistant-${Date.now()}`,
            replace: true,
          });
        }, 1500),
      );
      timers.push(
        setTimeout(() => {
          publishStatus("idle");
          emit({ type: "turn_completed" });
        }, 1800),
      );
    },
    async fetchAgentTimeline(
      _id: string,
      options?: FetchAgentTimelineOptions,
    ): Promise<BackendAgentTimeline> {
      const limit = options?.limit ?? 500;
      return {
        agentId: agent.id,
        agent,
        epoch,
        window: { minSeq: 0, maxSeq: seq, nextSeq: seq + 1 },
        entries: entries.slice(-limit),
      };
    },
    async listDirectory(_cwd: string, path: string): Promise<BackendDirectory> {
      return { path, entries: directoryEntries(path) };
    },
    async readFile(_cwd: string, path: string): Promise<BackendFile> {
      const normalized = path.replace(/^\/+/, "");
      const file = DEMO_FILES.find((entry) => entry.path === normalized);
      if (!file) throw new Error(`Demo file not found: ${path}`);
      return {
        path: normalized,
        mime: "text/markdown",
        size: file.content.length,
        kind: "text",
        modifiedAt: now(),
        bytes: new TextEncoder().encode(file.content),
      };
    },
    async getProvidersSnapshot(): Promise<BackendProvidersSnapshot> {
      return {
        entries: [
          {
            provider: "demo",
            label: "Demo",
            status: "ready",
            enabled: true,
            models: [
              {
                id: "demo-model",
                label: "Demo model",
                provider: "demo",
                isDefault: true,
              },
            ],
          },
        ],
      };
    },
    async respondToPermission(_agentId: string, _requestId: string, _response: BackendPermissionResponse) {
      // The demo never asks for permission.
    },
    onAgentStream(listener) {
      streamListeners.add(listener);
      return () => streamListeners.delete(listener);
    },
    onAgentUpdate(listener) {
      updateListeners.add(listener);
      return () => updateListeners.delete(listener);
    },
    onPermissionRequest(listener) {
      permissionListeners.add(listener);
      return () => permissionListeners.delete(listener);
    },
  };
}

export type { BackendPermissionRequest };
