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
 * A self-contained sample workspace backend. It exists so a fresh install can be
 * explored without a server: one project, a few files and an agent that answers
 * with scripted replies. Everything lives in memory and resets on reload.
 */

const CWD = "/Sample Workspace";
const AGENT_ID = "sample-agent";
const WORKSPACE_ID = "sample-workspace";

const README = `# Clacko — coding & writing workspace for remote agents

This is a live sample workspace. Clacko keeps code and writing in one place, so you can brief a remote agent, review its steps, edit files, and keep momentum — all without leaving the same workspace.

Nothing here touches a server: edits, messages and files live in memory and reset when the app restarts.

## What to try

- **Chat** — send a message and watch the agent think, run tool steps, and answer in context.
- **Activity** — tap the activity row to inspect each step, including shell commands and tool details.
- **Files** — open any file in the document pane; this tree is real and editable right here.
- **Queue** — send follow-ups while a turn is running, then edit, reorder, or send one ahead.
- **Bring your own backend** — when you're ready, connect OpenCode or Paseo from the projects sheet.

Try asking the agent to refine this README, sketch a plan in \`ideas.md\`, or explore how code and writing can move together.
`;

const NOTES = `# Notes

## Positioning

Clacko is a coding & writing workspace for remote agents. Treat it as your command center: brief agents in natural language, track their tool use in real time, move between writing and code, and keep everything tied to the project you're working in.

## Why start here?

A fresh launch drops you straight into a working project. You can feel the rhythm of briefing, reviewing activity, and editing before connecting your own backend.

## What's simulated

- The agent's replies are scripted for this sample space.
- Files are stored in memory, not on disk.
- Nothing persists between launches.
`;

const IDEAS = `# Ideas to explore

- **Tight loops** — brief, review activity, edit, repeat without context switching.
- **Shared context** — keep specs, notes, and code in one workspace so agents stay grounded.
- **Remote-first flow** — steer long-running agents from one surface and jump in exactly where they need help.
- **Traceable steps** — inspect shell commands and tool calls in activity to understand what happened.
- **Queue with intent** — line up follow-ups, tweak them, and send the right one next.
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
    provider: "sample",
    cwd: CWD,
    workspaceId: WORKSPACE_ID,
    model: "sample-model",
    status: "idle" as const,
    title: "Workspace kickoff",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createDemoBackend(): WriterBackend {
  let state: ConnectionState = { status: "idle" };
  let agent = makeAgent();
  let seq = 0;
  let epoch = "sample-epoch";
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
  push({ type: "user_message", text: "What can I do here?", messageId: "sample-user-1" });
  push({
    type: "assistant_message",
    text:
      "Welcome to Clacko — a coding & writing workspace for remote agents.\n\n" +
      "This sample workspace runs fully on your device, but the flow is real: I can think, run tool steps (tap the activity row to see commands and details), and answer while you keep editing files in the same space.\n\n" +
      "Try asking me to sharpen `README.md`, sketch ideas in `ideas.md`, or send a few follow-ups while I'm working to see how the queue behaves.",
    messageId: "sample-assistant-1",
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
      return { version: "sample" };
    },
    async fetchWorkspaces(): Promise<BackendWorkspacesResult> {
      return {
        entries: [
          {
            id: WORKSPACE_ID,
            title: "Sample Workspace",
            name: "Sample Workspace",
            workspaceDirectory: CWD,
            projectRootPath: CWD,
            projectDisplayName: "Sample Workspace",
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
      return `sample-${Date.now().toString(36)}`;
    },
    async sendAgentMessage(_id: string, text: string, options?: {
      messageId?: string;
      attachments?: BackendAttachment[];
    }) {
      const trimmed = text.trim();
      emitItem({
        type: "user_message",
        text,
        messageId: options?.messageId ?? `sample-user-${Date.now()}`,
      });
      publishStatus("running");
      emit({ type: "turn_started" });

      const lower = trimmed.toLowerCase();
      const reply =
        `Got it — “${trimmed}”.\n\n` +
        (lower.includes("readme") || lower.includes("doc") || lower.includes("write")
          ? "In Clacko, coding and writing move together: I can help draft, reshape, or polish files while the whole workspace stays in view. This reply is scripted here, but with a connected backend I’d make the change directly in your project."
          : lower.includes("code") || lower.includes("bug") || lower.includes("fix") || lower.includes("shell")
            ? "That’s right in Clacko’s sweet spot as a coding & writing workspace for remote agents. I can reason through the task, run commands, and keep notes or docs in sync from one place. This sample run shows the flow with scripted steps and replies."
            : "Clacko is a coding & writing workspace for remote agents: one surface to brief work, watch tool activity, and edit files. In a real session I’d pick up from here with your backend; in this sample space, you’re seeing the same rhythm with scripted responses.");

      const toolCallId = `sample-shell-${Date.now().toString(36)}`;
      timers.push(
        setTimeout(() => {
          emitItem({ type: "reasoning", text: "Scoping the request and picking the next step." });
        }, 300),
      );
      timers.push(
        setTimeout(() => {
          emitItem({
            type: "tool_call",
            callId: toolCallId,
            name: "shell",
            status: "running",
            detail: "rg -n \"coding & writing workspace\" README.md notes/welcome.md",
            input: { command: "rg -n \"coding & writing workspace\" README.md notes/welcome.md" },
          });
        }, 650),
      );
      timers.push(
        setTimeout(() => {
          emitItem({
            type: "tool_call",
            callId: toolCallId,
            name: "shell",
            status: "completed",
            detail: "rg -n \"coding & writing workspace\" README.md notes/welcome.md",
            input: { command: "rg -n \"coding & writing workspace\" README.md notes/welcome.md" },
          });
        }, 1100),
      );
      timers.push(
        setTimeout(() => {
          emitItem({ type: "reasoning", text: "Pulling the context together for a clear answer." });
        }, 1350),
      );
      timers.push(
        setTimeout(() => {
          emitItem({
            type: "assistant_message",
            text: reply,
            messageId: `sample-assistant-${Date.now()}`,
            replace: true,
          });
        }, 1750),
      );
      timers.push(
        setTimeout(() => {
          publishStatus("idle");
          emit({ type: "turn_completed" });
        }, 2050),
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
      if (!file) throw new Error(`Sample file not found: ${path}`);
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
            provider: "sample",
            label: "Sample",
            status: "ready",
            enabled: true,
            models: [
              {
                id: "sample-model",
                label: "Sample model",
                provider: "sample",
                isDefault: true,
              },
            ],
          },
        ],
      };
    },
    async respondToPermission(_agentId: string, _requestId: string, _response: BackendPermissionResponse) {
      // The sample workspace never asks for permission.
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
