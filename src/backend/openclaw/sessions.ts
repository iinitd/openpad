import type { BackendAgent, BackendAgentStatus, BackendAgentsResult, BackendWorkspacesResult, CreateAgentOptions, FetchAgentsOptions } from "../types";
import { defaultOpenClawStorage, type OpenClawStorage } from "./device-identity";
import { OpenClawModels, profileId, profileProvider, qualifiedModel } from "./models";
import type { OpenClawTransport } from "./transport";
import { asNumber, asRecord, asString, isRecord, OpenClawRpcError } from "./wire";

export interface OpenClawFileScope { agentId: string; sessionKey?: string; root: string }
export interface OpenClawSessionScope extends OpenClawFileScope { sessionKey: string; sessionId?: string; lifecycleRevision?: string }

export function uniqueId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function isoTime(value: unknown, fallback = 0): string {
  const numeric = asNumber(value);
  const date = new Date(numeric ?? (typeof value === "string" ? value : fallback));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(fallback).toISOString();
}

function pathKey(path: string): string { return path.replace(/\\/g, "/").replace(/\/+$/, "") || "/"; }
function contains(root: string, path: string): boolean {
  return pathKey(path) === pathKey(root) || pathKey(path).startsWith(`${pathKey(root).replace(/\/$/, "")}/`);
}
function rowStatus(row: Record<string, unknown>): BackendAgentStatus {
  if (row.archived === true) return "closed";
  if (row.hasActiveRun === true || row.status === "running" || row.status === "queued") return "running";
  if (["failed", "timeout"].includes(String(row.status))) return "error";
  return "idle";
}

/** Shared authoritative bindings for sessions, the workspace picker and file reads. */
export class OpenClawSessionRegistry {
  private activeAgentId: string | null = null;
  private readonly rows = new Map<string, Record<string, unknown>>();
  private readonly agents = new Map<string, BackendAgent>();
  private readonly archived = new Map<string, string>();
  private archiveLoad: Promise<void> | null = null;
  private readonly archiveKey: string;
  constructor(private readonly transport: OpenClawTransport, readonly models: OpenClawModels,
    private readonly storage: OpenClawStorage = defaultOpenClawStorage) {
    this.archiveKey = `puff:openclaw:archived:v1:${encodeURIComponent(transport.url)}`;
  }

  private loadArchives(): Promise<void> {
    return this.archiveLoad ??= (async () => {
      const raw = await this.storage.getItem(this.archiveKey);
      if (!raw) return;
      try { const parsed: unknown = JSON.parse(raw); if (isRecord(parsed)) for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") this.archived.set(key, value); }
      catch { /* An invalid local archive preference does not hide gateway sessions. */ }
    })();
  }

  setActiveAgent(key: string | null): void { this.activeAgentId = key; }
  getAgent(key: string): BackendAgent | undefined { return this.agents.get(key); }
  getScope(key: string): OpenClawSessionScope {
    const row = this.rows.get(key);
    const agent = this.agents.get(key);
    if (!row || !agent) throw new Error(`OpenClaw session ${key} has not been resolved.`);
    const owner = asString(row.agentId) ?? /^agent:([^:]+):/.exec(key)?.[1];
    if (!owner) throw new Error(`OpenClaw did not identify the configured agent for session ${key}.`);
    return { agentId: owner, sessionKey: key, sessionId: asString(row.sessionId), lifecycleRevision: asString(row.lifecycleRevision), root: agent.cwd };
  }

  upsert(row: Record<string, unknown>, key = asString(row.key)): BackendAgent | null {
    if (!key) return null;
    const previous = this.rows.get(key);
    const merged: Record<string, unknown> = { ...previous, ...row, key };
    this.rows.set(key, merged);
    const owner = asString(merged.agentId) ?? /^agent:([^:]+):/.exec(key)?.[1];
    if (!owner) return null;
    const profile = this.models.getProfiles().find((entry) => entry.id === owner);
    const cwd = asString(merged.workspaceDir) ?? asString(merged.spawnedCwd) ?? asString(merged.execCwd) ?? asString(merged.spawnedWorkspaceDir) ?? profile?.workspace ?? "";
    const archivedAt = this.archived.get(key) ?? (merged.archived ? isoTime(merged.archivedAt, Date.now()) : null);
    const agent: BackendAgent = { id: key, provider: profileProvider(owner), cwd,
      workspaceId: cwd ? this.workspaceId(cwd) : undefined,
      model: qualifiedModel(merged.model, merged.modelProvider) ?? profile?.model ?? null,
      title: asString(merged.displayName) ?? asString(merged.label) ?? asString(merged.derivedTitle) ?? null,
      status: archivedAt ? "closed" : rowStatus(merged),
      createdAt: isoTime(merged.createdAt ?? merged.updatedAt), updatedAt: isoTime(merged.updatedAt ?? merged.createdAt), archivedAt };
    this.agents.set(key, agent);
    return agent;
  }

  updateStatus(key: string, status: BackendAgentStatus): BackendAgent | null {
    const agent = this.agents.get(key);
    if (!agent) return null;
    const updated = { ...agent, status, updatedAt: new Date().toISOString() };
    this.agents.set(key, updated);
    return updated;
  }

  private workspaceId(root: string): string {
    return `openclaw:${encodeURIComponent(this.transport.url)}:workspace:${encodeURIComponent(pathKey(root))}`;
  }

  async listRows(includeArchived = false, search?: string): Promise<Record<string, unknown>[]> {
    await this.loadArchives();
    if (!this.models.getProfiles().length) await this.models.fetchProfiles();
    const rows: Record<string, unknown>[] = [];
    let offset = 0;
    for (;;) {
      const result = asRecord(await this.transport.request("sessions.list", {
        limit: 200, offset, includeDerivedTitles: true,
        ...(includeArchived ? { archived: "all" } : {}), ...(search ? { search } : {}),
      }));
      if (!Array.isArray(result.sessions)) throw new OpenClawRpcError("PROTOCOL_ERROR", "sessions.list did not return a session list.");
      const page = result.sessions.filter(isRecord);
      const facts = Array.isArray(result.sharedFacts) ? result.sharedFacts : [];
      for (const row of page) {
        const expanded: Record<string, unknown> = {};
        if (Array.isArray(row.sharedFacts)) for (const index of row.sharedFacts) if (typeof index === "number" && isRecord(facts[index])) Object.assign(expanded, facts[index]);
        const full = { ...expanded, ...row };
        rows.push(full); this.upsert(full);
      }
      const next = asNumber(result.nextOffset);
      const hasMore = result.hasMore === true || (next !== undefined && next !== null) || (asNumber(result.totalCount) ?? 0) > offset + page.length;
      if (!hasMore) break;
      const nextOffset = next ?? offset + page.length;
      if (!page.length || nextOffset <= offset) throw new OpenClawRpcError("PROTOCOL_ERROR", "OpenClaw session pagination did not advance.");
      offset = nextOffset;
    }
    return rows;
  }

  async fetchAgents(options?: FetchAgentsOptions): Promise<BackendAgentsResult> {
    const rows = await this.listRows(options?.filter?.includeArchived === true);
    const direction = options?.sort?.[0]?.direction === "asc" ? 1 : -1;
    const entries = rows.flatMap((row) => { const agent = this.getAgent(String(row.key)); return agent && (options?.filter?.includeArchived || !agent.archivedAt) ? [{ agent }] : []; });
    entries.sort((a, b) => direction * (a.agent.updatedAt.localeCompare(b.agent.updatedAt) || a.agent.id.localeCompare(b.agent.id)));
    const cursor = options?.page?.cursor;
    if (cursor && !/^\d+$/.test(cursor)) throw new Error("Invalid OpenClaw session page cursor.");
    const offset = cursor ? Number(cursor) : 0;
    const limit = options?.page?.limit ?? entries.length;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(limit) || limit < 0) throw new Error("Invalid OpenClaw session page.");
    const end = Math.min(entries.length, offset + limit);
    return { entries: entries.slice(offset, end), pageInfo: { hasMore: end < entries.length, nextCursor: end < entries.length ? String(end) : null } };
  }

  async fetchAgent(key: string): Promise<{ agent: BackendAgent } | null> {
    // sessions.get returns transcript messages, not session metadata.
    if (this.transport.hasMethod("sessions.describe")) {
      if (!this.models.getProfiles().length) await this.models.fetchProfiles();
      // Older gateways accept only the key; qualified session keys identify
      // their owner without the newer optional agentId/presentation fields.
      const result = asRecord(await this.transport.request("sessions.describe", { key }));
      if (result.session === null) return null;
      if (isRecord(result.session)) {
        const agent = this.upsert(result.session, key);
        if (agent) return { agent };
      }
      throw new OpenClawRpcError("PROTOCOL_ERROR", "sessions.describe did not return a session row.");
    }
    const rows = await this.listRows(true, key);
    const row = rows.find((entry) => entry.key === key);
    return row ? { agent: this.upsert(row, key)! } : null;
  }

  async ensureScope(key: string): Promise<OpenClawSessionScope> {
    if (!this.getAgent(key)) {
      if (!await this.fetchAgent(key)) throw new Error(`OpenClaw session ${key} was not found.`);
    }
    return this.getScope(key);
  }

  async resolveFileScope(cwd: string): Promise<OpenClawFileScope> {
    if (!cwd) throw new Error("OpenClaw file access requires a working directory.");
    const active = this.activeAgentId ? this.agents.get(this.activeAgentId) : undefined;
    if (active?.cwd && pathKey(active.cwd) === pathKey(cwd)) return this.getScope(active.id);
    const matching = () => [...this.agents.values()].filter((agent) => agent.cwd && pathKey(agent.cwd) === pathKey(cwd)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    let session = matching();
    if (session) return this.getScope(session.id);
    await this.models.fetchProfiles();
    await this.listRows(true);
    session = matching();
    if (session) return this.getScope(session.id);
    const profile = [...this.models.getProfiles()].filter((entry) => entry.workspace && contains(entry.workspace, cwd)).sort((a, b) => b.workspace!.length - a.workspace!.length)[0];
    if (!profile?.workspace) throw new Error(`No OpenClaw agent workspace or session is bound to ${cwd}.`);
    return { agentId: profile.id, root: profile.workspace };
  }

  async fetchWorkspaces(): Promise<BackendWorkspacesResult> {
    await this.models.fetchProfiles();
    await this.listRows(true);
    const roots = new Map<string, { root: string; label: string }>();
    for (const profile of this.models.getProfiles()) if (profile.workspace) roots.set(pathKey(profile.workspace), { root: profile.workspace, label: profile.name });
    for (const agent of this.agents.values()) if (agent.cwd) roots.set(pathKey(agent.cwd), { root: agent.cwd, label: agent.cwd.split(/[\\/]/).filter(Boolean).pop() ?? agent.cwd });
    return { entries: [...roots.values()].map(({ root, label }) => ({ id: this.workspaceId(root), title: label, name: label, workspaceDirectory: root, projectRootPath: root, projectDisplayName: label })),
      pageInfo: { hasMore: false, nextCursor: null } };
  }

  async createAgent(options: CreateAgentOptions): Promise<BackendAgent> {
    if (!options.cwd) throw new Error("OpenClaw conversation creation requires an explicit working directory.");
    const agentId = profileId(options.provider);
    const profiles = await this.models.fetchProfiles();
    const profile = profiles.find((profile) => profile.id === agentId);
    if (!profile) throw new Error(`OpenClaw profile ${agentId} is not configured on this gateway.`);
    const idempotencyKey = uniqueId();
    const key = `agent:${agentId}:kel:${idempotencyKey}`;

    if (!this.transport.hasMethod("sessions.create")) {
      if (!this.transport.hasMethod("sessions.patch")) throw new OpenClawRpcError("NOT_IMPLEMENTED", "This OpenClaw gateway does not expose sessions.create or sessions.patch for new conversations.");
      let root = profile.workspace;
      if (!root && this.transport.hasMethod("agents.files.list")) {
        const workspace = asRecord(await this.transport.request("agents.files.list", { agentId }));
        if (workspace.agentId !== agentId) throw new OpenClawRpcError("PROTOCOL_ERROR", "OpenClaw returned another agent's workspace.");
        root = asString(workspace.workspace);
      }
      if (!root) throw new OpenClawRpcError("WORKSPACE_UNAVAILABLE", "OpenClaw did not expose the configured agent workspace for creating this conversation.");
      if (pathKey(options.cwd) !== pathKey(root)) throw new OpenClawRpcError("WORKSPACE_UNSUPPORTED", `This Gateway creates conversations in the configured agent workspace ${root}. Select that directory to start a new conversation; binding another directory requires sessions.create.`);
      // A key-only patch creates a durable row on older gateways. It cannot
      // bind cwd, so only the configured workspace is a valid execution root.
      const result = asRecord(await this.transport.request("sessions.patch", { key, model: options.model ?? null }));
      const actualKey = asString(result.key);
      const entry = asRecord(result.entry);
      if (!actualKey || !asString(entry.sessionId)) throw new OpenClawRpcError("PROTOCOL_ERROR", "sessions.patch did not return a persisted conversation.");
      const resolved = asRecord(result.resolved);
      const agent = this.upsert({ ...entry, key: actualKey, agentId,
        workspaceDir: root, model: resolved.model ?? options.model ?? profile.model,
        modelProvider: resolved.modelProvider, createdAt: entry.createdAt ?? entry.updatedAt ?? Date.now(),
        updatedAt: entry.updatedAt ?? Date.now() }, actualKey);
      if (!agent) throw new OpenClawRpcError("PROTOCOL_ERROR", "OpenClaw returned an unresolved conversation.");
      return agent;
    }

    const result = asRecord(await this.transport.request("sessions.create", { agentId, key, cwd: options.cwd, idempotencyKey,
      ...(options.model ? { model: options.model } : {}) }));
    const actualKey = asString(result.key);
    if (!actualKey) throw new OpenClawRpcError("PROTOCOL_ERROR", "sessions.create did not return the actual session key.");
    const entry = asRecord(result.entry);
    const worktreePath = asString(asRecord(result.worktree).path);
    const resolved = asRecord(result.resolved);
    const agent = this.upsert({ ...entry, key: actualKey, agentId, sessionId: result.sessionId ?? entry.sessionId,
      // The create response entry is a storage entry; prefer its actual task cwd.
      workspaceDir: worktreePath ?? entry.execCwd ?? entry.spawnedCwd ?? entry.workspaceDir ?? entry.spawnedWorkspaceDir ?? options.cwd,
      model: entry.model ?? resolved.model ?? options.model, modelProvider: entry.modelProvider ?? resolved.modelProvider,
      createdAt: entry.createdAt ?? Date.now(), updatedAt: entry.updatedAt ?? Date.now() }, actualKey);
    if (!agent) throw new OpenClawRpcError("PROTOCOL_ERROR", "OpenClaw returned an unresolved conversation.");
    return agent;
  }

  async archiveAgent(key: string): Promise<void> {
    await this.loadArchives();
    await this.ensureScope(key);
    // Hiding a Writer conversation must not cancel another client's gateway run.
    // Endpoint-scoped local archive also works on gateways without a soft archive field.
    const timestamp = new Date().toISOString();
    const persisted = Object.fromEntries(this.archived); persisted[key] = timestamp;
    await this.storage.setItem(this.archiveKey, JSON.stringify(persisted));
    this.archived.set(key, timestamp); this.upsert({}, key);
  }

  async setAgentModel(key: string, model: string | null): Promise<BackendAgent | null> {
    const scope = await this.ensureScope(key);
    const result = asRecord(await this.transport.request("sessions.patch", { key, agentId: scope.agentId, model }));
    const resolved = asRecord(result.resolved);
    return this.upsert({ ...asRecord(result.entry), model: resolved.model ?? model, modelProvider: resolved.modelProvider }, key);
  }
}
