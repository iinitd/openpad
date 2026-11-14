import type { ConnectionState } from "../types";
import {
  buildDeviceAuthPayloadV3, clearOpenClawDeviceToken, defaultOpenClawStorage,
  loadOpenClawDeviceIdentity, loadOpenClawDeviceToken, normalizeOpenClawUrl,
  storeOpenClawDeviceToken,
  type OpenClawDeviceIdentity, type OpenClawDeviceToken, type OpenClawStorage,
} from "./device-identity";
import {
  asRecord, asString, gatewayResponseError, isRecord, OpenClawRpcError,
  parseGatewayFrame, readGatewayChallenge, readGatewayHello,
  type GatewayEvent, type GatewayFeatures, type GatewayHello, type GatewayResponse,
} from "./wire";

export { OpenClawRpcError } from "./wire";
export type { GatewayEvent, GatewayFeatures, GatewayHello } from "./wire";
export type { OpenClawStorage } from "./device-identity";

/** The subset shared by browser WebSocket and React Native WebSocket. */
export interface OpenClawWebSocket {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: { code: number; reason?: string }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface OpenClawConnectionOptions {
  url: string;
  token?: string;
  password?: string;
  /** Total handshake deadline, including device preparation, startup waits and an auth retry. */
  timeoutMs?: number;
  requestTimeoutMs?: number;
  scopes?: readonly string[];
  platform?: string;
  deviceFamily?: string;
  clientVersion?: string;
  caps?: readonly string[];
  reconnectEnabled?: boolean;
  /** Prefer the endpoint-bound device credential; retry stale credentials once with shared auth. */
  preferDeviceToken?: boolean;
  storage?: OpenClawStorage;
  webSocketFactory?: (url: string) => OpenClawWebSocket;
  onConnectionStatus?: (state: ConnectionState) => void;
}

const DEFAULT_SCOPES = ["operator.read", "operator.write", "operator.admin", "operator.approvals"];
const CLIENT_ID = "openclaw-control-ui";
const CLIENT_MODE = "ui";
const ROLE = "operator";
const MAX_TIMER_MS = 2_147_483_647;

function timeout(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_MS) {
    throw new Error("OpenClaw timeout must be a positive number of milliseconds within the timer range.");
  }
  return value;
}

type PendingRequest = {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

type ConnectionWait = {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  retryUsed: boolean;
  deadlineMs: number;
  startupRetried: boolean;
  startupTimer: ReturnType<typeof setTimeout> | null;
};

type AuthMode = "normal" | "device-retry" | "shared-retry";
type AuthPlan = {
  identity: OpenClawDeviceIdentity;
  stored: OpenClawDeviceToken | null;
  deviceToken?: string;
};

type Attempt = {
  id: number;
  socket: OpenClawWebSocket | null;
  challengeSeen: boolean;
  connectId: string | null;
  authMode: AuthMode;
  plan: AuthPlan | null;
  helloReceived: boolean;
  connectFailureHandling: boolean;
  /** The outer gateway sequence spans event types; payload run sequences are independent. */
  lastEventSeq: number | null;
};

/** Operator device pairing and RPC transport; listeners survive reconnection. */
export class OpenClawTransport {
  readonly kind = "openclaw" as const;
  readonly url: string;
  private readonly options: OpenClawConnectionOptions;
  private readonly storage: OpenClawStorage;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly scopes: string[];
  private state: ConnectionState = { status: "idle" };
  private readonly statusListeners = new Set<(state: ConnectionState) => void>();
  private readonly eventListeners = new Set<(event: GatewayEvent) => void>();
  private readonly pending = new Map<string, PendingRequest>();
  private attempt: Attempt | null = null;
  private connectionWait: ConnectionWait | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectEnabled: boolean;
  private reconnectFailures = 0;
  private attemptCount = 0;
  private requestCount = 0;
  private disposed = false;
  private terminalFailure = false;
  private hello: GatewayHello | null = null;
  private serverInfo: { version: string | null } | null = null;
  private lastActivityMs = 0;

  constructor(options: OpenClawConnectionOptions) {
    this.url = normalizeOpenClawUrl(options.url);
    this.options = { ...options, token: options.token?.trim() || undefined, password: options.password || undefined };
    this.storage = options.storage ?? defaultOpenClawStorage;
    this.connectTimeoutMs = timeout(options.timeoutMs, 30_000);
    this.requestTimeoutMs = timeout(options.requestTimeoutMs, 30_000);
    this.scopes = [...new Set(options.scopes ?? DEFAULT_SCOPES)];
    if (this.scopes.some((scope) => typeof scope !== "string" || !scope.trim())) {
      throw new Error("OpenClaw operator scopes must be nonempty strings.");
    }
    this.reconnectEnabled = options.reconnectEnabled ?? false;
    if (options.onConnectionStatus) this.statusListeners.add(options.onConnectionStatus);
  }

  connect(): Promise<void> {
    if (this.disposed) return Promise.reject(new OpenClawRpcError("DISPOSED", "OpenClaw connection has been closed."));
    if (this.connectionWait) return this.connectionWait.promise;
    if (this.state.status === "connected") return Promise.resolve();
    this.cancelReconnect();
    // An explicit user retry may recover after pairing or credential correction.
    this.terminalFailure = false;
    return this.beginConnection();
  }

  private beginConnection(): Promise<void> {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((accept, fail) => { resolve = accept; reject = fail; });
    const wait: ConnectionWait = {
      promise, resolve, reject, retryUsed: false,
      deadlineMs: Date.now() + this.connectTimeoutMs, startupRetried: false, startupTimer: null,
      timer: setTimeout(() => {
        if (this.connectionWait !== wait) return;
        this.failConnectionTimeout(wait);
      }, this.connectTimeoutMs),
    };
    this.connectionWait = wait;
    this.startAttempt("normal");
    return promise;
  }

  private startAttempt(authMode: AuthMode): void {
    if (this.disposed || !this.connectionWait) return;
    if (Date.now() >= this.connectionWait.deadlineMs) {
      this.failConnectionTimeout(this.connectionWait);
      return;
    }
    const attempt: Attempt = {
      id: ++this.attemptCount, socket: null, challengeSeen: false, connectId: null,
      authMode, plan: null, helloReceived: false, connectFailureHandling: false, lastEventSeq: null,
    };
    this.attempt = attempt;
    this.hello = null;
    this.setState({ status: "connecting", attempt: attempt.id });
    if (!this.isActive(attempt)) return;
    try {
      const socket = this.options.webSocketFactory
        ? this.options.webSocketFactory(this.url)
        : new WebSocket(this.url) as unknown as OpenClawWebSocket;
      attempt.socket = socket;
      socket.onopen = () => {
        // Authentication begins only after a valid server challenge, never on open.
        if (this.isActive(attempt)) this.lastActivityMs = Date.now();
      };
      socket.onmessage = (event) => {
        if (!this.isActive(attempt)) return;
        this.handleMessage(attempt, event.data);
      };
      socket.onerror = () => {
        if (!this.isActive(attempt) || attempt.connectFailureHandling) return;
        this.loseConnection(new OpenClawRpcError("CONNECTION_ERROR", "Could not reach OpenClaw. Check the gateway URL, allowed browser origins, and network connection."));
      };
      socket.onclose = (event) => {
        // A gateway commonly closes directly after its rejection frame. Let the
        // received failure finish token cleanup/retry under the total deadline.
        if (!this.isActive(attempt) || attempt.connectFailureHandling) return;
        const denied = event.code === 1008;
        this.loseConnection(new OpenClawRpcError(denied ? "CONNECTION_DENIED" : "CONNECTION_LOST",
          denied ? "OpenClaw rejected the connection. Check gateway authentication, device pairing, and allowed browser origins."
            : `OpenClaw connection closed (${event.code}).`), denied);
      };
    } catch {
      if (this.isActive(attempt)) this.loseConnection(new OpenClawRpcError("CONNECTION_ERROR", "Could not open the OpenClaw WebSocket connection."));
    }
  }

  private handleMessage(attempt: Attempt, data: unknown): void {
    if (attempt.connectFailureHandling) return;
    try {
      if (typeof data !== "string") throw new OpenClawRpcError("PROTOCOL_ERROR", "OpenClaw sent a non-text protocol frame.");
      const message = parseGatewayFrame(data);
      this.lastActivityMs = Date.now();
      if (message.type === "event") {
        if (message.event === "connect.challenge") {
          const challenge = readGatewayChallenge(message.payload);
          if (attempt.challengeSeen || attempt.helloReceived) {
            throw new OpenClawRpcError("INVALID_CHALLENGE", "OpenClaw sent a duplicate connect challenge.");
          }
          attempt.challengeSeen = true;
          void this.sendConnect(attempt, challenge).catch((error: unknown) => {
            if (this.isActive(attempt)) this.loseConnection(this.safeLocalError(error), true);
          });
          return;
        }
        if (!attempt.helloReceived) return;
        if (message.seq !== undefined) {
          const lastSeq = attempt.lastEventSeq;
          // Replayed or older numbered frames must not append content twice.
          if (lastSeq !== null && message.seq <= lastSeq) return;
          if (lastSeq !== null && message.seq > lastSeq + 1) {
            const state = asRecord(message.payload).state;
            if (message.event === "chat" && (state === "final" || state === "error" || state === "aborted")) {
              // Terminal snapshots can settle the run despite missing earlier appends.
              this.dispatchEvent(attempt, message);
            }
            if (this.isActive(attempt)) {
              this.loseConnection(new OpenClawRpcError("EVENT_SEQUENCE_GAP",
                "OpenClaw event updates were missed. Reconnecting to refresh conversation history.",
                { expected: lastSeq + 1, received: message.seq }));
            }
            return;
          }
          // The first numbered event establishes this connection's baseline.
          attempt.lastEventSeq = message.seq;
        }
        this.dispatchEvent(attempt, message);
        return;
      }
      if (message.type === "req") {
        // This operator UI exposes no node/worker command execution surface.
        this.send(attempt, { type: "res", id: message.id, ok: false,
          error: { code: "METHOD_NOT_FOUND", message: "This operator UI does not accept gateway-initiated RPC methods." } });
        return;
      }
      if (message.id === attempt.connectId) {
        if (attempt.helloReceived) throw new OpenClawRpcError("PROTOCOL_ERROR", "OpenClaw sent a duplicate hello response.");
        if (!message.ok) {
          // Retain terminal policy immediately: close may arrive while token cleanup awaits storage.
          this.terminalFailure = true;
          attempt.connectFailureHandling = true;
          void this.handleConnectFailure(attempt, message).catch((error: unknown) => {
            if (this.isActive(attempt)) this.loseConnection(this.safeLocalError(error), true);
          });
          return;
        }
        this.acceptHello(attempt, message.payload);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.payload);
      else pending.reject(this.redactRpcError(gatewayResponseError(message, pending.method)));
    } catch (error) {
      if (this.isActive(attempt)) this.loseConnection(this.safeLocalError(error), true);
    }
  }

  private dispatchEvent(attempt: Attempt, message: GatewayEvent): void {
    // Synchronous dispatch preserves subscription ordering between frames.
    for (const listener of [...this.eventListeners]) {
      if (!this.isActive(attempt)) break;
      if (this.eventListeners.has(listener)) this.invoke(() => listener(message));
    }
  }

  private async sendConnect(attempt: Attempt, challenge: { nonce: string; ts: number }): Promise<void> {
    const identity = await loadOpenClawDeviceIdentity(this.storage);
    if (!this.isActive(attempt)) return;
    const stored = await loadOpenClawDeviceToken(this.storage, this.url, identity.deviceId, ROLE);
    if (!this.isActive(attempt)) return;
    const sharedToken = this.options.token;
    const sharedPassword = this.options.password;
    const useStored = Boolean(stored) && (attempt.authMode === "device-retry" ||
      (attempt.authMode === "normal" && (this.options.preferDeviceToken === true || !(sharedToken || sharedPassword))));
    const deviceToken = useStored ? stored?.token : undefined;
    // The official retry sends both fields, signing the explicit shared token.
    const token = attempt.authMode === "device-retry" ? sharedToken : deviceToken ? undefined : sharedToken;
    const password = deviceToken && attempt.authMode !== "device-retry" ? undefined : sharedPassword;
    const auth: Record<string, string> = {};
    if (token) auth.token = token;
    if (deviceToken) auth.deviceToken = deviceToken;
    if (password) auth.password = password;
    const platform = this.options.platform?.trim() || "web";
    const deviceFamily = this.options.deviceFamily?.trim() || undefined;
    const signature = identity.sign(buildDeviceAuthPayloadV3({
      deviceId: identity.deviceId, clientId: CLIENT_ID, clientMode: CLIENT_MODE, role: ROLE,
      scopes: this.scopes, signedAtMs: challenge.ts, token: token ?? deviceToken ?? null,
      nonce: challenge.nonce, platform, deviceFamily,
    }));
    attempt.plan = { identity, stored, deviceToken };
    attempt.connectId = this.nextRequestId();
    this.send(attempt, {
      type: "req", id: attempt.connectId, method: "connect",
      params: {
        minProtocol: 3, maxProtocol: 4,
        client: { id: CLIENT_ID, mode: CLIENT_MODE, displayName: "Clacko",
          version: this.options.clientVersion?.trim() || "1.0.0", platform,
          ...(deviceFamily ? { deviceFamily } : {}), instanceId: identity.deviceId },
        role: ROLE, scopes: this.scopes, caps: [...(this.options.caps ?? ["tool-events", "exec-approvals"])],
        device: { id: identity.deviceId, publicKey: identity.publicKey, signature,
          signedAt: challenge.ts, nonce: challenge.nonce },
        ...(Object.keys(auth).length ? { auth } : {}),
      },
    });
  }

  private acceptHello(attempt: Attempt, payload: unknown): void {
    const hello = readGatewayHello(payload);
    if (hello.auth.role !== ROLE || !attempt.plan) {
      throw new OpenClawRpcError("AUTH_SCOPE_MISMATCH", "OpenClaw did not authorize this device as an operator.");
    }
    attempt.helloReceived = true;
    this.hello = hello;
    this.serverInfo = { version: hello.server.version };
    this.reconnectFailures = 0;
    this.terminalFailure = false;
    this.startTickWatch(hello.policy.tickIntervalMs);
    // Publish readiness before any later frame or connect() continuation reconciles subscriptions.
    this.setState({ status: "connected" });
    if (!this.isActive(attempt)) return;
    const auth = asRecord(asRecord(payload).auth);
    const token = asString(auth.deviceToken)?.trim();
    const plan = attempt.plan;
    const persist = token
      ? storeOpenClawDeviceToken(this.storage, this.url, plan.identity.deviceId, ROLE, {
          token, scopes: plan.stored?.token === token ? plan.stored.scopes : hello.auth.scopes,
        })
      : Promise.resolve();
    void persist.then(() => {
      if (!this.isActive(attempt)) return;
      const wait = this.connectionWait;
      this.connectionWait = null;
      if (wait) { clearTimeout(wait.timer); wait.resolve(); }
    }, () => {
      if (this.isActive(attempt)) this.loseConnection(new OpenClawRpcError("DEVICE_STORAGE_ERROR", "Could not persist the OpenClaw device credential. Check app storage and reconnect."), true);
    });
  }

  private async handleConnectFailure(attempt: Attempt, response: GatewayResponse): Promise<void> {
    const error = this.redactRpcError(gatewayResponseError(response, "connect"));
    const detailCode = asString(asRecord(error.details).code) ?? error.code;
    const plan = attempt.plan;
    const wait = this.connectionWait;
    if (wait && error.code === "UNAVAILABLE" && error.retryable === true &&
        asRecord(error.details).reason === "startup-sidecars") {
      // Only the canonical startup rejection may wait without operator action.
      // Keep the original deadline and auth retry budget across fresh sockets.
      const remainingMs = wait.deadlineMs - Date.now();
      wait.startupRetried = true;
      if (remainingMs <= 0) { this.failConnectionTimeout(wait); return; }
      const delayMs = Math.min(2_000, Math.max(100, Math.floor(error.retryAfterMs ?? 500)));
      this.terminalFailure = false;
      this.retireAttempt(attempt);
      wait.startupTimer = setTimeout(() => {
        wait.startupTimer = null;
        if (this.disposed || this.connectionWait !== wait) return;
        this.startAttempt(attempt.authMode);
      }, Math.min(delayMs, remainingMs));
      return;
    }
    let retryMode: AuthMode | null = null;
    if (detailCode === "AUTH_DEVICE_TOKEN_MISMATCH" && plan?.deviceToken) {
      await clearOpenClawDeviceToken(this.storage, this.url, plan.identity.deviceId, ROLE, plan.deviceToken);
      if (!this.isActive(attempt)) return;
      if (wait && !wait.retryUsed && (this.options.token || this.options.password)) retryMode = "shared-retry";
    } else if (plan && !plan.deviceToken && this.options.token && plan.stored && wait && !wait.retryUsed) {
      const details = asRecord(error.details);
      if (detailCode === "AUTH_TOKEN_MISMATCH" || details.canRetryWithDeviceToken === true ||
          details.recommendedNextStep === "retry_with_device_token") retryMode = "device-retry";
    }
    if (!this.isActive(attempt)) return;
    if (retryMode && wait) {
      wait.retryUsed = true;
      this.retireAttempt(attempt);
      this.terminalFailure = false;
      this.startAttempt(retryMode);
      return;
    }
    // Other rejected handshakes need explicit operator action; no background auth loops.
    this.loseConnection(error, true);
  }

  request<T = unknown>(method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<T> {
    const attempt = this.attempt;
    if (!attempt || this.state.status !== "connected" || !attempt.helloReceived) {
      return Promise.reject(new OpenClawRpcError("NOT_CONNECTED", "OpenClaw is not connected."));
    }
    if (!method.trim() || method === "connect" || (params !== undefined && !isRecord(params))) {
      return Promise.reject(new OpenClawRpcError("INVALID_REQUEST", "OpenClaw RPC requires a method and an object payload; connect is reserved for the handshake."));
    }
    if (!this.hasMethod(method)) {
      return Promise.reject(new OpenClawRpcError("METHOD_NOT_FOUND", `This OpenClaw gateway does not advertise ${method}. Update the gateway or choose a supported operation.`));
    }
    let timeoutMs: number;
    try { timeoutMs = timeout(options?.timeoutMs, this.requestTimeoutMs); }
    catch (error) { return Promise.reject(error); }
    const id = this.nextRequestId();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.reject(new OpenClawRpcError("RPC_TIMEOUT", `OpenClaw ${method} timed out. Its outcome is unknown; refresh before retrying a mutation.`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve: (value) => resolve(value as T), reject, timer });
      try { this.send(attempt, { type: "req", id, method, ...(params === undefined ? {} : { params }) }); }
      catch (error) {
        if (error instanceof OpenClawRpcError && error.code === "INVALID_REQUEST") {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(error);
        } else this.loseConnection(this.safeLocalError(error));
      }
    });
  }

  onEvent(listener: (message: GatewayEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }

  subscribeConnectionStatus(listener: (state: ConnectionState) => void): () => void {
    this.statusListeners.add(listener);
    this.invoke(() => listener(this.getConnectionState()));
    return () => { this.statusListeners.delete(listener); };
  }

  getConnectionState(): ConnectionState { return { ...this.state }; }
  getLastServerInfoMessage(): { version: string | null } | null { return this.serverInfo ? { ...this.serverInfo } : null; }
  getHello(): GatewayHello | null {
    return this.hello ? JSON.parse(JSON.stringify(this.hello)) as GatewayHello : null;
  }
  getFeatures(): GatewayFeatures | null {
    const features = this.hello?.features;
    return features ? { methods: [...features.methods], events: [...features.events],
      ...(features.capabilities ? { capabilities: [...features.capabilities] } : {}) } : null;
  }
  getGrantedScopes(): string[] { return [...(this.hello?.auth.scopes ?? [])]; }
  getNegotiatedProtocol(): number | null { return this.hello?.protocol ?? null; }
  hasMethod(method: string): boolean { return this.hello?.features.methods.includes(method) ?? false; }
  hasEvent(event: string): boolean { return this.hello?.features.events.includes(event) ?? false; }

  setReconnectEnabled(enabled: boolean): void {
    this.reconnectEnabled = enabled;
    if (!enabled) this.cancelReconnect();
    else if (!this.disposed && !this.terminalFailure && !this.connectionWait && this.state.status === "disconnected") this.scheduleReconnect();
  }

  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.reconnectEnabled = false;
    this.cancelReconnect();
    this.stopTickWatch();
    if (this.attempt) this.retireAttempt(this.attempt);
    this.hello = null;
    const error = new OpenClawRpcError("DISPOSED", "OpenClaw connection has been closed.");
    this.rejectPending(error);
    this.rejectConnectionWait(error);
    this.setState({ status: "disposed" });
    this.statusListeners.clear();
    this.eventListeners.clear();
  }

  private send(attempt: Attempt, value: Record<string, unknown>): void {
    if (!this.isActive(attempt) || !attempt.socket || attempt.socket.readyState !== 1) {
      throw new OpenClawRpcError("CONNECTION_LOST", "OpenClaw connection was lost before the request could be sent.");
    }
    let text: string;
    try { text = JSON.stringify(value); }
    catch { throw new OpenClawRpcError("INVALID_REQUEST", "OpenClaw request could not be encoded as JSON."); }
    try { attempt.socket.send(text); }
    catch { throw new OpenClawRpcError("CONNECTION_LOST", "OpenClaw connection was lost while sending the request. Its outcome may be unknown."); }
  }

  private nextRequestId(): string { return `kel-${this.attemptCount}-${++this.requestCount}`; }
  private isActive(attempt: Attempt): boolean { return !this.disposed && this.attempt === attempt; }

  private retireAttempt(attempt: Attempt): void {
    if (this.attempt === attempt) this.attempt = null;
    const socket = attempt.socket;
    if (!socket) return;
    socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null;
    try { socket.close(1000, "client disconnect"); } catch { /* Already closed. */ }
  }

  private loseConnection(error: Error, terminal = false): void {
    if (this.disposed) return;
    this.terminalFailure ||= terminal;
    this.stopTickWatch();
    if (this.attempt) this.retireAttempt(this.attempt);
    this.hello = null;
    this.rejectPending(error);
    this.rejectConnectionWait(error);
    this.setState({ status: "disconnected", reason: error.message });
    this.scheduleReconnect();
  }

  private rejectConnectionWait(error: Error): void {
    const wait = this.connectionWait;
    this.connectionWait = null;
    if (wait) {
      clearTimeout(wait.timer);
      if (wait.startupTimer !== null) clearTimeout(wait.startupTimer);
      wait.reject(error);
    }
  }

  private failConnectionTimeout(wait: ConnectionWait): void {
    // Expired startup admission must not obtain a fresh budget via background reconnect.
    this.loseConnection(new OpenClawRpcError("CONNECT_TIMEOUT",
      `OpenClaw handshake timed out after ${this.connectTimeoutMs / 1000}s.`), wait.startupRetried);
  }

  private rejectPending(error: Error): void {
    const requests = [...this.pending.values()];
    this.pending.clear();
    for (const request of requests) { clearTimeout(request.timer); request.reject(error); }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.terminalFailure || !this.reconnectEnabled || this.reconnectTimer || this.connectionWait || this.attempt) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectFailures++, 5));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed || this.terminalFailure || !this.reconnectEnabled) return;
      void this.beginConnection().catch(() => { /* State and retry policy own background failures. */ });
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private startTickWatch(tickIntervalMs: number): void {
    this.stopTickWatch();
    this.lastActivityMs = Date.now();
    // All valid inbound frames prove liveness, including the gateway's tick events.
    const threshold = Math.min(MAX_TIMER_MS, tickIntervalMs * 2);
    const interval = Math.max(1, Math.min(tickIntervalMs, 30_000));
    this.tickTimer = setInterval(() => {
      if (this.state.status === "connected" && Date.now() - this.lastActivityMs > threshold) {
        this.loseConnection(new OpenClawRpcError("TICK_TIMEOUT", "OpenClaw stopped sending keepalive events. Reconnecting to refresh the connection."));
      }
    }, interval);
  }

  private stopTickWatch(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    for (const listener of [...this.statusListeners]) {
      if (this.state !== state) break;
      if (this.statusListeners.has(listener)) this.invoke(() => listener({ ...state }));
    }
  }

  private invoke(callback: () => void): void {
    try { callback(); } catch { /* One subscriber cannot interrupt other subscribers or protocol processing. */ }
  }

  private redactRpcError(error: OpenClawRpcError): OpenClawRpcError {
    let message = error.message;
    const secrets = [this.options.token, this.options.password, this.attempt?.plan?.stored?.token, this.attempt?.plan?.deviceToken];
    for (const secret of secrets) if (secret) message = message.split(secret).join("[redacted]");
    return new OpenClawRpcError(error.code, message, error.details, error.retryAfterMs, error.retryable);
  }

  private safeLocalError(error: unknown): Error {
    if (error instanceof OpenClawRpcError) return this.redactRpcError(error);
    // Storage and socket implementations may echo their inputs; do not surface them.
    return new OpenClawRpcError("DEVICE_AUTH_ERROR", "Could not prepare OpenClaw device authentication. Check secure random generation and persistent app storage.");
  }
}
