import { create } from "zustand";
import { persist } from "zustand/middleware";
import { persistStorage } from "./persist-storage";
import { normalizeWorkspaceCwd } from "./workspace-session-key";

// Builds a stable key for per-document state (currently scroll offset) that is
// unique across workspaces and document paths.
export function docScrollKey(cwd: string, path: string): string {
  return `${cwd}::${path}`;
}

// Key for a project the user removed from the sidebar list. Connections are
// keyed too, so hiding a directory on one backend leaves the same path alone on
// another. Hiding is local: the backend keeps listing the directory and its
// sessions stay on the server.
export function hiddenProjectKey(connectionId: string, cwd: string): string {
  return `${connectionId}:${normalizeWorkspaceCwd(cwd)}`;
}

// A workspace the user opened before, remembered so the picker can offer
// one-tap shortcuts back to it. Most-recently-used first.
export interface RecentWorkspace {
  id: string | null;
  label: string;
  cwd: string;
  lastOpenedAt?: string;
  // Set when the user pins the workspace to the top of the sidebar list.
  // Pinned entries are not evicted by the MAX_RECENT_WORKSPACES cap.
  pinnedAt?: string;
}

// A queued follow-up the user typed while a turn was still running. Persisted
// per-agent so a cold start that lands on an idle agent still dispatches the
// pending text instead of silently losing it.
export interface PersistedQueuedMessage {
  id: string;
  text: string;
  // Present for a batch whose delivery is in flight or being retried. Paseo
  // de-duplicates send_agent_message by this client-provided identity.
  messageId?: string;
}

// A recently connected writing session, remembered so the workspace switcher
// can restore it directly without making the user re-pick its workspace first.
export interface RecentSession {
  agentId: string;
  workspaceId: string | null;
  workspaceLabel: string;
  cwd: string;
  title: string;
  provider: string | null;
  model: string | null;
  updatedAt: string;
}

/** The system prompt sent as the first message when a new chat session starts; editable in Settings. */
export const DEFAULT_AGENT_PROMPT =
  "You are a versatile agent in this workspace for coding, writing, and creating. Help with code, documents, ideas, and files as needed, and use the available context to give clear, practical results.";

/** The default template for file comments; editable in Settings. */
export const DEFAULT_COMMENT_PROMPT = `File: {filename}

Selected text:
"""
{selected_text}
"""

{message}`;

const MAX_RECENT_WORKSPACES = 8;
const MAX_RECENT_SESSIONS = 8;

export interface BackendPreferences {
  lastProvider: string | null;
  lastModel: string | null;
  lastCwd: string;
  lastWorkspaceId: string | null;
  lastDocumentByCwd: Record<string, string>;
  scrollByDocument: Record<string, number>;
  agentIdByWorkspaceKey: Record<string, string>;
  queuedMessagesByAgent: Record<string, PersistedQueuedMessage[]>;
  recentWorkspaces: RecentWorkspace[];
  recentSessions: RecentSession[];
  webPreviewRootCache: Record<string, string>;
}

function emptyBackendPreferences(): BackendPreferences {
  return {
    lastProvider: null,
    lastModel: null,
    lastCwd: "",
    lastWorkspaceId: null,
    lastDocumentByCwd: {},
    scrollByDocument: {},
    agentIdByWorkspaceKey: {},
    queuedMessagesByAgent: {},
    recentWorkspaces: [],
    recentSessions: [],
    webPreviewRootCache: {},
  };
}

function backendPreferences(state: PreferencesStore): BackendPreferences {
  return {
    lastProvider: state.lastProvider,
    lastModel: state.lastModel,
    lastCwd: state.lastCwd,
    lastWorkspaceId: state.lastWorkspaceId,
    lastDocumentByCwd: state.lastDocumentByCwd,
    scrollByDocument: state.scrollByDocument,
    agentIdByWorkspaceKey: state.agentIdByWorkspaceKey,
    queuedMessagesByAgent: state.queuedMessagesByAgent,
    recentWorkspaces: state.recentWorkspaces,
    recentSessions: state.recentSessions,
    webPreviewRootCache: state.webPreviewRootCache,
  };
}

// Remembers the user's last new-session choices so they don't have to re-pick a
// provider/model or re-type a working directory on every launch. Persisted via
// the same cross-platform storage adapter as the connection store.
interface PreferencesStore {
  sidebarTab: "files" | "projects";
  setSidebarTab: (tab: "files" | "projects") => void;
  collapsedProjectSources: Record<string, boolean>;
  toggleProjectSource: (connectionId: string) => void;
  activeBackendKey: string | null;
  preferencesByBackend: Record<string, BackendPreferences>;
  activateBackend: (key: string, kind: "paseo" | "openclaw" | "opencode") => void;
  lastProvider: string | null;
  lastModel: string | null;
  lastCwd: string;
  lastWorkspaceId: string | null;
  // Prompts the user can tune. The agent prompt is sent when a session is
  // created; the comment prompt is prepended to file and quote messages.
  agentPrompt: string;
  commentPrompt: string;
  setAgentPrompt: (value: string) => void;
  setCommentPrompt: (value: string) => void;
  // Last opened document path (relative to cwd), keyed by workspace cwd.
  lastDocumentByCwd: Record<string, string>;
  // Last editor scroll offset (px), keyed by docScrollKey(cwd, path).
  scrollByDocument: Record<string, number>;
  // Current Paseo agent, keyed by stable workspace ID when available, otherwise
  // by the normalized working directory. The daemon retains the actual history.
  agentIdByWorkspaceKey: Record<string, string>;
  // Follow-up chat messages the user queued while a turn was running, keyed by
  // agent ID. Persisted so a cold restart that lands on an idle agent still
  // flushes the queue instead of discarding typed-but-undelivered text.
  queuedMessagesByAgent: Record<string, PersistedQueuedMessage[]>;
  // Workspaces the user has opened, most-recent first, for picker shortcuts.
  recentWorkspaces: RecentWorkspace[];
  // Sessions the user connected before, most-recent first, for one-tap restore.
  recentSessions: RecentSession[];
  // Projects removed from the sidebar list, keyed by hiddenProjectKey(). Local
  // only: the rows disappear here, while the backend and its sessions stay put.
  hiddenProjects: Record<string, boolean>;
  // Previously discovered web-preview root path, keyed by workspace ID (or by
  // normalized cwd when no workspace id is available). "" means "preview lives
  // at cwd root"; "__none__" means "no preview exists" — both are legitimate
  // results we don't want to re-discover on every switch.
  webPreviewRootCache: Record<string, string>;
  hasHydrated: boolean;

  setLastProvider: (provider: string | null) => void;
  setLastModel: (model: string | null) => void;
  setLastCwd: (cwd: string) => void;
  setLastWorkspaceId: (workspaceId: string | null) => void;
  setLastDocument: (cwd: string, path: string) => void;
  setDocumentScroll: (cwd: string, path: string, offset: number) => void;
  getDocumentScroll: (cwd: string, path: string) => number;
  agentIdForWorkspace: (workspaceKey: string) => string | null;
  setAgentForWorkspace: (workspaceKey: string, agentId: string) => void;
  clearAgentForWorkspace: (workspaceKey: string) => void;
  queuedMessagesForAgent: (agentId: string) => PersistedQueuedMessage[];
  setQueuedMessagesForAgent: (agentId: string, queued: PersistedQueuedMessage[]) => void;
  clearQueuedMessagesForAgent: (agentId: string) => void;
  addRecentWorkspace: (workspace: RecentWorkspace) => void;
  removeRecentWorkspace: (cwd: string) => void;
  togglePinWorkspace: (workspace: RecentWorkspace) => void;
  addRecentSession: (session: RecentSession) => void;
  removeRecentSession: (agentId: string) => void;
  hideProject: (connectionId: string, cwd: string) => void;
  showProject: (connectionId: string, cwd: string) => void;
  webPreviewRootForKey: (key: string) => string | null;
  setWebPreviewRootForKey: (key: string, root: string | null) => void;
  _setHydrated: () => void;
}

export const usePreferencesStore = create<PreferencesStore>()(
  persist(
    (set, get) => ({
      sidebarTab: "files",
      setSidebarTab: (sidebarTab) => set({ sidebarTab }),
      agentPrompt: DEFAULT_AGENT_PROMPT,
      commentPrompt: DEFAULT_COMMENT_PROMPT,
      setAgentPrompt: (agentPrompt) => set({ agentPrompt }),
      setCommentPrompt: (commentPrompt) => set({ commentPrompt }),
      collapsedProjectSources: {},
      toggleProjectSource: (connectionId) => set((state) => ({
        collapsedProjectSources: {
          ...state.collapsedProjectSources,
          [connectionId]: !state.collapsedProjectSources[connectionId],
        },
      })),
      activeBackendKey: null,
      preferencesByBackend: {},
      lastProvider: null,
      lastModel: null,
      lastCwd: "/tmp/puff",
      lastWorkspaceId: null,
      lastDocumentByCwd: {},
      scrollByDocument: {},
      agentIdByWorkspaceKey: {},
      queuedMessagesByAgent: {},
      recentWorkspaces: [],
      recentSessions: [],
      hiddenProjects: {},
      webPreviewRootCache: {},
      hasHydrated: false,

      activateBackend: (key, kind) =>
        set((state) => {
          if (state.activeBackendKey === key) return state;
          const contexts = { ...state.preferencesByBackend };
          const current = backendPreferences(state);
          if (state.activeBackendKey) {
            contexts[state.activeBackendKey] = current;
          } else {
            // Existing installations have Paseo preferences without an endpoint key.
            contexts.legacyPaseo = current;
          }
          const next = contexts[key] ??
            (kind === "paseo" && contexts.legacyPaseo
              ? contexts.legacyPaseo
              : emptyBackendPreferences());
          if (kind === "paseo" && !contexts[key]) delete contexts.legacyPaseo;
          return { ...next, activeBackendKey: key, preferencesByBackend: contexts };
        }),

      setLastProvider: (lastProvider) => set({ lastProvider }),
      setLastModel: (lastModel) => set({ lastModel }),
      setLastCwd: (lastCwd) => set({ lastCwd }),
      setLastWorkspaceId: (lastWorkspaceId) => set({ lastWorkspaceId }),
      setLastDocument: (cwd, path) =>
        set((state) => ({
          lastDocumentByCwd: { ...state.lastDocumentByCwd, [cwd]: path },
        })),
      setDocumentScroll: (cwd, path, offset) =>
        set((state) => ({
          scrollByDocument: {
            ...state.scrollByDocument,
            [docScrollKey(cwd, path)]: offset,
          },
        })),
      getDocumentScroll: (cwd, path) =>
        get().scrollByDocument[docScrollKey(cwd, path)] ?? 0,
      agentIdForWorkspace: (workspaceKey) =>
        get().agentIdByWorkspaceKey[workspaceKey] ?? null,
      setAgentForWorkspace: (workspaceKey, agentId) =>
        set((state) => ({
          agentIdByWorkspaceKey: { ...state.agentIdByWorkspaceKey, [workspaceKey]: agentId },
        })),
      clearAgentForWorkspace: (workspaceKey) =>
        set((state) => {
          const { [workspaceKey]: _removed, ...agentIdByWorkspaceKey } = state.agentIdByWorkspaceKey;
          return { agentIdByWorkspaceKey };
        }),
      queuedMessagesForAgent: (agentId) =>
        get().queuedMessagesByAgent[agentId] ?? [],
      setQueuedMessagesForAgent: (agentId, queued) =>
        set((state) => {
          if (queued.length === 0) {
            const { [agentId]: _removed, ...rest } = state.queuedMessagesByAgent;
            return { queuedMessagesByAgent: rest };
          }
          return {
            queuedMessagesByAgent: { ...state.queuedMessagesByAgent, [agentId]: queued },
          };
        }),
      clearQueuedMessagesForAgent: (agentId) =>
        set((state) => {
          const { [agentId]: _removed, ...rest } = state.queuedMessagesByAgent;
          return { queuedMessagesByAgent: rest };
        }),
      addRecentWorkspace: (workspace) =>
        set((state) => {
          // De-dupe by cwd, promote to the front, cap the list — but preserve
          // the existing pinnedAt stamp and never evict pinned entries.
          const prior = state.recentWorkspaces.find((w) => w.cwd === workspace.cwd);
          const rest = state.recentWorkspaces.filter((w) => w.cwd !== workspace.cwd);
          const stamped: RecentWorkspace = {
            ...workspace,
            lastOpenedAt: workspace.lastOpenedAt ?? new Date().toISOString(),
            pinnedAt: workspace.pinnedAt ?? prior?.pinnedAt,
          };
          const next = [stamped, ...rest];
          const pinned = next.filter((w) => w.pinnedAt);
          const unpinned = next.filter((w) => !w.pinnedAt);
          return {
            recentWorkspaces: [
              ...pinned,
              ...unpinned.slice(0, Math.max(0, MAX_RECENT_WORKSPACES - pinned.length)),
            ],
          };
        }),
      removeRecentWorkspace: (cwd) =>
        set((state) => ({
          recentWorkspaces: state.recentWorkspaces.filter((w) => w.cwd !== cwd),
        })),
      togglePinWorkspace: (workspace) =>
        set((state) => {
          const prior = state.recentWorkspaces.find((w) => w.cwd === workspace.cwd);
          if (!prior) {
            return {
              recentWorkspaces: [
                { ...workspace, pinnedAt: new Date().toISOString() },
                ...state.recentWorkspaces,
              ],
            };
          }
          // A workspace added only because it was pinned has no open timestamp.
          // Once unpinned it should disappear instead of becoming fake history.
          if (prior.pinnedAt && !prior.lastOpenedAt) {
            return {
              recentWorkspaces: state.recentWorkspaces.filter(
                (w) => w.cwd !== workspace.cwd,
              ),
            };
          }
          return {
            recentWorkspaces: state.recentWorkspaces.map((w) =>
              w.cwd === workspace.cwd
                ? {
                    ...w,
                    id: workspace.id,
                    label: workspace.label,
                    pinnedAt: w.pinnedAt ? undefined : new Date().toISOString(),
                  }
                : w,
            ),
          };
        }),
      addRecentSession: (session) =>
        set((state) => {
          const rest = state.recentSessions.filter((s) => s.agentId !== session.agentId);
          return {
            recentSessions: [session, ...rest].slice(0, MAX_RECENT_SESSIONS),
          };
        }),
      removeRecentSession: (agentId) =>
        set((state) => ({
          recentSessions: state.recentSessions.filter((session) => session.agentId !== agentId),
        })),
      hideProject: (connectionId, cwd) =>
        set((state) => {
          const key = hiddenProjectKey(connectionId, cwd);
          if (state.hiddenProjects[key]) return state;
          return { hiddenProjects: { ...state.hiddenProjects, [key]: true } };
        }),
      showProject: (connectionId, cwd) =>
        set((state) => {
          const key = hiddenProjectKey(connectionId, cwd);
          if (!state.hiddenProjects[key]) return state;
          const { [key]: _shown, ...hiddenProjects } = state.hiddenProjects;
          return { hiddenProjects };
        }),
      webPreviewRootForKey: (key) => {
        const value = get().webPreviewRootCache[key];
        return typeof value === "string" ? value : null;
      },
      setWebPreviewRootForKey: (key, root) =>
        set((state) => {
          // null → cache "no preview" so we skip the discovery RPCs next time.
          // "" is a legitimate hit (preview lives at cwd root).
          const next = { ...state.webPreviewRootCache };
          next[key] = root ?? "__none__";
          return { webPreviewRootCache: next };
        }),
      _setHydrated: () => set({ hasHydrated: true }),
    }),
    {
      name: "puff-preferences",
      storage: persistStorage,
      onRehydrateStorage: () => (state) => {
        state?._setHydrated();
      },
    },
  ),
);

/** Read a connection's preferences without changing the active editor context. */
export function getBackendPreferences(key: string | null): BackendPreferences {
  const state = usePreferencesStore.getState();
  return key === state.activeBackendKey
    ? backendPreferences(state)
    : (key ? state.preferencesByBackend[key] : undefined) ?? emptyBackendPreferences();
}

/** An RPC finishing in the background must write to its originating connection. */
export function setBackendQueuedMessages(
  key: string | null,
  agentId: string,
  queued: PersistedQueuedMessage[],
): void {
  usePreferencesStore.setState((state) => {
    const context = key === state.activeBackendKey
      ? backendPreferences(state)
      : (key ? state.preferencesByBackend[key] : undefined) ?? emptyBackendPreferences();
    const queuedMessagesByAgent = { ...context.queuedMessagesByAgent };
    if (queued.length) queuedMessagesByAgent[agentId] = queued;
    else delete queuedMessagesByAgent[agentId];
    if (key === state.activeBackendKey) return { queuedMessagesByAgent };
    if (!key) return {};
    return { preferencesByBackend: {
      ...state.preferencesByBackend,
      [key]: { ...context, queuedMessagesByAgent },
    } };
  });
}

export function toggleBackendWorkspacePin(key: string, workspace: RecentWorkspace): void {
  const state = usePreferencesStore.getState();
  if (key === state.activeBackendKey) {
    state.togglePinWorkspace(workspace);
    return;
  }
  const context = getBackendPreferences(key);
  const prior = context.recentWorkspaces.find((item) => item.cwd === workspace.cwd);
  const recentWorkspaces = !prior
    ? [{ ...workspace, pinnedAt: new Date().toISOString() }, ...context.recentWorkspaces]
    : prior.pinnedAt && !prior.lastOpenedAt
      ? context.recentWorkspaces.filter((item) => item.cwd !== workspace.cwd)
      : context.recentWorkspaces.map((item) => item.cwd === workspace.cwd
        ? { ...item, id: workspace.id, label: workspace.label, pinnedAt: item.pinnedAt ? undefined : new Date().toISOString() } : item);
  usePreferencesStore.setState({ preferencesByBackend: {
    ...state.preferencesByBackend, [key]: { ...context, recentWorkspaces },
  } });
}
