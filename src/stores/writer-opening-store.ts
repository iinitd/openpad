import { create } from "zustand";
import { useConnectionStore } from "./connection-store";
import { useBackendCatalogStore, type BackendCatalogEntry } from "./backend-catalog-store";
import { usePreferencesStore } from "./preferences-store";
import { useProvidersStore } from "./providers-store";
import { isSessionRestoreSuperseded, useSessionStore } from "./session-store";
import { normalizeWorkspaceCwd, workspaceSessionKey } from "./workspace-session-key";
import { groupDirectoryProjects } from "../editor/directory-projects";
import { measureStartupTrace, noteStartupTrace } from "../utils/startup-trace";
import { showToast } from "../components/Toast";

/** Host navigation intent. Explicit sessions never fall back to another agent. */
export interface WriterOpenTarget {
  connectionId?: string;
  cwd?: string;
  workspaceId?: string | null;
  agentId?: string;
  label?: string;
}

interface WriterOpeningStore {
  opening: boolean;
  error: string | null;
  target: WriterOpenTarget | null;
  open: (target?: WriterOpenTarget) => Promise<boolean>;
  retry: () => Promise<boolean>;
}

class OpeningSuperseded extends Error {}
/** The backend is mid-reconnect: worth a toast, not a persistent error. */
class OpeningTransient extends Error {}
let generation = 0;
let queue: Promise<unknown> = Promise.resolve();
let pending: { key: string; promise: Promise<boolean> } | null = null;

function directoryLabel(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;
}

export const useWriterOpeningStore = create<WriterOpeningStore>()((set, get) => ({
  opening: false,
  error: null,
  target: null,
  retry: () => get().open(get().target ?? undefined),
  open: (requested = {}) => {
    const target = { ...requested, connectionId: requested.connectionId ?? useConnectionStore.getState().activeConnectionId ?? undefined };
    const key = JSON.stringify(target);
    if (pending?.key === key) return pending.promise;
    const requestGeneration = ++generation;
    const previousConnectionId = useConnectionStore.getState().activeConnectionId;
    const previousCwd = useSessionStore.getState().cwd;
    // Publish before activation resets agentId, so the writer cannot auto-open
    // a remembered project in the middle of an explicit selection.
    set({ opening: true, error: null, target });
    const operation = queue.then(async () => {
      let activeClient = useConnectionStore.getState().client;
      const checkGeneration = () => {
        if (generation !== requestGeneration) throw new OpeningSuperseded();
      };
      const checkCurrent = () => {
        checkGeneration();
        const connection = useConnectionStore.getState();
        if (connection.activeConnectionId !== target.connectionId || connection.client !== activeClient) {
          throw new OpeningSuperseded();
        }
      };
      const finish = () => {
        checkCurrent();
        const session = useSessionStore.getState();
        const preferences = usePreferencesStore.getState();
        if (!session.agentId || !session.cwd) throw new Error("Could not open this project.");
        preferences.setLastCwd(session.cwd);
        preferences.setLastWorkspaceId(session.workspaceId);
        preferences.setLastProvider(session.provider);
        preferences.setLastModel(session.model);
        if (previousConnectionId !== target.connectionId || normalizeWorkspaceCwd(previousCwd ?? "") !== normalizeWorkspaceCwd(session.cwd)) {
          preferences.addRecentWorkspace({ id: session.workspaceId, cwd: session.cwd,
            label: target.label || directoryLabel(session.cwd) });
        }
        return true;
      };
      try {
        checkGeneration();
        if (!target.connectionId) throw new Error("No backend connection is available.");
        const connection = useConnectionStore.getState();
        const live = connection.connections.find((entry) => entry.id === target.connectionId);
        if (!live || live.connectionState.status !== "connected") {
          await connection.connectSaved(target.connectionId);
          checkGeneration();
        }
        await useConnectionStore.getState().activateConnection(target.connectionId);
        activeClient = useConnectionStore.getState().client;
        checkCurrent();
        if (!activeClient || useConnectionStore.getState().connectionState.status !== "connected") {
          throw new OpeningTransient("Reconnecting. Try again in a moment.");
        }
        const session = useSessionStore.getState();
        if (!target.agentId && !target.cwd && session.agentId) return finish();
        const preferences = usePreferencesStore.getState();
        let cwd = target.cwd ?? preferences.lastCwd;
        let workspaceId = target.cwd ? target.workspaceId ?? null : preferences.lastWorkspaceId;
        const workspaceKey = workspaceSessionKey(workspaceId, cwd);

        if (target.agentId) {
          if (!await session.restoreAgentById(target.agentId, workspaceKey)) {
            throw new Error("This session is no longer available. Choose another session.");
          }
          return finish();
        }

        // Cold starts restore metadata immediately; provider/catalog discovery
        // and history hydration must not hold up a remembered session.
        if (!target.cwd && cwd && await measureStartupTrace("session.restoreSavedAgent", () => session.restoreAgent(workspaceKey), { workspaceKey })) {
          return finish();
        }
        checkCurrent();
        const loadCatalog = async (): Promise<BackendCatalogEntry> => {
          await useBackendCatalogStore.getState().refresh(target.connectionId, { workspaces: true });
          checkCurrent();
          const source = useBackendCatalogStore.getState().entries.find((entry) => entry.connectionId === target.connectionId);
          if (!source?.sessionsLoaded || source.sessionsError) {
            throw new Error(source?.sessionsError ?? "Sessions are still loading. Try again in a moment.");
          }
          return source;
        };
        const cached = target.cwd ? useBackendCatalogStore.getState().entries.find((entry) =>
          entry.connectionId === target.connectionId && entry.sessionsLoaded && !entry.sessionsError) : undefined;
        let source = cached ?? await loadCatalog();
        if (!target.cwd) {
          const projects = groupDirectoryProjects(source.workspaces, source.sessions);
          const project = projects.find((entry) => entry.cwd === normalizeWorkspaceCwd(cwd))
            ?? projects.find((entry) => workspaceId && entry.workspaceIds.includes(workspaceId))
            ?? projects[0];
          if (!project) throw new Error(source.workspacesError ?? "No project is available to open.");
          cwd = project.cwd;
          workspaceId = project.id;
          noteStartupTrace("opening default project", { cwd, workspaceId });
        }
        const missingIds = new Set<string>();
        const restoreCandidates = async () => {
          const prefs = usePreferencesStore.getState();
          const rememberedIds = prefs.recentSessions
            .filter((entry) => normalizeWorkspaceCwd(entry.cwd) === normalizeWorkspaceCwd(cwd))
            .map((entry) => entry.agentId);
          const workspaceIds = new Set([null, workspaceId, ...source.sessions
            .filter(({ agent }) => normalizeWorkspaceCwd(agent.cwd) === normalizeWorkspaceCwd(cwd))
            .map(({ agent }) => agent.workspaceId ?? null)]);
          for (const id of workspaceIds) {
            const remembered = prefs.agentIdByWorkspaceKey[workspaceSessionKey(id, cwd)];
            if (remembered) rememberedIds.push(remembered);
          }
          const candidates = source.sessions.filter(({ agent }) => !agent.archivedAt &&
            normalizeWorkspaceCwd(agent.cwd) === normalizeWorkspaceCwd(cwd) && !missingIds.has(agent.id));
          candidates.sort((a, b) => {
            const rank = (id: string) => { const index = rememberedIds.indexOf(id); return index < 0 ? Infinity : index; };
            return rank(a.agent.id) - rank(b.agent.id) || b.agent.updatedAt.localeCompare(a.agent.updatedAt);
          });
          for (const { agent } of candidates) {
            if (await useSessionStore.getState().restoreAgentById(agent.id, workspaceSessionKey(agent.workspaceId, agent.cwd))) return true;
            checkCurrent();
            missingIds.add(agent.id);
          }
          return false;
        };
        if (await restoreCandidates()) return finish();
        checkCurrent();
        // A deleted candidate requires fresh enumeration before creating.
        if (cached || missingIds.size) {
          source = await loadCatalog();
          if (await restoreCandidates()) return finish();
          checkCurrent();
        }
        if (source.sessions.some(({ agent }) => !agent.archivedAt && normalizeWorkspaceCwd(agent.cwd) === normalizeWorkspaceCwd(cwd))) {
          throw new Error("The session list is out of date. Try again to open this project.");
        }
        await useProvidersStore.getState().loadProviders({ force: true, cwd });
        checkCurrent();
        const providers = useProvidersStore.getState();
        if (providers.error) throw new Error(providers.error);
        const prefs = usePreferencesStore.getState();
        const usable = providers.entries.filter((entry) => entry.available);
        const chosen = usable.find((entry) => entry.provider === prefs.lastProvider) ?? usable[0];
        if (!chosen) throw new Error("No AI provider is available to open this project.");
        const model = chosen.models.some((entry) => entry.id === prefs.lastModel)
          ? prefs.lastModel : chosen.models.find((entry) => entry.isDefault)?.id;
        await useSessionStore.getState().createAgent(chosen.provider, cwd, "", {
          model: model ?? undefined, workspaceId: workspaceId ?? undefined,
        });
        return finish();
      } catch (error) {
        if (generation !== requestGeneration || error instanceof OpeningSuperseded || isSessionRestoreSuperseded(error)) return false;
        if (error instanceof OpeningTransient) {
          showToast(error.message);
          return false;
        }
        set({ error: error instanceof Error ? error.message : "Could not open project." });
        return false;
      } finally {
        if (generation === requestGeneration) set({ opening: false });
      }
    });
    pending = { key, promise: operation };
    queue = operation;
    void operation.finally(() => { if (pending?.promise === operation) pending = null; });
    return operation;
  },
}));
