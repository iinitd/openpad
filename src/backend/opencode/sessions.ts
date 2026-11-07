import type {
  AgentModelDefinition,
  BackendAgent,
  BackendAgentStatus,
  BackendAgentsResult,
  BackendProvidersSnapshot,
  BackendWorkspaceEntry,
  BackendWorkspacesResult,
  CreateAgentOptions,
  FetchAgentsOptions,
} from "../types";
import { basename, sessionTimestamp } from "./map";
import type { OpenCodeTransport } from "./transport";
import { asBoolean, asNumber, asRecord, asString, OpenCodeRequestError } from "./wire";

interface PageCursor {
  next?: string | null;
}

const MAX_SESSION_PAGE = 200;

function clampLimit(value: number | undefined, fallback: number): number {
  const limit = value ?? fallback;
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(MAX_SESSION_PAGE, Math.floor(limit)));
}

function locationQuery(cwd: string | undefined): string {
  if (!cwd) return "";
  // Sent unencoded on purpose. The native fetch layer percent-encodes the URL
  // once on the way out, so pre-encoding here reached the server as a literal
  // "%2FUsers%2F..." path and every request failed with LocationNotFoundError.
  return `location[directory]=${cwd}`;
}

/**
 * `/api/project` accumulates records for paths that earlier clients sent already
 * URL-encoded, so the server stored paths such as
 * `/Users/name/%2FUsers%2Fname%2Fproject`. They never resolve; `/api/fs` answers
 * them with LocationNotFoundError, and listing one as a workspace gives the user
 * a project whose file tree cannot load. Drop them before any check: the
 * reachability probe can also time out instead of returning 404, which would let
 * these records through.
 */
function looksDoubleEncoded(directory: string): boolean {
  return /%(?:2f|25)/i.test(directory);
}

function query(params: Array<string | null | undefined>): string {
  const parts = params.filter((entry): entry is string => Boolean(entry));
  return parts.length ? `?${parts.join("&")}` : "";
}

export function providerAgentId(provider: string): string {
  const trimmed = provider.trim();
  if (!trimmed) throw new Error("Select an OpenCode agent before creating a conversation.");
  const id = trimmed.startsWith("opencode:") ? trimmed.slice("opencode:".length) : trimmed;
  if (!id) throw new Error("Select an OpenCode agent before creating a conversation.");
  return id;
}

export function agentProvider(agentId: string | undefined): string {
  return `opencode:${agentId || "build"}`;
}

export function parseModelRef(model: string | null | undefined): { providerID: string; id: string } | null {
  if (!model) return null;
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) {
    throw new Error("OpenCode models use the providerID/modelID form.");
  }
  return { providerID: model.slice(0, slash), id: model.slice(slash + 1) };
}

export function modelRefString(model: unknown): string | null {
  const record = asRecord(model);
  const id = asString(record.id);
  const providerID = asString(record.providerID);
  if (!id || !providerID) return null;
  return `${providerID}/${id}`;
}

/** Session and provider metadata for the OpenCode v2 API. */
export class OpenCodeSessions {
  private readonly agents = new Map<string, BackendAgent>();

  constructor(private readonly transport: OpenCodeTransport) {}

  getAgent(id: string): BackendAgent | null {
    return this.agents.get(id) ?? null;
  }

  updateStatus(id: string, status: BackendAgentStatus): BackendAgent | null {
    const agent = this.agents.get(id);
    if (!agent || agent.status === status) return agent ?? null;
    const next = { ...agent, status };
    this.agents.set(id, next);
    return next;
  }

  upsertAgent(raw: unknown, active = false): BackendAgent | null {
    const info = asRecord(raw);
    const id = asString(info.id);
    if (!id) return null;
    const timestamps = sessionTimestamp(info);
    const previous = this.agents.get(id);
    const archived = asNumber(asRecord(info.time).archived);
    const next: BackendAgent = {
      id,
      provider: agentProvider(asString(info.agent)),
      cwd: asString(asRecord(info.location).directory) ?? previous?.cwd ?? "",
      workspaceId: asString(info.projectID) ?? previous?.workspaceId,
      model: modelRefString(info.model) ?? previous?.model ?? null,
      status: this.statusFromSession(info, active),
      title: asString(info.title) ?? previous?.title ?? null,
      createdAt: timestamps.created,
      updatedAt: timestamps.updated,
      archivedAt: archived ? new Date(archived).toISOString() : null,
    };
    this.agents.set(id, next);
    return next;
  }

  async fetchWorkspaces(): Promise<BackendWorkspacesResult> {
    const response = await this.transport.requestJson<unknown>("/api/project");
    const rows = Array.isArray(response) ? response : asRecord(response).data;
    const candidates: Array<{ directory: string; id: string }> = [];
    const seen = new Set<string>();
    if (Array.isArray(rows)) {
      for (const rowValue of rows) {
        const row = asRecord(rowValue);
        const directory = asString(row.canonical) ?? asString(row.directory);
        const id = asString(row.id);
        if (!directory || !id || seen.has(directory)) continue;
        if (looksDoubleEncoded(directory)) continue;
        seen.add(directory);
        candidates.push({ directory, id });
      }
    }
    // A session can point at a location the project list has not surfaced yet.
    for (const agent of this.agents.values()) {
      if (!agent.cwd || seen.has(agent.cwd) || looksDoubleEncoded(agent.cwd)) continue;
      seen.add(agent.cwd);
      candidates.push({ directory: agent.cwd, id: agent.workspaceId ?? `opencode:${agent.cwd}` });
    }
    // `/api/project` keeps stale records for locations that no longer resolve:
    // URL-encoded paths left by earlier clients, directories that were removed,
    // and paths that were only ever requested once. `/api/fs` rejects them with
    // LocationNotFoundError, and opening one as a project breaks the file tree
    // with "location not found". Re-encoding such a path as `location[directory]`
    // also makes the server record an even more deeply encoded one, so never
    // surface a location without verifying it first.
    const reachable = await Promise.all(candidates.map(async ({ directory }) => {
      try {
        await this.transport.requestJson(`/api/fs/list?${locationQuery(directory)}`);
        return true;
      } catch (error) {
        return !(error instanceof OpenCodeRequestError && error.status === 404);
      }
    }));
    const entries: BackendWorkspaceEntry[] = [];
    candidates.forEach(({ directory, id }, index) => {
      if (!reachable[index]) return;
      const name = basename(directory) || directory;
      entries.push({
        id,
        title: name,
        name,
        workspaceDirectory: directory,
        projectRootPath: directory,
        projectDisplayName: name,
      });
    });
    return { entries, pageInfo: { hasMore: false, nextCursor: null } };
  }

  async fetchAgents(options?: FetchAgentsOptions): Promise<BackendAgentsResult> {
    const limit = clampLimit(options?.page?.limit, 100);
    const params = query([
      `limit=${limit}`,
      options?.page?.cursor ? null : "order=desc",
      options?.filter?.includeArchived ? null : "archived=false",
      options?.page?.cursor ? `cursor=${encodeURIComponent(options.page.cursor)}` : null,
    ]);
    const [response, active] = await Promise.all([
      this.transport.requestJson<Record<string, unknown>>(`/api/session${params}`),
      this.activeSessions(),
    ]);
    const rows = Array.isArray(response.data) ? response.data : [];
    const entries = rows.flatMap((row) => {
      const agent = this.upsertAgent(row, active.has(asString(asRecord(row).id) ?? ""));
      return agent ? [{ agent }] : [];
    });
    const cursor = asRecord(response.cursor);
    const nextCursor = asString(cursor.next) ?? null;
    return { entries, pageInfo: { hasMore: Boolean(nextCursor), nextCursor } };
  }

  private async activeSessions(): Promise<Set<string>> {
    try {
      const response = await this.transport.requestJson<Record<string, unknown>>("/api/session/active");
      return new Set(Object.keys(asRecord(response.data)));
    } catch {
      // Activity is additive; an older server without the route still lists sessions.
      return new Set();
    }
  }

  async fetchAgent(id: string): Promise<{ agent: BackendAgent } | null> {
    if (!id) return null;
    let response: Record<string, unknown>;
    try {
      response = await this.transport.requestJson<Record<string, unknown>>(`/api/session/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof OpenCodeRequestError && error.status === 404) return null;
      throw error;
    }
    const info = asRecord(response.data);
    const active = await this.activeSessions();
    const agent = this.upsertAgent(info, active.has(id));
    if (!agent) throw new OpenCodeRequestError("PROTOCOL_ERROR", "OpenCode returned a session without an id.");
    return { agent };
  }

  async ensureAgent(id: string): Promise<BackendAgent> {
    const cached = this.agents.get(id);
    if (cached) return cached;
    const fetched = await this.fetchAgent(id);
    if (!fetched) throw new OpenCodeRequestError("HTTP_ERROR", `OpenCode session ${id} no longer exists.`, 404);
    return fetched.agent;
  }

  async createAgent(options: CreateAgentOptions): Promise<BackendAgent> {
    if (!options.cwd) throw new Error("OpenCode conversations require a working directory.");
    const agentId = providerAgentId(options.provider);
    const model = parseModelRef(options.model);
    const response = await this.transport.requestJson<Record<string, unknown>>("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: agentId,
        ...(model ? { model } : {}),
        location: { directory: options.cwd },
      }),
    });
    const agent = this.upsertAgent(response.data);
    if (!agent) throw new OpenCodeRequestError("PROTOCOL_ERROR", "OpenCode did not return the created session.");
    return agent;
  }

  async archiveAgent(id: string): Promise<void> {
    await this.transport.requestJson(`/api/session/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    const agent = this.agents.get(id);
    if (agent) this.agents.set(id, { ...agent, archivedAt: new Date().toISOString() });
  }

  async setAgentModel(id: string, model: string | null): Promise<void> {
    const ref = parseModelRef(model);
    if (!ref) throw new Error("Select an OpenCode model first.");
    await this.transport.requestJson(`/api/session/${encodeURIComponent(id)}/model`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: ref }),
    });
    const agent = this.agents.get(id);
    if (agent) this.agents.set(id, { ...agent, model });
  }

  async fetchMessages(id: string, requested: number): Promise<unknown[]> {
    const limit = Math.max(1, Math.min(1000, Math.floor(requested)));
    const rows: unknown[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    while (rows.length < limit) {
      const pageLimit = Math.min(MAX_SESSION_PAGE, limit - rows.length);
      const params = query([
        `limit=${pageLimit}`,
        cursor ? `cursor=${encodeURIComponent(cursor)}` : "order=desc",
      ]);
      const response = await this.transport.requestJson<Record<string, unknown>>(
        `/api/session/${encodeURIComponent(id)}/message${params}`,
      );
      const page = Array.isArray(response.data) ? response.data : [];
      for (const row of page) {
        const rowId = asString(asRecord(row).id);
        if (rowId && seen.has(rowId)) continue;
        if (rowId) seen.add(rowId);
        rows.push(row);
      }
      cursor = asString(asRecord(response.cursor).next) ?? null;
      if (!cursor || page.length === 0) break;
    }
    rows.reverse();
    return rows;
  }

  async snapshotProviders(cwd?: string): Promise<BackendProvidersSnapshot> {
    const location = locationQuery(cwd);
    const [agentsResponse, modelsResponse] = await Promise.all([
      this.transport.requestJson<Record<string, unknown>>(`/api/agent${location ? `?${location}` : ""}`),
      this.transport.requestJson<Record<string, unknown>>(`/api/model${query([location, "types=chat"])}`),
    ]);
    const agents = Array.isArray(agentsResponse.data) ? agentsResponse.data : [];
    const models = Array.isArray(modelsResponse.data) ? modelsResponse.data : [];
    const availableModels: AgentModelDefinition[] = [];
    const seen = new Set<string>();
    for (const value of models) {
      const row = asRecord(value);
      const modelId = asString(row.modelID) ?? asString(row.id);
      const providerID = asString(row.providerID);
      if (!modelId || !providerID) continue;
      const id = `${providerID}/${modelId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      availableModels.push({
        id,
        label: asString(row.name) ?? modelId,
        provider: "",
        description: asString(row.description),
      });
    }
    const entries = agents.flatMap((value) => {
      const row = asRecord(value);
      const id = asString(row.id);
      if (!id) return [];
      if (asBoolean(row.hidden)) return [];
      if (asString(row.mode) === "subagent") return [];
      const provider = agentProvider(id);
      return [{
        provider,
        label: asString(row.name) ?? id,
        status: availableModels.length > 0 ? "ready" as const : "unavailable" as const,
        enabled: availableModels.length > 0,
        ...(availableModels.length === 0 ? { error: "No OpenCode chat models are available for this server." } : {}),
        models: availableModels.map((model) => ({
          ...model,
          provider,
          isDefault: model.id === availableModels[0]?.id,
        })),
      }];
    });
    return { entries };
  }

  statusFromSession(info: Record<string, unknown>, active: boolean): BackendAgentStatus {
    if (active) return "running";
    const time = asRecord(info.time);
    const busy = asNumber(time.busy);
    const idle = asNumber(time.idle);
    if (busy !== undefined && (idle === undefined || busy > idle)) return "running";
    return "idle";
  }
}
