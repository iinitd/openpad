import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  WriterBackend,
  BackendAgentStatus,
  BackendAttachment,
  BackendStreamEvent,
  BackendTimelineItem,
  BackendPermissionRequest,
  BackendUsage,
} from "../backend";
import type { StreamItem } from "../types/stream";
import { applyStreamEvent } from "../client/stream-reducer";
import { useConnectionStore } from "./connection-store";
import { DEFAULT_AGENT_PROMPT, getBackendPreferences, setBackendQueuedMessages, usePreferencesStore } from "./preferences-store";
import { useEditorStore } from "./editor-store";
import { workspaceSessionKey } from "./workspace-session-key";
import { measureStartupTrace, noteStartupTrace } from "../utils/startup-trace";

type AgentStatus = BackendAgentStatus;

// A message the user typed while a turn was still running. It waits in the
// queue (not the transcript) until the turn ends; the user can delete it before
// it sends, and multiple queued messages are merged into one send.
export interface QueuedMessage {
  id: string;
  text: string;
  messageId?: string;
  // Images ride along in memory only. The persisted queue stays text-only so a
  // base64 payload never lands in preferences; after a cold start the waiting
  // message keeps its text and loses its pictures.
  attachments?: BackendAttachment[];
}

interface SessionStore {
  agentId: string | null;
  agentStatus: AgentStatus;
  provider: string | null;
  model: string | null;
  cwd: string | null;
  workspaceId: string | null;
  /** Latest usage the active backend reported, merged from snapshots and events. */
  usage: BackendUsage | null;
  initialPrompt: string;
  tail: StreamItem[];
  head: StreamItem[];
  isStreaming: boolean;
  // Messages the user sent while a turn was already running. They are kept out
  // of the transcript and shown as an editable/deletable queue; when the turn
  // ends they're merged into a single message and dispatched together.
  queued: QueuedMessage[];
  _unsubStream: (() => void) | null;
  _unsubUpdate: (() => void) | null;
  _unsubPermission: (() => void) | null;
  // Monotonic tokens that prevent late metadata/history responses from an
  // older A→B→A switch from mutating the newest session.
  _restoreRequestGeneration: number;
  _restoreGeneration: number;
  _timelineGeneration: number;

  createAgent: (
    provider: string,
    cwd: string,
    initialPrompt: string,
    options?: {
      model?: string;
      workspaceId?: string;
      // Internal: a fully-built system prompt (used by switchProvider to inject
      // carried-over context) and whether to preserve the on-screen transcript.
      systemPromptOverride?: string;
      preserveTranscript?: boolean;
      // If true, archive the previously-active agent after the new one is live.
      // Only set by switchProvider — a plain "new session" must keep the old
      // one around so it stays in the session list.
      archivePrevious?: boolean;
    },
  ) => Promise<void>;
  restoreAgent: (workspaceKey: string) => Promise<boolean>;
  restoreAgentById: (agentId: string, workspaceKey: string) => Promise<boolean>;
  catchUpAgent: () => Promise<void>;
  sendMessage: (text: string, attachments?: BackendAttachment[]) => Promise<void>;
  editQueued: (id: string, text: string) => void;
  removeQueued: (id: string) => void;
  prioritizeQueued: (id: string) => void;
  sendQueuedNow: (id: string) => Promise<void>;
  drainQueue: () => Promise<void>;
  cancelAgent: () => Promise<void>;
  setModel: (model: string | null) => Promise<void>;
  switchProvider: (provider: string, model?: string | null) => Promise<void>;
  setAgentStatus: (status: AgentStatus) => void;
  reset: () => void;
}

function getClient(): WriterBackend {
  const client = useConnectionStore.getState().client;
  if (!client) throw new Error("Not connected to daemon");
  return client;
}

// The daemon echoes the agent's initial/system prompt back as the first
// user_message in the timeline. We prefix that prompt with this sentinel so it
// can be identified as the session system prompt.
const SYSTEM_PROMPT_MARKER = "\u200b[puff-system]";

// The editable part of the prompt, sent as the first user message when a new
// chat session starts.
function writingSystemPrompt(): string {
  const configured = usePreferencesStore.getState().agentPrompt.trim();
  return `${SYSTEM_PROMPT_MARKER}
${configured || DEFAULT_AGENT_PROMPT}`;
}

/**
 * A sent message can sit silent when the live event stream stalls: the turn is
 * running, but nothing arrives, so the transcript looks like it swallowed the
 * message. If the stream has produced no step a few seconds in, read history
 * once so the turn becomes visible.
 */
function watchFirstStreamStep(agentId: string, get: () => SessionStore): void {
  setTimeout(() => {
    const state = get();
    if (state.agentId !== agentId || !state.isStreaming) return;
    if (state.head.length > 0) return;
    void state.catchUpAgent();
  }, 5000);
}

function createClientMessageId(): string {
  return `kel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function persistVisibleQueue(
  agentId: string,
  currentVisible: QueuedMessage[],
  nextVisible: QueuedMessage[],
): void {
  const preferences = usePreferencesStore.getState();
  const visibleIds = new Set(currentVisible.map((item) => item.id));
  // A batch being dispatched is hidden from the editable queue but remains in
  // persistence until the daemon accepts it. Preserve that hidden prefix when
  // the user adds or removes later follow-ups during the in-flight send.
  const inFlight = preferences
    .queuedMessagesForAgent(agentId)
    .filter((item) => !visibleIds.has(item.id));
  // Images are memory-only: strip them so the persisted copy stays small.
  const persisted = nextVisible.map((item) => ({
    id: item.id,
    text: item.text,
    ...(item.messageId ? { messageId: item.messageId } : {}),
  }));
  preferences.setQueuedMessagesForAgent(agentId, [...inFlight, ...persisted]);
}

function removePersistedQueueEntries(
  agentId: string,
  ids: Set<string>,
  messageIds: Set<string> = new Set(),
  backendKey = usePreferencesStore.getState().activeBackendKey,
): void {
  const remaining = (getBackendPreferences(backendKey).queuedMessagesByAgent[agentId] ?? []).filter(
    (item) =>
      !ids.has(item.id) &&
      (!item.messageId || !messageIds.has(item.messageId)),
  );
  setBackendQueuedMessages(backendKey, agentId, remaining);
}

// Render the current transcript into a plain-text block that can seed a new
// agent when the user switches AI provider. The frontend hides the underlying
// "session" concept, so switching providers must feel continuous: we hand the
// prior conversation to the new agent as context.
function serializeTranscript(items: StreamItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    if (item.kind === "user_message") {
      lines.push(`User: ${item.text}`);
    } else if (item.kind === "assistant_message") {
      if (item.text.trim()) lines.push(`Assistant: ${item.text}`);
    }
    // Thoughts, tool calls and errors are intentionally omitted — they are
    // provider-specific noise, not conversational context.
  }
  return lines.join("\n\n");
}

function buildCarryoverPrompt(transcript: string): string {
  if (!transcript.trim()) return writingSystemPrompt();
  return [
    writingSystemPrompt(),
    "",
    "--- Prior conversation (for context; continue seamlessly) ---",
    transcript,
    "--- End of prior conversation ---",
    "",
    "Continue assisting the user from where the conversation left off. Do not greet again or restate context.",
  ].join("\n");
}

function workspaceLabelFromCwd(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() || cwd;
}

function rememberRecentSession(args: {
  agentId: string;
  workspaceId: string | null | undefined;
  cwd: string;
  title?: string | null;
  provider?: string | null;
  model?: string | null;
  updatedAt?: string | null;
}) {
  usePreferencesStore.getState().addRecentSession({
    agentId: args.agentId,
    workspaceId: args.workspaceId ?? null,
    workspaceLabel: workspaceLabelFromCwd(args.cwd),
    cwd: args.cwd,
    title: args.title?.trim() || "Untitled writing session",
    provider: args.provider ?? null,
    model: args.model ?? null,
    updatedAt: args.updatedAt ?? new Date().toISOString(),
  });
}

type SessionSet = (
  partial: Partial<SessionStore> | ((state: SessionStore) => Partial<SessionStore>),
) => void;
type SessionGet = () => SessionStore;
type TimelineItem = BackendTimelineItem;
type AgentStreamEvent = BackendStreamEvent;
type CapturedStreamEvent = {
  event: AgentStreamEvent;
  seq: number | null;
  epoch: string | null;
};

function beginSessionOperation(set: SessionSet, get: SessionGet) {
  const restoreRequestGeneration = get()._restoreRequestGeneration + 1;
  const restoreGeneration = get()._restoreGeneration + 1;
  const timelineGeneration = get()._timelineGeneration + 1;
  set({
    _restoreRequestGeneration: restoreRequestGeneration,
    _restoreGeneration: restoreGeneration,
    _timelineGeneration: timelineGeneration,
  });
  return { restoreRequestGeneration, restoreGeneration, timelineGeneration };
}

function beginRestoreRequest(set: SessionSet, get: SessionGet): number {
  const restoreRequestGeneration = get()._restoreRequestGeneration + 1;
  set({ _restoreRequestGeneration: restoreRequestGeneration });
  return restoreRequestGeneration;
}

function commitRestoredSessionGeneration(
  set: SessionSet,
  get: SessionGet,
  restoreRequestGeneration: number,
): { restoreGeneration: number; timelineGeneration: number } | null {
  if (get()._restoreRequestGeneration !== restoreRequestGeneration) return null;
  const restoreGeneration = get()._restoreGeneration + 1;
  const timelineGeneration = get()._timelineGeneration + 1;
  set({ _restoreGeneration: restoreGeneration, _timelineGeneration: timelineGeneration });
  return { restoreGeneration, timelineGeneration };
}

function beginTimelineHydration(set: SessionSet, get: SessionGet): number {
  const timelineGeneration = get()._timelineGeneration + 1;
  set({ _timelineGeneration: timelineGeneration });
  return timelineGeneration;
}

function isCurrentHydration(
  get: SessionGet,
  agentId: string,
  restoreGeneration: number,
  timelineGeneration: number,
): boolean {
  const state = get();
  return (
    state.agentId === agentId &&
    state._restoreGeneration === restoreGeneration &&
    state._timelineGeneration === timelineGeneration
  );
}

function isHiddenSystemPrompt(_item: TimelineItem): boolean {
  return false;
}

export class SessionRestoreSupersededError extends Error {
  constructor() {
    super("Session restore was superseded by a newer selection");
    this.name = "SessionRestoreSupersededError";
  }
}

export function isSessionRestoreSuperseded(error: unknown): boolean {
  return error instanceof SessionRestoreSupersededError;
}

/**
 * Usage arrives from two directions: a full snapshot on the agent, and partial
 * events during a turn. Merge instead of replacing so a step's context reading
 * does not wipe the session's cost or token totals.
 */
function mergeUsage(current: BackendUsage | null, next: BackendUsage): BackendUsage {
  return { ...(current ?? {}), ...next };
}

function installTimelineCapture(
  client: WriterBackend,
  agentId: string,
  isCaptureCurrent: () => boolean,
  capturedEvents: CapturedStreamEvent[],
): () => void {
  // Capture begins before fetchAgentTimeline is issued. This closes the gap
  // where a daemon event could otherwise land after the snapshot but before
  // the normal restored-session subscription exists.
  const unsubscribeStream = client.onAgentStream((message) => {
    if (!isCaptureCurrent()) return;
    const { agentId: messageAgentId, event: typedEvent } = message;
    if (messageAgentId !== agentId) return;
    if (typedEvent.type === "timeline" && isHiddenSystemPrompt(typedEvent.item)) return;
    if (typedEvent.type === "permission_requested") {
      void autoAllowPermission(client, agentId, typedEvent.request);
      return;
    }
    capturedEvents.push({
      event: typedEvent,
      seq: message.seq ?? null,
      epoch: message.epoch ?? null,
    });
  });
  const unsubscribePermission = client.onPermissionRequest((message) => {
    if (!isCaptureCurrent()) return;
    const messageAgentId = message.agentId;
    const request = message.request;
    if (messageAgentId !== agentId) return;
    void autoAllowPermission(client, agentId, request);
  });
  return () => {
    unsubscribeStream();
    unsubscribePermission();
  };
}

function reduceTimeline(items: TimelineItem[]): Pick<SessionStore, "tail" | "head"> {
  let tail: StreamItem[] = [];
  let head: StreamItem[] = [];

  for (const item of items) {
    const result = applyStreamEvent(tail, head, {
      type: "timeline",
      item,
    });
    tail = result.tail;
    head = result.head;
  }

  return { tail, head };
}

// A browser refresh discards listeners, even though the daemon keeps the agent
// alive. This installs the same stream/update/permission listeners for a
// restored agent that a newly-created agent receives.

// Auto-approve a daemon permission request. Honors the request's `actions` list
// (preferring an allow-flavored action), so prompts that require an explicit
// selectedActionId don't stall waiting on us. Shared between the dedicated
// `agent_permission_request` event and inline `permission_requested` stream
// events — some providers surface permission prompts through only one or the
// other.
async function autoAllowPermission(
  client: WriterBackend,
  agentId: string,
  request: BackendPermissionRequest,
): Promise<void> {
  const { id: requestId, actions } = request;
  if (!requestId) return;
  const chosen = actions?.find((a) => a.behavior === "allow");
  const response = chosen
    ? ({ behavior: "allow" as const, selectedActionId: chosen.id })
    : ({ behavior: "allow" as const });
  try {
    await client.respondToPermission(agentId, requestId, response);
  } catch {
    // Daemon may have already resolved it; swallow.
  }
}

function installAgentSubscriptions(
  client: WriterBackend,
  set: SessionSet,
  get: SessionGet,
  options: {
    adoptInitialAgent?: boolean;
    restoreGeneration?: number;
  } = {},
): Pick<SessionStore, "_unsubStream" | "_unsubUpdate" | "_unsubPermission"> {
  const unsubStream = client.onAgentStream((message) => {
    if (
      options.restoreGeneration !== undefined &&
      get()._restoreGeneration !== options.restoreGeneration
    ) return;
    const { agentId: msgAgentId, event: typedEvent } = message;
    let currentAgentId = get().agentId;
    // createAgent may receive the opening stream event before its RPC resolves.
    // Only that creation path opts into adoption; a restored session never does.
    if (!currentAgentId && options.adoptInitialAgent && msgAgentId) {
      set({ agentId: msgAgentId, agentStatus: "initializing" });
      currentAgentId = msgAgentId;
    }
    if (msgAgentId !== currentAgentId) return;

    if (typedEvent.type === "timeline_invalidated") {
      void get().catchUpAgent();
      return;
    }
    if (typedEvent.type === "timeline" && isHiddenSystemPrompt(typedEvent.item)) return;

    // Permission requests sometimes arrive on the stream (as `permission_requested`)
    // rather than as a top-level `agent_permission_request`. Route either path
    // through the same auto-allow handler so the agent never stalls waiting on us.
    if (typedEvent.type === "permission_requested") {
      void autoAllowPermission(client, msgAgentId, typedEvent.request);
      return;
    }

    if (typedEvent.type === "usage") {
      set({ usage: mergeUsage(get().usage, typedEvent.usage) });
      return;
    }

    if (typedEvent.type === "timeline" && typedEvent.item.type === "user_message") {
      const echoedText = typedEvent.item.text;
      const echoedMessageId = typedEvent.item.messageId;
      if (echoedMessageId) {
        const currentQueue = get().queued;
        const nextQueue = currentQueue.filter((item) => item.messageId !== echoedMessageId);
        if (nextQueue.length !== currentQueue.length) set({ queued: nextQueue });
        removePersistedQueueEntries(msgAgentId, new Set(), new Set([echoedMessageId]));
      }
      const optimisticIdx = get().tail.findIndex(
        (it) =>
          it.kind === "user_message" &&
          it.optimistic &&
          (echoedMessageId && it.messageId
            ? it.messageId === echoedMessageId
            : it.text === echoedText),
      );
      if (optimisticIdx !== -1) {
        set((state) => ({
          tail: state.tail.map((it, index) =>
            index === optimisticIdx && it.kind === "user_message"
              ? { ...it, messageId: echoedMessageId ?? it.messageId, optimistic: false }
              : it,
          ),
        }));
        return;
      }
    }

    const { tail, head } = get();
    const result = applyStreamEvent(tail, head, typedEvent);
    const turnEnded =
      typedEvent.type === "turn_completed" ||
      typedEvent.type === "turn_failed" ||
      typedEvent.type === "turn_canceled";
    const lifecycle =
      typedEvent.type === "turn_started"
        ? { isStreaming: true }
        : turnEnded
          ? { isStreaming: false, agentStatus: "idle" as const }
          : {};
    set({
      ...lifecycle,
      tail: result.changedTail ? result.tail : tail,
      head: result.changedHead ? result.head : head,
    });

    if (typedEvent.type === "turn_completed" && typedEvent.usage) {
      set({ usage: mergeUsage(get().usage, typedEvent.usage) });
    }

    // The revision (if any) is done — drop the banner's target for this
    // session's workspace so it stops advertising a file that's no longer
    // being edited. Other workspaces' revise targets are left alone.
    if (turnEnded) {
      useEditorStore.getState().setReviseTargetForCwd(get().cwd, null);
    }

    // A turn just finished — if the user queued follow-up messages while it ran,
    // dispatch the next one now. Deferred a tick so this set() settles first.
    if (turnEnded && get().queued.length > 0) {
      const completedAgentId = msgAgentId;
      const completedRestoreGeneration = get()._restoreGeneration;
      setTimeout(() => {
        const current = get();
        if (
          current.agentId === completedAgentId &&
          current._restoreGeneration === completedRestoreGeneration
        ) {
          void current.drainQueue();
        }
      }, 0);
    }
  });

  const unsubUpdate = client.onAgentUpdate((message) => {
    if (
      options.restoreGeneration !== undefined &&
      get()._restoreGeneration !== options.restoreGeneration
    ) return;
    const msgAgentId = message.agentId;
    if (msgAgentId !== get().agentId) return;
    const status = message.agent.status;
    if (!status) return;
    set({
      agentStatus: status,
      isStreaming: status === "running",
      ...(message.agent.usage ? { usage: mergeUsage(get().usage, message.agent.usage) } : {}),
    });
  });

  const unsubPermission = client.onPermissionRequest((message) => {
    if (
      options.restoreGeneration !== undefined &&
      get()._restoreGeneration !== options.restoreGeneration
    ) return;
    const agentId = message.agentId;
    const request = message.request;
    if (agentId !== get().agentId) return;
    void autoAllowPermission(client, agentId, request);
  });

  return {
    _unsubStream: unsubStream,
    _unsubUpdate: unsubUpdate,
    _unsubPermission: unsubPermission,
  };
}

async function hydrateAgentTimeline(args: {
  agentId: string;
  restoreGeneration: number;
  timelineGeneration: number;
  metadataStatus: AgentStatus;
  timelinePromise: ReturnType<WriterBackend["fetchAgentTimeline"]>;
  capturedEvents: CapturedStreamEvent[];
  stopCapturing: () => void;
  set: SessionSet;
  get: SessionGet;
}): Promise<void> {
  const {
    agentId,
    restoreGeneration,
    timelineGeneration,
    metadataStatus,
    timelinePromise,
    capturedEvents,
    stopCapturing,
    set,
    get,
  } = args;

  let timeline: Awaited<ReturnType<WriterBackend["fetchAgentTimeline"]>>;
  try {
    timeline = await timelinePromise;
  } catch (error) {
    stopCapturing();
    // Metadata and realtime subscriptions are already usable. A history
    // failure must not send the user back through the launch flow.
    noteStartupTrace("session timeline hydration failed", {
      agentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  // A newer workspace/session switch owns the store now. Never let this older
  // history request overwrite it when it eventually resolves.
  if (!isCurrentHydration(get, agentId, restoreGeneration, timelineGeneration)) {
    stopCapturing();
    return;
  }

  // Stop recording at the same synchronous boundary where we take the replay
  // snapshot. JavaScript cannot interleave another socket callback before the
  // rebased state below is committed.
  stopCapturing();
  const eventsToReplay = capturedEvents.filter(({ seq, epoch }) => {
    if (seq === null) return true;
    if (epoch && epoch !== timeline.epoch) return true;
    return seq > timeline.window.maxSeq;
  });
  capturedEvents.length = 0;

  let restored = reduceTimeline(timeline.entries.map((entry) => entry.item));
  const current = get();
  let nextStatus = current.agentStatus;
  let nextIsStreaming = current.isStreaming;
  // Use the newer snapshot status only when no realtime event or optimistic
  // send has already changed the live state since metadata was published.
  if (
    current.agentStatus === metadataStatus &&
    current.isStreaming === (metadataStatus === "running") &&
    timeline.agent
  ) {
    nextStatus = timeline.agent.status;
    nextIsStreaming = timeline.agent.status === "running";
  }
  // `sendMessage` can move the live state to streaming while history is still
  // loading. Never synthesize a completion over that newer activity: doing so
  // would split one assistant response between tail and head.
  if (nextIsStreaming && nextStatus !== "running") {
    nextStatus = "running";
  }
  if (!nextIsStreaming) {
    const settled = applyStreamEvent(restored.tail, restored.head, {
      type: "turn_completed",
    });
    restored = { tail: settled.tail, head: settled.head };
  }

  // Reapply events newer than the timeline window so a response that was
  // already streaming while history loaded remains lossless.
  let nextUsage = current.usage;
  for (const { event } of eventsToReplay) {
    if (event.type === "usage") {
      nextUsage = mergeUsage(nextUsage, event.usage);
      continue;
    }
    const replayed = applyStreamEvent(restored.tail, restored.head, event);
    restored = { tail: replayed.tail, head: replayed.head };
    if (event.type === "turn_completed" && event.usage) {
      nextUsage = mergeUsage(nextUsage, event.usage);
    }
    if (event.type === "turn_started") {
      nextStatus = "running";
      nextIsStreaming = true;
    } else if (
      event.type === "turn_completed" ||
      event.type === "turn_failed" ||
      event.type === "turn_canceled"
    ) {
      nextStatus = "idle";
      nextIsStreaming = false;
    }
  }

  // A reply that completed while history was being read can arrive twice: as a
  // snapshot row and as a replayed live event. Keep the snapshot copy, which is
  // the complete one.
  const snapshotReplyIds = new Set(
    restored.tail
      .filter(
        (item): item is Extract<StreamItem, { kind: "assistant_message" }> =>
          item.kind === "assistant_message" && Boolean(item.messageId),
      )
      .map((item) => item.messageId!),
  );
  if (snapshotReplyIds.size > 0) {
    restored = {
      ...restored,
      head: restored.head.filter(
        (item) =>
          item.kind !== "assistant_message" ||
          !item.messageId ||
          !snapshotReplyIds.has(item.messageId),
      ),
    };
  }

  const canonicalMessageIds = new Set(
    [...restored.tail, ...restored.head]
      .filter(
        (item): item is Extract<StreamItem, { kind: "user_message" }> =>
          item.kind === "user_message" && Boolean(item.messageId),
      )
      .map((item) => item.messageId!),
  );
  if (canonicalMessageIds.size > 0) {
    removePersistedQueueEntries(agentId, new Set(), canonicalMessageIds);
  }
  const reconciledQueue = current.queued.filter(
    (item) => !item.messageId || !canonicalMessageIds.has(item.messageId),
  );

  // A user can type as soon as metadata opens the Writer. Preserve a message
  // that has been sent optimistically but has not been echoed by the daemon yet.
  const knownIds = new Set([...restored.tail, ...restored.head].map((item) => item.id));
  const optimisticMessages = current.tail.filter(
    (item) => item.kind === "user_message" && item.optimistic,
  ).filter((item) => !knownIds.has(item.id));
  if (optimisticMessages.length > 0) {
    restored = { ...restored, tail: [...restored.tail, ...optimisticMessages] };
  }

  if (!isCurrentHydration(get, agentId, restoreGeneration, timelineGeneration)) return;
  set({
    ...restored,
    agentStatus: nextStatus,
    isStreaming: nextIsStreaming,
    queued: reconciledQueue,
    usage: nextUsage,
  });

  if (!nextIsStreaming && get().queued.length > 0) {
    setTimeout(() => {
      if (
        isCurrentHydration(get, agentId, restoreGeneration, timelineGeneration) &&
        !get().isStreaming
      ) {
        void get().drainQueue();
      }
    }, 0);
  }
  noteStartupTrace("session timeline merged", {
    agentId,
    items: timeline.entries.length,
    replayed: eventsToReplay.length,
  });
}

export const useSessionStore = create<SessionStore>()(
  subscribeWithSelector((set, get) => ({
    agentId: null,
    agentStatus: "closed",
    provider: null,
    model: null,
    cwd: null,
    workspaceId: null,
    usage: null,
    initialPrompt: "",
    tail: [],
    head: [],
    isStreaming: false,
    queued: [],
    _unsubStream: null,
    _unsubUpdate: null,
    _unsubPermission: null,
    _restoreRequestGeneration: 0,
    _restoreGeneration: 0,
    _timelineGeneration: 0,

    createAgent: async (
      provider: string,
      cwd: string,
      initialPrompt: string,
      options?: {
        model?: string;
        workspaceId?: string;
        systemPromptOverride?: string;
        preserveTranscript?: boolean;
        archivePrevious?: boolean;
      },
    ) => {
      const client = getClient();
      const { restoreGeneration } = beginSessionOperation(set, get);

      // Remember the agent we're replacing so provider switches can archive it
      // after the new one is live (keeps the daemon tidy without interrupting UX).
      const previousAgentId = get().agentId;

      // Clean up previous subscriptions
      const prevStream = get()._unsubStream;
      const prevUpdate = get()._unsubUpdate;
      const prevPermission = get()._unsubPermission;
      prevStream?.();
      prevUpdate?.();
      prevPermission?.();

      // When switching provider we keep the visible transcript; otherwise the
      // chat starts empty. The new agent must adopt a fresh id, so we clear it
      // regardless (the incoming stream will set the new one).
      const preserved = options?.preserveTranscript
        ? { tail: get().tail, head: [] as StreamItem[] }
        : { tail: [] as StreamItem[], head: [] as StreamItem[] };

      set({
        agentId: null,
        agentStatus: "initializing",
        tail: preserved.tail,
        head: preserved.head,
        isStreaming: false,
      });

      // Subscriptions must be installed before createAgent resolves, otherwise
      // the first timeline chunk can be missed. The helper filters by the
      // current agent ID, so it is safe to subscribe while that ID is still null.
      const subscriptions = installAgentSubscriptions(client, set, get, {
        adoptInitialAgent: true,
        restoreGeneration,
      });
      set(subscriptions);

      try {
        const systemPrompt =
          options?.systemPromptOverride ??
          (initialPrompt
            ? `${writingSystemPrompt()}\n\n${initialPrompt}`
            : writingSystemPrompt());

        const agent = await client.createAgent({
          provider,
          cwd,
          model: options?.model,
          workspaceId: options?.workspaceId,
          initialPrompt: systemPrompt,
        });

        if (get()._restoreGeneration !== restoreGeneration) {
          subscriptions._unsubStream?.();
          subscriptions._unsubUpdate?.();
          subscriptions._unsubPermission?.();
          client.archiveAgent(agent.id).catch(() => {});
          throw new SessionRestoreSupersededError();
        }

        client.setActiveAgent?.(agent.id);
        set({
          agentId: agent.id,
          agentStatus: agent.status,
          isStreaming: agent.status === "running",
          provider: agent.provider,
          model: agent.model,
          cwd: agent.cwd,
          workspaceId: agent.workspaceId ?? options?.workspaceId ?? null,
          usage: agent.usage ?? null,
          initialPrompt,
        });
        usePreferencesStore
          .getState()
          .setAgentForWorkspace(
            workspaceSessionKey(agent.workspaceId ?? options?.workspaceId ?? null, agent.cwd),
            agent.id,
          );
        rememberRecentSession({
          agentId: agent.id,
          workspaceId: agent.workspaceId ?? options?.workspaceId ?? null,
          cwd: agent.cwd,
          provider: agent.provider,
          model: agent.model,
        });

        // If we replaced a live agent (provider switch), archive the old one so
        // it doesn't linger. Best-effort; failures are non-fatal. "New session"
        // from the agent panel must leave the previous agent intact so it stays
        // visible in the session list — that path passes archivePrevious: false
        // (the default).
        if (options?.archivePrevious && previousAgentId && previousAgentId !== agent.id) {
          client.archiveAgent(previousAgentId).catch(() => {});
        }
      } catch (error) {
        subscriptions._unsubStream?.();
        subscriptions._unsubUpdate?.();
        subscriptions._unsubPermission?.();
        if (get()._restoreGeneration !== restoreGeneration) {
          if (isSessionRestoreSuperseded(error)) throw error;
          throw new SessionRestoreSupersededError();
        }
        set({
          agentStatus: "error",
          _unsubStream: null,
          _unsubUpdate: null,
          _unsubPermission: null,
        });
        throw error;
      }
    },

    restoreAgent: async (workspaceKey: string) => {
      const savedAgentId = usePreferencesStore.getState().agentIdForWorkspace(workspaceKey);
      if (!savedAgentId) return false;
      return get().restoreAgentById(savedAgentId, workspaceKey);
    },

    restoreAgentById: async (agentId: string, workspaceKey: string) => {
      const client = getClient();
      const restoreRequestGeneration = beginRestoreRequest(set, get);
      const capturedEvents: CapturedStreamEvent[] = [];
      let committedGenerations: {
        restoreGeneration: number;
        timelineGeneration: number;
      } | null = null;
      let captureInstalled = true;
      const stopCapture = installTimelineCapture(
        client,
        agentId,
        () =>
          committedGenerations
            ? isCurrentHydration(
                get,
                agentId,
                committedGenerations.restoreGeneration,
                committedGenerations.timelineGeneration,
              )
            : get()._restoreRequestGeneration === restoreRequestGeneration,
        capturedEvents,
      );
      const stopCapturing = () => {
        if (!captureInstalled) return;
        captureInstalled = false;
        stopCapture();
      };

      // Fire both RPCs in parallel. fetchAgent typically returns in ~150ms and
      // determines what to flip the UI to; fetchAgentTimeline can take 1–5s for
      // long sessions. We optimistically flip to the new agent as soon as
      // fetchAgent lands and merge the timeline when it arrives, so the user
      // perceives an instant switch instead of waiting on history.
      const fetchAgentP = measureStartupTrace(
        "session.fetchAgent",
        () => client.fetchAgent(agentId),
        { agentId, workspaceKey },
      );
      const fetchTimelineP = measureStartupTrace(
        "session.fetchAgentTimeline",
        () =>
          client.fetchAgentTimeline(agentId, {
            direction: "tail",
            projection: "projected",
            limit: 500,
          }),
        { agentId, limit: 500 },
      );
      // Timeline is awaited later; if the caller aborts via a fetchAgent error
      // we still need to silence this promise's rejection so it doesn't surface
      // as an unhandled error.
      fetchTimelineP.catch(() => {});

      let fetched: Awaited<ReturnType<WriterBackend["fetchAgent"]>>;
      try {
        fetched = await fetchAgentP;
      } catch (error) {
        stopCapturing();
        if (get()._restoreRequestGeneration !== restoreRequestGeneration) {
          throw new SessionRestoreSupersededError();
        }
        // Preserve the mapping for a temporary relay/daemon failure. A caller
        // must not allocate a replacement agent in this case.
        throw error;
      }

      if (get()._restoreRequestGeneration !== restoreRequestGeneration) {
        stopCapturing();
        throw new SessionRestoreSupersededError();
      }

      if (!fetched || fetched.agent.archivedAt) {
        stopCapturing();
        const preferences = usePreferencesStore.getState();
        if (preferences.agentIdForWorkspace(workspaceKey) === agentId) {
          preferences.clearAgentForWorkspace(workspaceKey);
        }
        preferences.removeRecentSession(agentId);
        return false;
      }

      committedGenerations = commitRestoredSessionGeneration(
        set,
        get,
        restoreRequestGeneration,
      );
      if (!committedGenerations) {
        stopCapturing();
        throw new SessionRestoreSupersededError();
      }
      const { restoreGeneration, timelineGeneration } = committedGenerations;

      // Tear down the previous session's subscriptions and flip the store to
      // the new agent's metadata immediately. tail/head start empty — the
      // timeline merge below fills them in once the second RPC resolves.
      const previousStream = get()._unsubStream;
      const previousUpdate = get()._unsubUpdate;
      const previousPermission = get()._unsubPermission;
      previousStream?.();
      previousUpdate?.();
      previousPermission?.();

      const agent = fetched.agent;
      client.setActiveAgent?.(agent.id);
      // Rehydrate any queued follow-ups the user typed before the previous
      // session ended, so a cold restart doesn't swallow them.
      const persistedQueue = usePreferencesStore.getState().queuedMessagesForAgent(agent.id);
      set({
        agentId: agent.id,
        agentStatus: agent.status,
        provider: agent.provider,
        model: agent.model,
        cwd: agent.cwd,
        workspaceId: agent.workspaceId ?? null,
        usage: agent.usage ?? null,
        initialPrompt: "",
        tail: [],
        head: [],
        isStreaming: agent.status === "running",
        queued: persistedQueue,
        _unsubStream: null,
        _unsubUpdate: null,
        _unsubPermission: null,
      });

      usePreferencesStore.getState().setAgentForWorkspace(workspaceKey, agent.id);
      rememberRecentSession({
        agentId: agent.id,
        workspaceId: agent.workspaceId ?? null,
        cwd: agent.cwd,
        title: agent.title,
        provider: agent.provider,
        model: agent.model,
        updatedAt: agent.updatedAt,
      });
      noteStartupTrace("session restored into store (metadata)", {
        agentId: agent.id,
        cwd: agent.cwd,
        workspaceId: agent.workspaceId ?? null,
        status: agent.status,
      });

      // Subscribe before returning so the Writer is live immediately. The
      // temporary capture above was installed before the timeline snapshot and
      // remains active until background hydration rebases the transcript.
      set(installAgentSubscriptions(client, set, get, { restoreGeneration }));
      void hydrateAgentTimeline({
        agentId: agent.id,
        restoreGeneration,
        timelineGeneration,
        metadataStatus: agent.status,
        timelinePromise: fetchTimelineP,
        capturedEvents,
        stopCapturing,
        set,
        get,
      });
      return true;
    },

    catchUpAgent: async () => {
      const client = getClient();
      const current = get();
      if (!current.agentId) return;

      const agentId = current.agentId;
      const restoreGeneration = current._restoreGeneration;
      const timelineGeneration = beginTimelineHydration(set, get);
      const capturedEvents: CapturedStreamEvent[] = [];
      let captureInstalled = true;
      const stopCapture = installTimelineCapture(
        client,
        agentId,
        () => isCurrentHydration(get, agentId, restoreGeneration, timelineGeneration),
        capturedEvents,
      );
      const stopCapturing = () => {
        if (!captureInstalled) return;
        captureInstalled = false;
        stopCapture();
      };
      const timelinePromise = measureStartupTrace(
        "session.catchUpTimeline",
        () =>
          client.fetchAgentTimeline(agentId, {
            direction: "tail",
            projection: "projected",
            limit: 500,
          }),
        { agentId, limit: 500 },
      );

      await hydrateAgentTimeline({
        agentId,
        restoreGeneration,
        timelineGeneration,
        metadataStatus: current.agentStatus,
        timelinePromise,
        capturedEvents,
        stopCapturing,
        set,
        get,
      });
    },

    sendMessage: async (text: string, attachments?: BackendAttachment[]) => {
      const { agentId, _restoreGeneration: messageRestoreGeneration } = get();
      if (!agentId) throw new Error("No active agent");

      const client = getClient();

      // If a turn is already running, park the message in the queue instead of
      // dispatching it. It does NOT enter the transcript — it stays visible as a
      // deletable queued chip until the turn ends, at which point drainQueue()
      // merges all queued entries into a single send. Also mirrored to
      // persistent prefs so a cold restart (or process kill) that lands on an
      // idle agent still flushes the queue instead of discarding typed text.
      const queueWasIdle = !get().isStreaming;
      if (get().isStreaming || get().queued.length > 0) {
        // Attachments wait with their message. The queue keeps them in memory
        // only (see QueuedMessage), so the payload never reaches preferences.
        const currentQueue = get().queued;
        const queuedMessage: QueuedMessage = {
          id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          text,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
        };
        const next = [
          ...currentQueue,
          queuedMessage,
        ];
        set({ queued: next });
        persistVisibleQueue(agentId, currentQueue, next);
        if (queueWasIdle) {
          setTimeout(() => {
            const current = get();
            if (
              current.agentId === agentId &&
              current._restoreGeneration === messageRestoreGeneration &&
              !current.isStreaming &&
              current.queued.length > 0
            ) {
              void current.drainQueue();
            }
          }, 0);
        }
        return;
      }

      // Optimistic user message in tail. Prefer an id the backend also stores,
      // so the echo and history replace this row instead of adding a twin.
      const messageId = client.createMessageId?.() ?? createClientMessageId();
      const optimisticItem: StreamItem = {
        kind: "user_message",
        id: `user-${messageId}`,
        messageId,
        text,
        // Show the chosen images in the transcript straight away.
        ...(attachments && attachments.length > 0
          ? { images: attachments.map((file) => `data:${file.mime};base64,${file.base64}`) }
          : {}),
        timestamp: new Date().toISOString(),
        optimistic: true,
      };

      set((state: SessionStore) => ({
        tail: [...state.tail, optimisticItem],
        agentStatus: "running",
        isStreaming: true,
      }));

      try {
        await client.sendAgentMessage(agentId, text, { messageId, attachments });
        watchFirstStreamStep(agentId, get);
      } catch {
        if (
          get().agentId !== agentId ||
          get()._restoreGeneration !== messageRestoreGeneration
        ) return;
        set((state: SessionStore) => {
          const stillOptimistic = state.tail.some(
            (item) =>
              item.id === optimisticItem.id &&
              item.kind === "user_message" &&
              item.optimistic,
          );
          if (!stillOptimistic) return {};
          return {
            tail: state.tail.filter((item) => item.id !== optimisticItem.id),
            agentStatus: "idle",
            isStreaming: false,
          };
        });
      }
    },

    editQueued: (id: string, text: string) => {
      const currentQueue = get().queued;
      const next = currentQueue.map((q) => (q.id === id ? { ...q, text } : q));
      if (next.every((q, index) => q === currentQueue[index])) return;
      set({ queued: next });
      const agentId = get().agentId;
      if (agentId) {
        persistVisibleQueue(agentId, currentQueue, next);
      }
    },

    removeQueued: (id: string) => {
      const currentQueue = get().queued;
      const next = currentQueue.filter((q) => q.id !== id);
      set({ queued: next });
      const agentId = get().agentId;
      if (agentId) {
        persistVisibleQueue(agentId, currentQueue, next);
      }
    },

    prioritizeQueued: (id: string) => {
      const currentQueue = get().queued;
      const index = currentQueue.findIndex((q) => q.id === id);
      if (index <= 0) return;
      const item = currentQueue[index]!;
      const next = [item, ...currentQueue.slice(0, index), ...currentQueue.slice(index + 1)];
      set({ queued: next });
      const agentId = get().agentId;
      if (agentId) {
        persistVisibleQueue(agentId, currentQueue, next);
      }
    },

    sendQueuedNow: async (id: string) => {
      const { agentId, queued, isStreaming, _restoreGeneration } = get();
      if (!agentId) return;
      const target = queued.find((q) => q.id === id);
      if (!target) return;
      const client = getClient();
      const backendKey = usePreferencesStore.getState().activeBackendKey;

      const remaining = queued.filter((q) => q.id !== id);
      persistVisibleQueue(agentId, queued, remaining);
      set({ queued: remaining });

      if (isStreaming) {
        try {
          await client.cancelAgent(agentId);
          if (get().agentId !== agentId || get()._restoreGeneration !== _restoreGeneration) return;
          set({ isStreaming: false, agentStatus: "idle" });
        } catch {
          // If cancel fails, fall through and try sending when possible.
        }
      }

      if (get().isStreaming) {
        // Could not stop the running turn; keep message queued at front for next.
        const current = get().queued;
        const restored = [target, ...current.filter((q) => q.id !== target.id)];
        set({ queued: restored });
        if (get().agentId === agentId) {
          persistVisibleQueue(agentId, current, restored);
        }
        return;
      }

      const messageId = target.messageId ?? client.createMessageId?.() ?? createClientMessageId();
      const attachments = target.attachments ?? [];
      const optimisticItem: StreamItem = {
        kind: "user_message",
        id: `user-${messageId}`,
        messageId,
        text: target.text,
        ...(attachments.length > 0
          ? { images: attachments.map((file) => `data:${file.mime};base64,${file.base64}`) }
          : {}),
        timestamp: new Date().toISOString(),
        optimistic: true,
      };
      set((state: SessionStore) => ({
        tail: [...state.tail, optimisticItem],
        agentStatus: "running",
        isStreaming: true,
      }));

      try {
        await client.sendAgentMessage(agentId, target.text, {
          messageId,
          attachments: attachments.length > 0 ? attachments : undefined,
        });
        watchFirstStreamStep(agentId, get);
        removePersistedQueueEntries(agentId, new Set([target.id]), new Set(), backendKey);
      } catch {
        if (get().agentId !== agentId || get()._restoreGeneration !== _restoreGeneration) return;
        const stillOptimistic = get().tail.some(
          (item) => item.id === optimisticItem.id && item.kind === "user_message" && item.optimistic,
        );
        if (!stillOptimistic) {
          removePersistedQueueEntries(agentId, new Set([target.id]));
          return;
        }
        set((state: SessionStore) => ({
          tail: state.tail.filter((item) => item.id !== optimisticItem.id),
          queued: state.queued.some((q) => q.id === target.id) ? state.queued : [target, ...state.queued],
          agentStatus: "idle",
          isStreaming: false,
        }));
        persistVisibleQueue(agentId, get().queued.filter((q) => q.id !== target.id), get().queued);
      }
    },

    // Dispatch queued follow-ups as one message. Called when a turn ends. All
    // queued entries are merged (joined with blank lines) into a single send,
    // and shown in the transcript as one optimistic user message.
    drainQueue: async () => {
      const {
        agentId,
        queued,
        isStreaming,
        _restoreGeneration: queuedRestoreGeneration,
      } = get();
      // This check and the state transition below run in one synchronous turn,
      // so a direct send cannot start between them and race the queued batch.
      if (!agentId || queued.length === 0 || isStreaming) return;

      const client = getClient();
      // A retry entry represents one previously-dispatched merged batch. Keep
      // it separate from later follow-ups and reuse its messageId so the
      // backend can de-duplicate an accepted request whose acknowledgement was
      // lost.
      const retryMessageId = queued[0]?.messageId;
      const batchEnd = retryMessageId
        ? (() => {
            let index = 1;
            while (queued[index]?.messageId === retryMessageId) index += 1;
            return index;
          })()
        : (() => {
            const retryIndex = queued.findIndex((item) => item.messageId);
            return retryIndex > 0 ? retryIndex : queued.length;
          })();
      const batch = queued.slice(0, batchEnd);
      const remainingQueue = queued.slice(batchEnd);
      const merged = batch.map((q) => q.text).join("\n\n");
      // Images from every entry in the batch ride with the merged text.
      const attachments = batch.flatMap((item) => item.attachments ?? []);
      const messageId =
        retryMessageId ?? client.createMessageId?.() ?? createClientMessageId();
      const inFlightEntry: QueuedMessage = retryMessageId
        ? batch[0]!
        : {
            id: `q-send-${messageId}`,
            text: merged,
            messageId,
            ...(attachments.length > 0 ? { attachments } : {}),
          };
      const optimisticItem: StreamItem = {
        kind: "user_message",
        id: `user-${messageId}`,
        messageId,
        text: merged,
        ...(attachments.length > 0
          ? { images: attachments.map((file) => `data:${file.mime};base64,${file.base64}`) }
          : {}),
        timestamp: new Date().toISOString(),
        optimistic: true,
      };
      set((state: SessionStore) => ({
        tail: [...state.tail, optimisticItem],
        queued: remainingQueue,
        agentStatus: "running",
        isStreaming: true,
      }));
      persistVisibleQueue(agentId, queued, [inFlightEntry, ...remainingQueue]);

      const backendKey = usePreferencesStore.getState().activeBackendKey;
      try {
        await client.sendAgentMessage(agentId, merged, {
          messageId,
          attachments: attachments.length > 0 ? attachments : undefined,
        });
        watchFirstStreamStep(agentId, get);
        removePersistedQueueEntries(agentId, new Set([inFlightEntry.id]), new Set(), backendKey);
      } catch {
        if (
          get().agentId !== agentId ||
          get()._restoreGeneration !== queuedRestoreGeneration
        ) return;
        const stillOptimistic = get().tail.some(
          (item) =>
            item.id === optimisticItem.id &&
            item.kind === "user_message" &&
            item.optimistic,
        );
        if (!stillOptimistic) {
          removePersistedQueueEntries(agentId, new Set([inFlightEntry.id]));
          return;
        }
        // The daemon rejected the batch. Put it back ahead of anything queued
        // while the RPC was in flight, and keep the persisted copy recoverable.
        set((state: SessionStore) => ({
          tail: state.tail.filter((item) => item.id !== optimisticItem.id),
          queued: state.queued.some((item) => item.id === inFlightEntry.id)
            ? state.queued
            : [inFlightEntry, ...state.queued],
          agentStatus: "idle",
          isStreaming: false,
        }));
      }
    },

    cancelAgent: async () => {
      const { agentId, _restoreGeneration: generation } = get();
      if (!agentId) return;

      const client = getClient();
      const backendKey = usePreferencesStore.getState().activeBackendKey;
      await client.cancelAgent(agentId);
      setBackendQueuedMessages(backendKey, agentId, []);
      if (get()._restoreGeneration !== generation || useConnectionStore.getState().client !== client) return;
      // Cancelling abandons any queued follow-ups too.
      set({ isStreaming: false, queued: [] });
    },

    // Change the model on the current agent in place. The daemon keeps the same
    // agent/session; only the model backing the next turn changes.
    setModel: async (model: string | null) => {
      const { agentId, _restoreGeneration: generation } = get();
      if (!agentId) throw new Error("No active agent");

      const client = getClient();
      await client.setAgentModel(agentId, model);
      if (get()._restoreGeneration !== generation || useConnectionStore.getState().client !== client) return;
      set({ model });
    },

    // Switch to a different provider. Providers are separate agent backends, so
    // this transparently spins up a new agent against the same cwd/workspace and
    // hands it the prior conversation as context. The on-screen transcript is
    // preserved so the switch is invisible to the user.
    switchProvider: async (provider: string, model?: string | null) => {
      const { cwd, workspaceId, tail, head } = get();
      if (!cwd) throw new Error("No working directory for the current session");

      const transcript = serializeTranscript([...tail, ...head]);
      const systemPromptOverride = buildCarryoverPrompt(transcript);

      await get().createAgent(provider, cwd, "", {
        model: model ?? undefined,
        workspaceId: workspaceId ?? undefined,
        systemPromptOverride,
        preserveTranscript: true,
        archivePrevious: true,
      });
    },

    setAgentStatus: (status: AgentStatus) => set({ agentStatus: status }),

    reset: () => {
      useConnectionStore.getState().client?.setActiveAgent?.(null);
      const restoreRequestGeneration = get()._restoreRequestGeneration + 1;
      const restoreGeneration = get()._restoreGeneration + 1;
      const timelineGeneration = get()._timelineGeneration + 1;
      const prevStream = get()._unsubStream;
      const prevUpdate = get()._unsubUpdate;
      const prevPermission = get()._unsubPermission;
      prevStream?.();
      prevUpdate?.();
      prevPermission?.();

      set({
        agentId: null,
        agentStatus: "closed",
        provider: null,
        model: null,
        cwd: null,
        workspaceId: null,
        usage: null,
        initialPrompt: "",
        tail: [],
        head: [],
        isStreaming: false,
        queued: [],
        _unsubStream: null,
        _unsubUpdate: null,
        _unsubPermission: null,
        _restoreRequestGeneration: restoreRequestGeneration,
        _restoreGeneration: restoreGeneration,
        _timelineGeneration: timelineGeneration,
      });
    },
  })),
);
