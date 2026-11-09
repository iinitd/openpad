import { Platform } from "react-native";
import { create } from "zustand";
import { persist, subscribeWithSelector } from "zustand/middleware";
import type { WriterBackend, ConnectionState, BackendPermissionRequest } from "../backend";
import { connectWithTimeout, connectViaRelay, connectOpenClawGateway, connectOpenCodeServer, redeemOpenCodePairLink } from "../backend";
import { createDemoBackend } from "../backend/demo";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { persistStorage } from "./persist-storage";
import { activateBackendContext, resetBackendViews } from "./backend-context";

export type ConnectionMode = "direct" | "relay" | "openclaw" | "opencode" | "demo";

/** A demo workspace that ships with the app so a fresh install is explorable. */
const DEMO_ENDPOINT = "demo://welcome";
const DEMO_CONTEXT_KEY = "demo:welcome";
const DEMO_ALIAS = "Puff";

export interface BackendConnection {
  id: string;
  label: string;
  mode: ConnectionMode;
  endpoint: string;
  contextKey: string;
  client: WriterBackend;
  connectionState: ConnectionState;
  serverVersion: string | null;
}

export interface SavedBackendConnection {
  id: string;
  /** User-chosen name; the UI falls back to a generated one when empty. */
  alias?: string;
  label: string;
  mode: ConnectionMode;
  endpoint: string;
  password?: string;
  token?: string;
  username?: string;
  autoConnect: boolean;
}

const LEGACY_DIRECT_DAEMON_URL = "ws://localhost:6767/ws";
const DEFAULT_CONNECTION_MODE: ConnectionMode = "direct";

function browserDirectDaemonUrl(): string {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return LEGACY_DIRECT_DAEMON_URL;
  }
  const hostname = window.location.hostname;
  if (!hostname) return LEGACY_DIRECT_DAEMON_URL;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `${protocol}://${host}:6767/ws`;
}

const DEFAULT_DIRECT_DAEMON_URL = browserDirectDaemonUrl();

function defaultGatewayUrl(): string {
  if (Platform.OS !== "web" || typeof window === "undefined") return "ws://localhost:18789";
  const host = window.location.hostname;
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${host.includes(":") ? `[${host}]` : host}:18789`;
}

function defaultOpenCodeUrl(): string {
  if (Platform.OS !== "web" || typeof window === "undefined") return "http://localhost:4096";
  const hostname = window.location.hostname;
  if (!hostname) return "http://localhost:4096";
  const host = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `${window.location.protocol === "https:" ? "https" : "http"}://${host}:4096`;
}

function endpointContextKey(mode: ConnectionMode, endpoint: string): string {
  if (mode === "demo") return DEMO_CONTEXT_KEY;
  if (mode === "relay") return `paseo:relay:${bytesToHex(sha256(utf8ToBytes(endpoint.trim())))}`;
  const url = new URL(endpoint);
  if (mode === "openclaw") {
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol === "https:") url.protocol = "wss:";
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  url.search = "";
  const prefix = mode === "openclaw" ? "openclaw" : mode === "opencode" ? "opencode" : "paseo";
  return `${prefix}:${url.toString()}`;
}

function connectionId(contextKey: string): string {
  return `backend-${bytesToHex(sha256(utf8ToBytes(contextKey)))}`;
}

function connectionLabel(mode: ConnectionMode, endpoint: string): string {
  if (mode === "demo") return "Demo · Welcome tour";
  if (mode === "relay") return "Paseo relay";
  const label = mode === "openclaw" ? "OpenClaw" : mode === "opencode" ? "OpenCode" : "Paseo";
  return `${label} · ${new URL(endpoint).host}`;
}

function savedProfile(state: Pick<ConnectionStore, "mode" | "daemonUrl" | "password" | "pairingLink" | "gatewayUrl" | "gatewayToken" | "opencodeUrl" | "opencodeUsername" | "opencodePassword" | "alias">): SavedBackendConnection {
  const { mode } = state;
  const endpoint = (mode === "openclaw" ? state.gatewayUrl
    : mode === "opencode" ? state.opencodeUrl
    : mode === "relay" ? state.pairingLink
    : state.daemonUrl).trim();
  const alias = state.alias.trim();
  return {
    id: connectionId(endpointContextKey(mode, endpoint)),
    ...(alias ? { alias } : {}),
    label: connectionLabel(mode, endpoint),
    mode,
    endpoint,
    ...(mode === "direct" ? { password: state.password } : {}),
    ...(mode === "openclaw" ? { token: state.gatewayToken } : {}),
    ...(mode === "opencode" ? {
      password: state.opencodePassword,
      username: state.opencodeUsername,
    } : {}),
    autoConnect: true,
  };
}

function activeProjection(connection: BackendConnection | null) {
  return {
    activeConnectionId: connection?.id ?? null,
    client: connection?.client ?? null,
    activeMode: connection?.mode ?? null,
    // Relay endpoints contain the pairing offer; do not display it as a URL.
    activeEndpoint: connection && connection.mode !== "relay" ? connection.endpoint : null,
    connectionState: connection?.connectionState ?? { status: "idle" as const },
    serverVersion: connection?.serverVersion ?? null,
  };
}

interface ConnectionStore {
  connections: BackendConnection[];
  savedConnections: SavedBackendConnection[];
  activeConnectionId: string | null;
  isSwitchingConnection: boolean;
  mode: ConnectionMode;
  daemonUrl: string;
  password: string;
  pairingLink: string;
  gatewayUrl: string;
  gatewayToken: string;
  opencodeUrl: string;
  opencodeUsername: string;
  opencodePassword: string;
  opencodePairLink: string;
  alias: string;
  activeMode: ConnectionMode | null;
  activeEndpoint: string | null;
  client: WriterBackend | null;
  connectionState: ConnectionState;
  serverVersion: string | null;
  // Compatibility launch flag: at least one saved profile enables auto-connect.
  lastConnectedOk: boolean;
  /** Whether the bundled demo workspace is listed and connected. */
  demoEnabled: boolean;
  // Flipped once the persisted state has been rehydrated from storage, so
  // consumers know whether it's safe to read lastConnectedOk for auto-connect.
  hasHydrated: boolean;

  setMode: (mode: ConnectionMode) => void;
  setDaemonUrl: (url: string) => void;
  setPassword: (password: string) => void;
  setPairingLink: (link: string) => void;
  setGatewayUrl: (url: string) => void;
  setGatewayToken: (token: string) => void;
  setOpenCodeUrl: (url: string) => void;
  setOpenCodeUsername: (username: string) => void;
  setOpenCodePassword: (password: string) => void;
  setOpenCodePairLink: (link: string) => void;
  setAlias: (alias: string) => void;
  setConnectionAlias: (id: string, alias: string) => void;
  connect: () => Promise<void>;
  activateConnection: (id: string) => Promise<void>;
  disconnect: (id?: string) => Promise<void>;
  connectSaved: (id: string) => Promise<void>;
  restoreConnections: () => Promise<void>;
  setDemoEnabled: (enabled: boolean) => Promise<void>;
  _setHydrated: () => void;
}

export const useConnectionStore = create<ConnectionStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => {
        const generations = new Map<string, number>();
        const subscriptions = new Map<string, () => void>();
        const retiringClients = new Set<WriterBackend>();
        let activationQueue: Promise<void> = Promise.resolve();
        let restorePromise: Promise<void> | null = null;
        let selectionGeneration = 0;

        const nextGeneration = (id: string) => {
          const generation = (generations.get(id) ?? 0) + 1;
          generations.set(id, generation);
          return generation;
        };

        const serializeActivation = (operation: () => Promise<void>) => {
          const result = activationQueue.then(operation);
          // A failed activation must not prevent later foreground selections.
          activationQueue = result.catch(() => {});
          return result;
        };

        const activate = async (id: string) => {
          const connection = get().connections.find((entry) => entry.id === id);
          if (!connection) throw new Error("Backend connection is no longer available");
          if (get().activeConnectionId === id && get().client === connection.client) return;
          const isCurrent = () => get().connections.some((entry) => entry.id === id && entry.client === connection.client);
          set({ isSwitchingConnection: true });
          try {
            // reset() still sees the outgoing client, including its file scope.
            await resetBackendViews();
            if (!isCurrent()) throw new Error("Backend connection was disconnected during activation");
            await activateBackendContext(connection.contextKey,
              connection.client.kind === "openclaw" ? "openclaw"
                : connection.client.kind === "opencode" ? "opencode"
                : "paseo");
            if (!isCurrent()) throw new Error("Backend connection was disconnected during activation");
            const current = get().connections.find((entry) => entry.id === id)!;
            set({ ...activeProjection(current), lastConnectedOk: get().savedConnections.some((entry) => entry.autoConnect) });
          } finally {
            set({ isSwitchingConnection: false });
          }
        };

        const ensureConnection = async (requested: SavedBackendConnection): Promise<string> => {
          const contextKey = endpointContextKey(requested.mode, requested.endpoint);
          const known = get().savedConnections.find((entry) => endpointContextKey(entry.mode, entry.endpoint) === contextKey);
          const profile = { ...requested, id: known?.id ?? requested.id, label: known?.label ?? requested.label, autoConnect: true };
          const existing = get().connections.find((entry) => entry.contextKey === contextKey && !retiringClients.has(entry.client));
          const existingStatus = existing?.client.getConnectionState().status;
          const credentialsMatch = profile.mode === "direct" ? (profile.password ?? "") === (known?.password ?? "")
            : profile.mode === "openclaw" ? (profile.token ?? "") === (known?.token ?? "")
            : profile.mode === "opencode" ? (profile.password ?? "") === (known?.password ?? "") &&
              (profile.username ?? "") === (known?.username ?? "")
            : true;
          if (existing && (existingStatus === "connected" || existingStatus === "connecting" || (existingStatus !== "disposed" && credentialsMatch))) {
            if (existingStatus !== "connected" && existingStatus !== "connecting") {
              const retryGeneration = generations.get(existing.id);
              await existing.client.connect();
              if (generations.get(existing.id) !== retryGeneration ||
                  !get().connections.some((entry) => entry.id === existing.id && entry.client === existing.client)) {
                throw new Error("Connection was superseded");
              }
              existing.client.setReconnectEnabled(true);
            }
            set((state) => ({
              savedConnections: state.savedConnections.map((entry) => entry.id === existing.id ? { ...profile, id: existing.id } : entry),
              lastConnectedOk: true,
            }));
            return existing.id;
          }
          const generation = nextGeneration(profile.id);
          let candidate: WriterBackend | null = null;
          try {
            if (profile.mode === "demo") {
              const demo = createDemoBackend();
              await demo.connect();
              candidate = demo;
            } else if (profile.mode === "openclaw") {
              candidate = await connectOpenClawGateway({ url: profile.endpoint, token: profile.token ?? "" });
            } else if (profile.mode === "opencode") {
              candidate = await connectOpenCodeServer({
                url: profile.endpoint,
                username: profile.username,
                password: profile.password ?? "",
              });
            } else if (profile.mode === "relay") {
              candidate = await connectViaRelay(profile.endpoint);
            } else {
              candidate = await connectWithTimeout(profile.endpoint, profile.password ?? "");
            }
            const client = candidate;
            await serializeActivation(async () => {
              if (generations.get(profile.id) !== generation) throw new Error("Connection was superseded");
              const replaced = get().connections.find((entry) => entry.id === profile.id);
              if (replaced) subscriptions.get(profile.id)?.();
              const connection: BackendConnection = {
                id: profile.id,
                label: profile.label,
                mode: profile.mode,
                endpoint: profile.endpoint,
                contextKey,
                client,
                connectionState: client.getConnectionState(),
                serverVersion: client.getLastServerInfoMessage()?.version ?? null,
              };
              set((state) => ({
                connections: [...state.connections.filter((entry) => entry.id !== profile.id), connection],
                savedConnections: [...state.savedConnections.filter((entry) => entry.id !== profile.id), profile],
                lastConnectedOk: true,
              }));
              const unsubscribe = client.subscribeConnectionStatus((connectionState) => {
                if (retiringClients.has(client)) return;
                set((state) => {
                  if (!state.connections.some((entry) => entry.id === profile.id && entry.client === client)) return state;
                  const serverVersion = client.getLastServerInfoMessage()?.version ?? null;
                  return {
                    connections: state.connections.map((entry) => entry.id === profile.id ? { ...entry, connectionState, serverVersion } : entry),
                    ...(state.activeConnectionId === profile.id && state.client === client ? { connectionState, serverVersion } : {}),
                  };
                });
              });
              const pendingPermissions = new Set<string>();
              const allowInactivePermission = (agentId: string, request: BackendPermissionRequest) => {
                if (!request.id || retiringClients.has(client)) return;
                const state = get();
                if (!state.connections.some((entry) => entry.id === profile.id && entry.client === client)) return;
                if (state.client === client && !state.isSwitchingConnection) return;
                const key = JSON.stringify([agentId, request.id]);
                if (pendingPermissions.has(key)) return;
                pendingPermissions.add(key);
                const action = request.actions?.find((entry) => entry.behavior === "allow");
                void client.respondToPermission(agentId, request.id, {
                  behavior: "allow",
                  ...(action ? { selectedActionId: action.id } : {}),
                }).catch(() => {}).finally(() => { pendingPermissions.delete(key); });
              };
              const unsubscribePermission = client.onPermissionRequest((message) => allowInactivePermission(message.agentId, message.request));
              // Some Paseo providers deliver permissions only on the stream.
              const unsubscribePermissionStream = client.onAgentStream((message) => {
                if (message.event.type === "permission_requested") allowInactivePermission(message.agentId, message.event.request);
              });
              subscriptions.set(profile.id, () => {
                unsubscribe();
                unsubscribePermission();
                unsubscribePermissionStream();
                pendingPermissions.clear();
              });
              if (replaced && replaced.client !== client) void replaced.client.close().catch(() => {});
            });
            return profile.id;
          } catch (error) {
            await candidate?.close().catch(() => {});
            throw error;
          }
        };

        return {
          connections: [],
          savedConnections: [],
          activeConnectionId: null,
          isSwitchingConnection: false,
          mode: DEFAULT_CONNECTION_MODE,
          daemonUrl: DEFAULT_DIRECT_DAEMON_URL,
          password: "",
          pairingLink: "",
          gatewayUrl: defaultGatewayUrl(),
          gatewayToken: "",
          opencodeUrl: defaultOpenCodeUrl(),
          opencodeUsername: "opencode",
          opencodePassword: "",
          opencodePairLink: "",
          alias: "",
          activeMode: null,
          activeEndpoint: null,
          client: null,
          connectionState: { status: "idle" },
          serverVersion: null,
          lastConnectedOk: false,
          demoEnabled: true,
          hasHydrated: false,

          setMode: (mode) => set((state) => ({ mode, lastConnectedOk: state.savedConnections.some((entry) => entry.autoConnect) })),
          setDaemonUrl: (url: string) => set((state) => ({ daemonUrl: url, lastConnectedOk: state.savedConnections.some((entry) => entry.autoConnect) })),
          setPassword: (password: string) => set((state) => ({ password, lastConnectedOk: state.savedConnections.some((entry) => entry.autoConnect) })),
          setPairingLink: (link: string) => set((state) => ({ pairingLink: link, lastConnectedOk: state.savedConnections.some((entry) => entry.autoConnect) })),
          setGatewayUrl: (gatewayUrl) => set((state) => ({ gatewayUrl, lastConnectedOk: state.savedConnections.some((entry) => entry.autoConnect) })),
          setGatewayToken: (gatewayToken) => set((state) => ({ gatewayToken, lastConnectedOk: state.savedConnections.some((entry) => entry.autoConnect) })),
          setOpenCodeUrl: (opencodeUrl) => set((state) => ({ opencodeUrl, lastConnectedOk: state.savedConnections.some((entry) => entry.autoConnect) })),
          setOpenCodeUsername: (opencodeUsername) => set((state) => ({ opencodeUsername, lastConnectedOk: state.savedConnections.some((entry) => entry.autoConnect) })),
          setOpenCodePassword: (opencodePassword) => set((state) => ({ opencodePassword, lastConnectedOk: state.savedConnections.some((entry) => entry.autoConnect) })),
          setOpenCodePairLink: (opencodePairLink) => set((state) => ({ opencodePairLink, lastConnectedOk: state.savedConnections.some((entry) => entry.autoConnect) })),
          setAlias: (alias) => set({ alias }),
          setConnectionAlias: (id, alias) =>
            set((state) => ({
              savedConnections: state.savedConnections.map((entry) =>
                entry.id === id ? { ...entry, alias: alias.trim() || undefined } : entry,
              ),
            })),
          _setHydrated: () =>
            set((state) => {
              const shouldMigrateLegacyWebDefault =
                Platform.OS === "web" &&
                state.daemonUrl === LEGACY_DIRECT_DAEMON_URL &&
                DEFAULT_DIRECT_DAEMON_URL !== LEGACY_DIRECT_DAEMON_URL;

              return {
                daemonUrl: shouldMigrateLegacyWebDefault
                  ? DEFAULT_DIRECT_DAEMON_URL
                  : state.daemonUrl,
                hasHydrated: true,
                lastConnectedOk: state.savedConnections.some((entry) => entry.autoConnect),
              };
            }),

          connect: async () => {
            const selection = ++selectionGeneration;
            if (!get().client) set({ connectionState: { status: "connecting", attempt: 0 } });
            try {
              if (get().mode === "opencode") {
                const pasted = get().opencodePairLink.trim();
                const pairLink = pasted || (get().opencodeUrl.includes("/auth/connect/") ? get().opencodeUrl.trim() : "");
                if (pairLink) {
                  const paired = await redeemOpenCodePairLink(pairLink);
                  set({
                    opencodeUrl: paired.endpoint,
                    opencodePassword: paired.password,
                    opencodePairLink: "",
                  });
                }
              }
              const profile = savedProfile(get());
              const id = await ensureConnection(profile);
              await serializeActivation(async () => {
                if (selection !== selectionGeneration) throw new Error("Connection selection was superseded by a newer selection");
                await activate(id);
              });
            } catch (error) {
              if (!get().client) set({ connectionState: { status: "idle" }, lastConnectedOk: get().savedConnections.some((entry) => entry.autoConnect) });
              throw error;
            }
          },

          activateConnection: (id) => {
            selectionGeneration++;
            return serializeActivation(() => activate(id));
          },

          disconnect: async (requestedId) => {
            const id = requestedId ?? get().activeConnectionId;
            if (!id) return;
            nextGeneration(id);
            selectionGeneration++;
            const connection = get().connections.find((entry) => entry.id === id);
            if (connection) retiringClients.add(connection.client);
            set((state) => {
              const savedConnections = state.savedConnections.map((entry) => entry.id === id ? { ...entry, autoConnect: false } : entry);
              return { savedConnections, lastConnectedOk: savedConnections.some((entry) => entry.autoConnect) };
            });
            let closing: Promise<void> = Promise.resolve();
            try {
              await serializeActivation(async () => {
                // Registry insertion/removal shares the foreground queue, so an
                // activation cannot publish a client disposed midway through it.
                if (connection && get().connections.some((entry) => entry.id === id && entry.client === connection.client)) {
                  subscriptions.get(id)?.();
                  subscriptions.delete(id);
                  set((state) => ({ connections: state.connections.filter((entry) => entry.client !== connection.client) }));
                }
                closing = connection?.client.close().catch(() => {}) ?? Promise.resolve();
                if (get().activeConnectionId !== id || (connection && get().client !== connection.client)) return;
                const remaining = get().connections;
                const fallback = remaining.find((entry) => entry.connectionState.status === "connected") ?? remaining[0];
                if (fallback) {
                  await activate(fallback.id);
                  return;
                }
                set({ isSwitchingConnection: true });
                try {
                  await resetBackendViews();
                  set(activeProjection(null));
                } finally {
                  set({ isSwitchingConnection: false });
                }
              });
            } finally {
              await closing;
              if (connection) retiringClients.delete(connection.client);
            }
          },

          connectSaved: async (id) => {
            const selection = ++selectionGeneration;
            const profile = get().savedConnections.find((entry) => entry.id === id);
            if (!profile) throw new Error("Saved backend connection was not found");
            const connectedId = await ensureConnection(profile);
            await serializeActivation(async () => {
              if (selection !== selectionGeneration) throw new Error("Connection selection was superseded by a newer selection");
              await activate(connectedId);
            });
          },

          setDemoEnabled: async (enabled) => {
            set({ demoEnabled: enabled });
            const id = connectionId(DEMO_CONTEXT_KEY);
            if (!enabled) {
              await get().disconnect(id).catch(() => {});
              set((state) => ({
                savedConnections: state.savedConnections.filter((entry) => entry.id !== id),
                connections: state.connections.filter((entry) => entry.id !== id),
              }));
              if (get().activeConnectionId === id) set(activeProjection(null));
              return;
            }
            if (!get().savedConnections.some((entry) => entry.id === id)) {
              set((state) => ({
                savedConnections: [
                  ...state.savedConnections,
                  {
                    id,
                    alias: DEMO_ALIAS,
                    label: "Demo · Welcome tour",
                    mode: "demo" as const,
                    endpoint: DEMO_ENDPOINT,
                    autoConnect: true,
                  },
                ],
              }));
            }
            await get().connectSaved(id).catch(() => {});
          },

          restoreConnections: () => {
            if (restorePromise) return restorePromise;
            restorePromise = (async () => {
              if (!get().hasHydrated) {
                await new Promise<void>((resolve) => {
                  const unsubscribe = useConnectionStore.persist.onFinishHydration(() => {
                    unsubscribe();
                    resolve();
                  });
                  if (get().hasHydrated) { unsubscribe(); resolve(); }
                });
              }
              // A fresh install starts inside a demo workspace instead of a
              // connection form, so the product can be explored immediately.
              if (get().demoEnabled && get().savedConnections.length === 0) {
                set((state) => ({
                  savedConnections: [
                    ...state.savedConnections,
                    {
                      id: connectionId(DEMO_CONTEXT_KEY),
                      alias: DEMO_ALIAS,
                      label: "Demo · Welcome tour",
                      mode: "demo" as const,
                      endpoint: DEMO_ENDPOINT,
                      autoConnect: true,
                    },
                  ],
                }));
              }
              const demoId = connectionId(DEMO_CONTEXT_KEY);
              set((state) => ({
                savedConnections: state.savedConnections.map((entry) =>
                  entry.id === demoId && !entry.alias ? { ...entry, alias: DEMO_ALIAS } : entry,
                ),
              }));
              const preferredId = get().activeConnectionId;
              const selection = selectionGeneration;
              const profiles = get().savedConnections.filter((entry) => entry.autoConnect);
              // Each backend succeeds or fails independently; no connect attempt
              // mutates foreground context until restoration chooses its default.
              await Promise.allSettled(profiles.map(async (profile) => {
                const id = await ensureConnection(profile);
                if (id === preferredId && selectionGeneration === selection) {
                  await serializeActivation(async () => {
                    if (selectionGeneration === selection) await activate(id);
                  });
                }
              }));
              if (selectionGeneration !== selection) return;
              await serializeActivation(async () => {
                if (selectionGeneration !== selection) return;
                const connections = get().connections;
                const preferred = connections.find((entry) => entry.id === preferredId);
                const fallback = profiles.map((profile) => connections.find((entry) => entry.id === profile.id)).find((entry) => entry !== undefined);
                const selected = preferred ?? fallback ?? connections[0];
                if (selected) await activate(selected.id);
                else set({ ...activeProjection(null), lastConnectedOk: profiles.length > 0 });
              });
            })().finally(() => { restorePromise = null; });
            return restorePromise;
          },
        };
      },
      {
        name: "kel-writer-connection",
        storage: persistStorage,
        version: 1,
        migrate: (persisted) => {
          const legacy = persisted as Partial<ConnectionStore>;
          const daemonUrl = Platform.OS === "web" && legacy.daemonUrl === LEGACY_DIRECT_DAEMON_URL
            ? DEFAULT_DIRECT_DAEMON_URL : legacy.daemonUrl ?? DEFAULT_DIRECT_DAEMON_URL;
          let savedConnections = legacy.savedConnections ?? [];
          let activeConnectionId = legacy.activeConnectionId ?? null;
          if (!legacy.savedConnections && legacy.lastConnectedOk) {
            try {
              const profile = savedProfile({
                mode: legacy.mode ?? DEFAULT_CONNECTION_MODE,
                daemonUrl,
                password: legacy.password ?? "",
                pairingLink: legacy.pairingLink ?? "",
                gatewayUrl: legacy.gatewayUrl ?? defaultGatewayUrl(),
                gatewayToken: legacy.gatewayToken ?? "",
                opencodeUrl: legacy.opencodeUrl ?? defaultOpenCodeUrl(),
                opencodeUsername: legacy.opencodeUsername ?? "opencode",
                opencodePassword: legacy.opencodePassword ?? "",
                alias: legacy.alias ?? "",
              });
              savedConnections = [profile];
              activeConnectionId = profile.id;
            } catch { /* An invalid legacy endpoint stays available in the draft form. */ }
          }
          return { ...legacy, daemonUrl, savedConnections, activeConnectionId };
        },
        // Persist draft inputs, saved profiles and the selected profile identity.
        // The live client and transient connection state must never be
        // serialized.
        partialize: (state) => ({
          mode: state.mode,
          alias: state.alias,
          daemonUrl: state.daemonUrl,
          password: state.password,
          pairingLink: state.pairingLink,
          gatewayUrl: state.gatewayUrl,
          gatewayToken: state.gatewayToken,
          opencodeUrl: state.opencodeUrl,
          opencodeUsername: state.opencodeUsername,
          opencodePassword: state.opencodePassword,
          lastConnectedOk: state.lastConnectedOk,
          demoEnabled: state.demoEnabled,
          savedConnections: state.savedConnections,
          activeConnectionId: state.activeConnectionId,
        }),
        onRehydrateStorage: () => (state) => {
          state?._setHydrated();
        },
      },
    ),
  ),
);
