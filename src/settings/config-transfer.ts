import { useConnectionStore } from "../stores/connection-store";
import { usePreferencesStore, type BackendPreferences } from "../stores/preferences-store";

export const CONFIG_FORMAT = "puff-config";
export const CONFIG_VERSION = 1;

type ExportConnection = {
  mode: unknown;
  alias: unknown;
  daemonUrl: unknown;
  password: unknown;
  pairingLink: unknown;
  gatewayUrl: unknown;
  gatewayToken: unknown;
  opencodeUrl: unknown;
  opencodeUsername: unknown;
  opencodePassword: unknown;
  lastConnectedOk: unknown;
  demoEnabled: unknown;
  savedConnections: unknown;
  activeConnectionId: unknown;
};

type ExportPreferences = {
  agentPrompt: unknown;
  commentPrompt: unknown;
  sidebarTab: unknown;
  collapsedProjectSources: unknown;
  activeBackendKey: unknown;
  preferencesByBackend: unknown;
};

export type PuffConfigExport = {
  format: typeof CONFIG_FORMAT;
  version: typeof CONFIG_VERSION;
  exportedAt: string;
  connection: ExportConnection;
  preferences: ExportPreferences;
};

function backendPreferencesFromState(state: ReturnType<typeof usePreferencesStore.getState>): BackendPreferences {
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

function emptyBackendPreferences(): BackendPreferences {
  return {
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
    webPreviewRootCache: {},
  };
}

export function exportConfig(): string {
  const c = useConnectionStore.getState();
  const p = usePreferencesStore.getState();

  // Normalize: include the active backend's flattened prefs inside preferencesByBackend.
  const preferencesByBackend: Record<string, BackendPreferences> = { ...p.preferencesByBackend };
  if (p.activeBackendKey) {
    preferencesByBackend[p.activeBackendKey] = backendPreferencesFromState(p);
  }

  const payload: PuffConfigExport = {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    connection: {
      mode: c.mode,
      alias: c.alias,
      daemonUrl: c.daemonUrl,
      password: c.password,
      pairingLink: c.pairingLink,
      gatewayUrl: c.gatewayUrl,
      gatewayToken: c.gatewayToken,
      opencodeUrl: c.opencodeUrl,
      opencodeUsername: c.opencodeUsername,
      opencodePassword: c.opencodePassword,
      lastConnectedOk: c.lastConnectedOk,
      demoEnabled: c.demoEnabled,
      savedConnections: c.savedConnections,
      activeConnectionId: c.activeConnectionId,
    },
    preferences: {
      agentPrompt: p.agentPrompt,
      commentPrompt: p.commentPrompt,
      sidebarTab: p.sidebarTab,
      collapsedProjectSources: p.collapsedProjectSources,
      activeBackendKey: p.activeBackendKey,
      preferencesByBackend,
    },
  };

  return JSON.stringify(payload, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : value === null ? null : null;
}

function sanitizeSavedConnections(value: unknown): any[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({
    id: asString(entry.id),
    ...(typeof entry.alias === "string" && entry.alias ? { alias: entry.alias } : {}),
    label: asString(entry.label),
    mode: entry.mode,
    endpoint: asString(entry.endpoint),
    ...(typeof entry.password === "string" ? { password: entry.password } : {}),
    ...(typeof entry.token === "string" ? { token: entry.token } : {}),
    ...(typeof entry.username === "string" ? { username: entry.username } : {}),
    autoConnect: asBoolean(entry.autoConnect, true),
  })).filter((entry) => entry.id && entry.label && entry.endpoint && typeof entry.mode === "string");
}

function sanitizeBackendPreferences(value: unknown): BackendPreferences {
  if (!isRecord(value)) return emptyBackendPreferences();
  return {
    lastProvider: typeof value.lastProvider === "string" ? value.lastProvider : null,
    lastModel: typeof value.lastModel === "string" ? value.lastModel : null,
    lastCwd: asString(value.lastCwd, "/tmp/puff"),
    lastWorkspaceId: typeof value.lastWorkspaceId === "string" ? value.lastWorkspaceId : null,
    lastDocumentByCwd: isRecord(value.lastDocumentByCwd) ? (value.lastDocumentByCwd as Record<string, string>) : {},
    scrollByDocument: isRecord(value.scrollByDocument) ? (value.scrollByDocument as Record<string, number>) : {},
    agentIdByWorkspaceKey: isRecord(value.agentIdByWorkspaceKey) ? (value.agentIdByWorkspaceKey as Record<string, string>) : {},
    queuedMessagesByAgent: isRecord(value.queuedMessagesByAgent) ? (value.queuedMessagesByAgent as any) : {},
    recentWorkspaces: Array.isArray(value.recentWorkspaces) ? (value.recentWorkspaces as any) : [],
    recentSessions: Array.isArray(value.recentSessions) ? (value.recentSessions as any) : [],
    webPreviewRootCache: isRecord(value.webPreviewRootCache) ? (value.webPreviewRootCache as Record<string, string>) : {},
  };
}

export function importConfig(json: string): { ok: true } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "不是有效的 JSON。" };
  }
  if (!isRecord(parsed)) return { ok: false, error: "配置格式无效。" };
  if (parsed.format !== CONFIG_FORMAT) return { ok: false, error: "不是 Puff 配置文件（format 不匹配）。" };
  if (parsed.version !== CONFIG_VERSION) return { ok: false, error: `不支持的配置版本：${String(parsed.version)}。` };

  const connection = isRecord(parsed.connection) ? parsed.connection : null;
  const preferences = isRecord(parsed.preferences) ? parsed.preferences : null;
  if (!connection || !preferences) return { ok: false, error: "配置缺少 connection 或 preferences。" };

  // Apply preferences
  const rawPrefsByBackend = isRecord(preferences.preferencesByBackend) ? preferences.preferencesByBackend : {};
  const normalizedPrefsByBackend: Record<string, BackendPreferences> = {};
  for (const [key, value] of Object.entries(rawPrefsByBackend)) {
    normalizedPrefsByBackend[key] = sanitizeBackendPreferences(value);
  }
  const activeBackendKey = typeof preferences.activeBackendKey === "string" ? preferences.activeBackendKey : null;
  const activePrefs = activeBackendKey ? (normalizedPrefsByBackend[activeBackendKey] ?? emptyBackendPreferences()) : null;

  usePreferencesStore.setState((state) => {
    const base = {
      agentPrompt: typeof preferences.agentPrompt === "string" ? preferences.agentPrompt : state.agentPrompt,
      commentPrompt: typeof preferences.commentPrompt === "string" ? preferences.commentPrompt : state.commentPrompt,
      sidebarTab: preferences.sidebarTab === "projects" || preferences.sidebarTab === "files" ? preferences.sidebarTab : state.sidebarTab,
      collapsedProjectSources: isRecord(preferences.collapsedProjectSources) ? (preferences.collapsedProjectSources as Record<string, boolean>) : state.collapsedProjectSources,
      activeBackendKey,
      preferencesByBackend: { ...normalizedPrefsByBackend },
    } as any;

    if (activeBackendKey && activePrefs) {
      // Keep active backend flattened in top-level fields, others in map (excluding active from map is fine; store will manage)
      const rest = { ...normalizedPrefsByBackend };
      // store keeps non-active in preferencesByBackend; active is represented by top-level
      delete rest[activeBackendKey];
      return {
        ...base,
        preferencesByBackend: rest,
        lastProvider: activePrefs.lastProvider,
        lastModel: activePrefs.lastModel,
        lastCwd: activePrefs.lastCwd,
        lastWorkspaceId: activePrefs.lastWorkspaceId,
        lastDocumentByCwd: activePrefs.lastDocumentByCwd,
        scrollByDocument: activePrefs.scrollByDocument,
        agentIdByWorkspaceKey: activePrefs.agentIdByWorkspaceKey,
        queuedMessagesByAgent: activePrefs.queuedMessagesByAgent,
        recentWorkspaces: activePrefs.recentWorkspaces,
        recentSessions: activePrefs.recentSessions,
        webPreviewRootCache: activePrefs.webPreviewRootCache,
      };
    }

    return base;
  });

  // Apply connection (persisted fields only; live clients/state remain untouched/reset by app lifecycle)
  const savedConnections = sanitizeSavedConnections(connection.savedConnections);
  useConnectionStore.setState((state) => ({
    mode: typeof connection.mode === "string" ? (connection.mode as any) : state.mode,
    alias: asString(connection.alias, state.alias),
    daemonUrl: asString(connection.daemonUrl, state.daemonUrl),
    password: asString(connection.password, state.password),
    pairingLink: asString(connection.pairingLink, state.pairingLink),
    gatewayUrl: asString(connection.gatewayUrl, state.gatewayUrl),
    gatewayToken: asString(connection.gatewayToken, state.gatewayToken),
    opencodeUrl: asString(connection.opencodeUrl, state.opencodeUrl),
    opencodeUsername: asString(connection.opencodeUsername, state.opencodeUsername),
    opencodePassword: asString(connection.opencodePassword, state.opencodePassword),
    lastConnectedOk: asBoolean(connection.lastConnectedOk, state.lastConnectedOk),
    demoEnabled: asBoolean(connection.demoEnabled, state.demoEnabled),
    savedConnections,
    activeConnectionId: typeof connection.activeConnectionId === "string" ? connection.activeConnectionId : null,
  }));

  return { ok: true };
}
