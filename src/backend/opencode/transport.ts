import type { ConnectionState } from "../types";
import { openServerSentEvents, type SseHandle, type SseHandlers } from "./sse";
import { asRecord, asString, bodyError, OpenCodeRequestError } from "./wire";

export interface OpenCodeConnectionOptions {
  /** HTTP(S) origin of `opencode serve`, optionally including a reverse-proxy path. */
  url: string;
  /** Basic-auth username; OpenCode defaults to "opencode". */
  username?: string;
  /** OPENCODE_SERVER_PASSWORD, when the server is protected. */
  password?: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  reconnectEnabled?: boolean;
  /** Injectable event transport; defaults to XMLHttpRequest-based SSE. */
  sseFactory?: (url: string, headers: Record<string, string>, handlers: SseHandlers) => SseHandle;
}

const MAX_TIMER_MS = 2_147_483_647;
const DEFAULT_USERNAME = "opencode";

function boundedTimeout(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_MS) {
    throw new Error("OpenCode timeout must be a positive number of milliseconds within the timer range.");
  }
  return value;
}

export function normalizeOpenCodeUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("Enter the OpenCode server URL.");
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("Enter a valid OpenCode server URL, such as http://localhost:4096.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OpenCode server URLs must start with http:// or https://.");
  }
  if (!url.hostname) throw new Error("The OpenCode server URL is missing a host.");
  url.username = "";
  url.password = "";
  url.hash = "";
  url.search = "";
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

export function openCodeAuthHeader(username: string, password: string): string | null {
  if (!password) return null;
  return `Basic ${base64Utf8(`${username || DEFAULT_USERNAME}:${password}`)}`;
}

function base64Utf8(value: string): string {
  const binary = unescape(encodeURIComponent(value));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < binary.length; index += 3) {
    const a = binary.charCodeAt(index);
    const b = index + 1 < binary.length ? binary.charCodeAt(index + 1) : NaN;
    const c = index + 2 < binary.length ? binary.charCodeAt(index + 2) : NaN;
    const triple = (a << 16) | ((Number.isNaN(b) ? 0 : b) << 8) | (Number.isNaN(c) ? 0 : c);
    output += alphabet[(triple >> 18) & 63];
    output += alphabet[(triple >> 12) & 63];
    output += Number.isNaN(b) ? "=" : alphabet[(triple >> 6) & 63];
    output += Number.isNaN(c) ? "=" : alphabet[triple & 63];
  }
  return output;
}

type Listener<T> = (value: T) => void;

/** HTTP + SSE transport for the OpenCode v2 server API. */
export class OpenCodeTransport {
  readonly kind = "opencode" as const;
  readonly url: string;
  private readonly username: string;
  private readonly password: string;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly sseFactory: (url: string, headers: Record<string, string>, handlers: SseHandlers) => SseHandle;
  private readonly statusListeners = new Set<Listener<ConnectionState>>();
  private readonly eventListeners = new Set<Listener<Record<string, unknown>>>();
  private state: ConnectionState = { status: "idle" };
  private sse: SseHandle | null = null;
  private connectTask: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectEnabled: boolean;
  private failures = 0;
  private attempts = 0;
  private disposed = false;
  private serverVersion: string | null = null;

  constructor(options: OpenCodeConnectionOptions) {
    this.url = normalizeOpenCodeUrl(options.url);
    this.username = options.username?.trim() || DEFAULT_USERNAME;
    this.password = options.password ?? "";
    this.connectTimeoutMs = boundedTimeout(options.connectTimeoutMs, 20_000);
    this.requestTimeoutMs = boundedTimeout(options.requestTimeoutMs, 30_000);
    this.sseFactory = options.sseFactory ?? openServerSentEvents;
    this.reconnectEnabled = options.reconnectEnabled ?? false;
  }

  getConnectionState(): ConnectionState {
    return this.state;
  }

  subscribeConnectionStatus(listener: Listener<ConnectionState>): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  onEvent(listener: Listener<Record<string, unknown>>): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  getVersion(): string | null {
    return this.serverVersion;
  }

  setReconnectEnabled(enabled: boolean): void {
    this.reconnectEnabled = enabled;
    if (!enabled) this.cancelReconnect();
  }

  connect(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new OpenCodeRequestError("DISPOSED", "The OpenCode connection was closed."));
    }
    if (this.state.status === "connected") return Promise.resolve();
    if (this.connectTask) return this.connectTask;
    this.cancelReconnect();
    const task = this.establish().finally(() => {
      if (this.connectTask === task) this.connectTask = null;
    });
    this.connectTask = task;
    return task;
  }

  close(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.disposed = true;
    this.cancelReconnect();
    this.closeEvents();
    this.setState({ status: "disposed" });
    this.statusListeners.clear();
    this.eventListeners.clear();
    return Promise.resolve();
  }

  private async establish(): Promise<void> {
    const attempt = ++this.attempts;
    this.setState({ status: "connecting", attempt });
    try {
      const info = await this.requestJson<Record<string, unknown>>("/api/info", undefined, this.connectTimeoutMs);
      if (this.disposed) throw new OpenCodeRequestError("DISPOSED", "The OpenCode connection was closed.");
      const version = asString(info.version) ?? null;
      this.serverVersion = version;
      await this.openEvents();
    } catch (error) {
      let message = error instanceof Error ? error.message : "Could not connect to OpenCode.";
      if (error instanceof OpenCodeRequestError && error.status === 404) {
        message = "This server does not expose the OpenCode v2 /api endpoints. Clacko requires OpenCode v2 (`opencode serve`).";
        error = new OpenCodeRequestError("UNSUPPORTED", message, 404);
      }
      this.closeEvents();
      if (!this.disposed) {
        this.setState({ status: "disconnected", reason: message });
        this.scheduleReconnect();
      }
      throw error instanceof Error ? error : new Error(message);
    }
  }

  private openEvents(): Promise<void> {
    this.closeEvents();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let opened = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.closeEvents();
        reject(new OpenCodeRequestError(
          "TIMEOUT",
          "OpenCode accepted the connection but its event stream did not start. Check that the server exposes /api/event and allows this origin.",
        ));
        this.scheduleReconnect();
      }, this.connectTimeoutMs);

      const headers: Record<string, string> = {};
      const auth = openCodeAuthHeader(this.username, this.password);
      if (auth) headers.Authorization = auth;

      this.sse = this.sseFactory(this.apiUrl("/api/event"), headers, {
        onOpen: () => {
          if (settled) return;
          settled = true;
          opened = true;
          clearTimeout(timer);
          this.failures = 0;
          this.setState({ status: "connected" });
          resolve();
        },
        onEvent: (data) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            return;
          }
          const record = asRecord(parsed);
          if (Object.keys(record).length === 0) return;
          for (const listener of [...this.eventListeners]) {
            try {
              listener(record);
            } catch {
              // Isolate subscriber failures.
            }
          }
        },
        onError: (message, status) => {
          this.sse = null;
          if (this.disposed) return;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new OpenCodeRequestError("NOT_CONNECTED", message, status));
          }
          if (!opened) {
            this.setState({ status: "disconnected", reason: message });
            this.scheduleReconnect();
            return;
          }
          this.setState({ status: "disconnected", reason: message });
          this.scheduleReconnect();
        },
      });
    });
  }

  private closeEvents(): void {
    this.sse?.close();
    this.sse = null;
  }

  private scheduleReconnect(): void {
    if (this.disposed || !this.reconnectEnabled || this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** Math.min(this.failures, 4), 15_000);
    this.failures += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {
        // The next attempt is scheduled by establish().
      });
    }, delay);
  }

  private cancelReconnect(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setState(state: ConnectionState): void {
    const previous = this.state;
    if (previous.status === state.status &&
      (state.status !== "connecting" || previous.status !== "connecting" || previous.attempt === state.attempt) &&
      (state.status !== "disconnected" || previous.status !== "disconnected" || previous.reason === state.reason)) {
      return;
    }
    this.state = state;
    for (const listener of [...this.statusListeners]) {
      try {
        listener(state);
      } catch {
        // Isolate subscriber failures.
      }
    }
  }

  private apiUrl(path: string): string {
    return `${this.url}${path}`;
  }

  private authHeader(): string | null {
    return openCodeAuthHeader(this.username, this.password);
  }

  async requestJson<T>(path: string, init?: RequestInit, timeoutMs = this.requestTimeoutMs): Promise<T> {
    const response = await this.send(path, init, timeoutMs);
    const text = await response.text();
    let body: unknown = null;
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new OpenCodeRequestError("PROTOCOL_ERROR", "OpenCode returned a response that was not valid JSON.");
      }
    }
    if (!response.ok) throw this.httpError(response.status, body);
    return body as T;
  }

  async requestBytes(path: string, init?: RequestInit, timeoutMs = this.requestTimeoutMs): Promise<{
    bytes: Uint8Array;
    mime: string;
    modifiedAt?: string;
  }> {
    const response = await this.send(path, init, timeoutMs);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      throw this.httpError(response.status, body);
    }
    const buffer = await response.arrayBuffer();
    return {
      bytes: new Uint8Array(buffer),
      mime: response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream",
      modifiedAt: response.headers.get("last-modified") ?? undefined,
    };
  }

  private async send(path: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
    if (this.disposed) throw new OpenCodeRequestError("DISPOSED", "The OpenCode connection was closed.");
    const headers = new Headers(init?.headers);
    const auth = this.authHeader();
    if (auth && !headers.has("Authorization")) headers.set("Authorization", auth);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(this.apiUrl(path), {
        ...init,
        headers,
        ...(controller ? { signal: controller.signal } : {}),
      });
      return response;
    } catch (error) {
      if (controller?.signal.aborted) {
        throw new OpenCodeRequestError("TIMEOUT", "OpenCode did not respond in time.");
      }
      const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
      throw new OpenCodeRequestError(
        "NOT_CONNECTED",
        `Could not reach OpenCode at ${this.url}. Check the server URL, network, and that \`opencode serve\` is running.${detail}`,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private httpError(status: number, body: unknown): OpenCodeRequestError {
    if (status === 401) {
      return new OpenCodeRequestError(
        "HTTP_ERROR",
        "OpenCode rejected these credentials. Check the server password and username.",
        status,
      );
    }
    if (status === 404) {
      return new OpenCodeRequestError(
        "HTTP_ERROR",
        bodyError(body, status) === `OpenCode request failed (HTTP 404).`
          ? "OpenCode could not find this resource."
          : bodyError(body, status),
        status,
      );
    }
    return new OpenCodeRequestError("HTTP_ERROR", bodyError(body, status), status);
  }
}
