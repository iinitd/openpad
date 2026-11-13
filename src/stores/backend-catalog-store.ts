import { useEffect } from "react";
import { create } from "zustand";
import type { BackendAgentEntry, BackendWorkspaceEntry, WriterBackend } from "../backend";
import { useConnectionStore, type BackendConnection } from "./connection-store";
import { startVisibilityAwarePoller } from "../utils/visibility-poller";

/** Discovery belongs to its source connection; backend IDs remain unchanged. */
export interface BackendCatalogEntry {
  connectionId: string;
  label: string;
  endpoint: string;
  workspaces: BackendWorkspaceEntry[];
  sessions: BackendAgentEntry[];
  workspacesLoaded: boolean;
  sessionsLoaded: boolean;
  workspacesError: string | null;
  sessionsError: string | null;
}
interface BackendCatalogStore {
  entries: BackendCatalogEntry[];
  loading: boolean;
  refresh: (connectionId?: string, options?: { workspaces?: boolean }) => Promise<void>;
  syncConnections: () => void;
}
const clients = new Map<string, WriterBackend>();
const inFlight = new Map<string, { client: WriterBackend; promise: Promise<void> }>();

function emptyEntry(connection: BackendConnection): BackendCatalogEntry {
  return { connectionId: connection.id, label: connection.label,
    endpoint: connection.mode === "relay" ? "Relay" : connection.endpoint,
    workspaces: [], sessions: [], workspacesLoaded: false, sessionsLoaded: false,
    workspacesError: null, sessionsError: null };
}
function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
export function catalogItemKey(connectionId: string, itemId: string): string {
  return JSON.stringify([connectionId, itemId]);
}

export const useBackendCatalogStore = create<BackendCatalogStore>()((set, get) => ({
  entries: [], loading: false,
  syncConnections: () => {
    const connections = useConnectionStore.getState().connections;
    const oldEntries = get().entries;
    const ids = new Set(connections.map((connection) => connection.id));
    for (const id of clients.keys()) if (!ids.has(id)) clients.delete(id);
    const entries = connections.map((connection) => {
      const entry = clients.get(connection.id) === connection.client
        ? oldEntries.find((row) => row.connectionId === connection.id) : undefined;
      clients.set(connection.id, connection.client);
      return entry && entry.label === connection.label ? entry : entry
        ? { ...entry, label: connection.label } : emptyEntry(connection);
    });
    // Saved servers that are not live right now (disconnected, or still waking
    // up) keep a row too. The workspace list is where a server is opened, so it
    // must not hide the ones that are currently offline — otherwise the only way
    // back to them is retyping the URL in Add connection.
    const savedConnections = useConnectionStore.getState().savedConnections;
    for (const saved of savedConnections) {
      if (ids.has(saved.id)) continue;
      entries.push({
        connectionId: saved.id,
        label: saved.label,
        endpoint: saved.mode === "relay" ? "Relay" : saved.endpoint,
        workspaces: [],
        sessions: [],
        workspacesLoaded: true,
        sessionsLoaded: true,
        workspacesError: null,
        sessionsError: null,
      });
    }
    if (entries.length !== oldEntries.length || entries.some((entry, index) => entry !== oldEntries[index])) set({ entries });
  },
  refresh: async (connectionId, options) => {
    get().syncConnections();
    const connections = useConnectionStore.getState().connections.filter((connection) =>
      (!connectionId || connection.id === connectionId) && connection.connectionState.status === "connected");
    await Promise.all(connections.map(async (connection) => {
      const currentRequest = inFlight.get(connection.id);
      if (currentRequest?.client === connection.client) return currentRequest.promise;
      const currentEntry = get().entries.find((row) => row.connectionId === connection.id);
      const loadWorkspaces = options?.workspaces ?? !currentEntry?.workspacesLoaded;
      const isCurrent = () => useConnectionStore.getState().connections.some((item) =>
        item.id === connection.id && item.client === connection.client);
      const update = (patch: Partial<BackendCatalogEntry>) => {
        if (!isCurrent()) return;
        set((state) => ({ entries: state.entries.map((entry) =>
          entry.connectionId === connection.id ? { ...entry, ...patch } : entry) }));
      };
      const request = (async () => {
        const tasks: Promise<void>[] = [];
        if (loadWorkspaces) tasks.push((async () => {
          try {
            const result = await connection.client.fetchWorkspaces();
            update({ workspaces: result.entries, workspacesLoaded: true, workspacesError: null });
          } catch (error) { update({ workspacesLoaded: true, workspacesError: message(error, "Could not load workspaces") }); }
        })());
        tasks.push((async () => {
          try {
            const sessions: BackendAgentEntry[] = [];
            const seenCursors = new Set<string>();
            let cursor: string | undefined;
            do {
              const result = await connection.client.fetchAgents({ scope: "active", filter: { includeArchived: false },
                sort: [{ key: "updated_at", direction: "desc" }], page: { limit: 100, cursor } });
              if (!isCurrent()) return;
              sessions.push(...result.entries.filter((entry) => !entry.agent.archivedAt));
              cursor = result.pageInfo.hasMore ? result.pageInfo.nextCursor ?? undefined : undefined;
              if (result.pageInfo.hasMore && !cursor) throw new Error("Session pagination did not provide its next cursor");
              if (cursor && seenCursors.has(cursor)) throw new Error("Session pagination did not advance");
              if (cursor) seenCursors.add(cursor);
            } while (cursor);
            update({ sessions, sessionsLoaded: true, sessionsError: null });
          } catch (error) { update({ sessionsLoaded: true, sessionsError: message(error, "Could not load sessions") }); }
        })());
        await Promise.all(tasks);
      })();
      inFlight.set(connection.id, { client: connection.client, promise: request });
      set({ loading: true });
      try { await request; }
      finally {
        if (inFlight.get(connection.id)?.promise === request) inFlight.delete(connection.id);
        set({ loading: inFlight.size > 0 });
      }
    }));
  },
}));

/** Keep the visible catalog current across all online backends. */
export function useBackendCatalog({ enabled = true }: { enabled?: boolean } = {}): { entries: BackendCatalogEntry[]; loading: boolean } {
  const entries = useBackendCatalogStore((state) => state.entries);
  const loading = useBackendCatalogStore((state) => state.loading);
  useEffect(() => {
    useBackendCatalogStore.getState().syncConnections();
    if (!enabled) return;
    let stopped = false;
    let currentConnections = useConnectionStore.getState().connections;
    let stopUpdates: Array<() => void> = [];
    const bindUpdates = () => {
      stopUpdates.forEach((stop) => stop());
      stopUpdates = currentConnections.map((connection) => connection.client.onAgentUpdate((message) => {
        if (stopped || !useConnectionStore.getState().connections.some((item) => item.client === connection.client)) return;
        useBackendCatalogStore.setState((state) => ({ entries: state.entries.map((entry) => {
          if (entry.connectionId !== connection.id) return entry;
          const exists = entry.sessions.some((row) => row.agent.id === message.agentId);
          if (!exists) return entry;
          return { ...entry, sessions: entry.sessions.map((row) => row.agent.id === message.agentId ? { agent: message.agent } : row) };
        }) }));
      }));
    };
    bindUpdates();
    const stopConnection = useConnectionStore.subscribe((state) => {
      if (state.connections === currentConnections) return;
      const next = state.connections;
      const changed = next.length !== currentConnections.length || next.some((connection, index) => {
        const previous = currentConnections[index];
        return previous?.client !== connection.client || previous.connectionState.status !== connection.connectionState.status;
      });
      currentConnections = next;
      useBackendCatalogStore.getState().syncConnections();
      if (changed) { bindUpdates(); void useBackendCatalogStore.getState().refresh(undefined, { workspaces: true }); }
    });
    const stopPolling = startVisibilityAwarePoller(() => useBackendCatalogStore.getState().refresh(), 3000, { runImmediately: true });
    return () => { stopped = true; stopConnection(); stopPolling(); stopUpdates.forEach((stop) => stop()); };
  }, [enabled]);
  return { entries, loading };
}
