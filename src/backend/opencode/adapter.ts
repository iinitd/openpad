import type {
  BackendAttachment,
  BackendPermissionResponse,
  ConnectionState,
  CreateAgentOptions,
  FetchAgentsOptions,
  FetchAgentTimelineOptions,
  WriterBackend,
} from "../types";
import { OpenCodeEvents } from "./events";
import { OpenCodeFiles } from "./files";
import { OpenCodeSessions } from "./sessions";
import { OpenCodeTransport, type OpenCodeConnectionOptions } from "./transport";

/** All OpenCode HTTP/SSE details stay behind the WriterBackend contract. */
export class OpenCodeBackend implements WriterBackend {
  readonly kind = "opencode" as const;
  readonly transport: OpenCodeTransport;
  readonly sessions: OpenCodeSessions;
  private readonly events: OpenCodeEvents;
  private readonly files: OpenCodeFiles;

  constructor(options: OpenCodeConnectionOptions) {
    this.transport = new OpenCodeTransport(options);
    this.sessions = new OpenCodeSessions(this.transport);
    this.events = new OpenCodeEvents(this.transport, this.sessions);
    this.files = new OpenCodeFiles(this.transport);
  }

  async connect(): Promise<void> {
    await this.transport.connect();
  }

  async close(): Promise<void> {
    this.events.close();
    await this.transport.close();
  }

  setReconnectEnabled(enabled: boolean): void {
    this.transport.setReconnectEnabled(enabled);
  }

  getConnectionState(): ConnectionState {
    return this.transport.getConnectionState();
  }

  subscribeConnectionStatus(listener: (state: ConnectionState) => void): () => void {
    return this.transport.subscribeConnectionStatus(listener);
  }

  getLastServerInfoMessage(): { version: string | null } | null {
    return this.transport.getVersion() ? { version: this.transport.getVersion() } : null;
  }

  fetchWorkspaces() {
    return this.sessions.fetchWorkspaces();
  }

  fetchAgents(options?: FetchAgentsOptions) {
    return this.sessions.fetchAgents(options);
  }

  async fetchAgent(id: string) {
    const result = await this.sessions.fetchAgent(id);
    if (result) this.events.track(id);
    return result;
  }

  async createAgent(options: CreateAgentOptions) {
    const agent = await this.sessions.createAgent(options);
    this.events.track(agent.id);
    this.events.publishAgent(agent.id);
    if (options.initialPrompt) {
      try {
        await this.events.sendMessage(agent.id, options.initialPrompt);
      } catch (error) {
        this.events.reportError(agent.id, error);
      }
    }
    return this.sessions.getAgent(agent.id) ?? agent;
  }

  async archiveAgent(id: string): Promise<void> {
    await this.sessions.archiveAgent(id);
    this.events.publishAgent(id);
  }

  cancelAgent(id: string): Promise<void> {
    return this.events.cancel(id);
  }

  async setAgentModel(id: string, model: string | null): Promise<void> {
    await this.sessions.setAgentModel(id, model);
    this.events.publishAgent(id);
  }

  sendAgentMessage(
    id: string,
    text: string,
    options?: { messageId?: string; attachments?: BackendAttachment[] },
  ): Promise<void> {
    return this.events.sendMessage(id, text, options?.messageId, options?.attachments);
  }

  fetchAgentTimeline(id: string, options?: FetchAgentTimelineOptions) {
    return this.events.fetchTimeline(id, options);
  }

  setActiveAgent(_id: string | null): void {
    // OpenCode file access is location-scoped, not session-scoped.
  }

  listDirectory(cwd: string, path: string) {
    return this.files.listDirectory(cwd, path);
  }

  readFile(cwd: string, path: string) {
    return this.files.readFile(cwd, path);
  }

  getProvidersSnapshot(options?: { cwd?: string }) {
    return this.sessions.snapshotProviders(options?.cwd);
  }

  respondToPermission(id: string, requestId: string, response: BackendPermissionResponse): Promise<void> {
    const selected = response.selectedActionId;
    const decision = response.behavior === "allow" && selected !== "reject" ? "once" : "reject";
    return this.events.respondToPermission(id, requestId, decision);
  }

  onAgentStream: WriterBackend["onAgentStream"] = (listener) => this.events.onAgentStream(listener);
  onAgentUpdate: WriterBackend["onAgentUpdate"] = (listener) => this.events.onAgentUpdate(listener);
  onPermissionRequest: WriterBackend["onPermissionRequest"] = (listener) => this.events.onPermissionRequest(listener);
}
