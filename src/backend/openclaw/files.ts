import type { BackendDirectory, BackendDirectoryEntry, BackendFile } from "../types";
import type { OpenClawTransport } from "./transport";
import { asNumber, asRecord, asString, isRecord, OpenClawRpcError } from "./wire";

/** root identifies the scope; session file RPCs confirm the actual browser root. */
export interface OpenClawFileScope {
  agentId: string;
  sessionKey?: string;
  root: string;
}

const MAX_FILE_BYTES = 24 * 1024 * 1024;
const LIST_LIMIT = 500;
const MAX_DIRECTORY_ENTRIES = 100_000;
const DOWNLOAD_PATH = "/api/artifacts/download/";
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const EPOCH = "1970-01-01T00:00:00.000Z";

function fail(code: string, message: string): never {
  throw new OpenClawRpcError(code, message);
}

function relativePath(value: string): string {
  const portable = value.replace(/\\/g, "/");
  if (/[\u0000-\u001f\u007f]/.test(portable) || portable.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(portable)) {
    return fail("FILE_PATH_INVALID", "OpenClaw file paths must stay inside the selected working directory.");
  }
  const parts: string[] = [];
  for (const part of portable.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return fail("FILE_PATH_INVALID", "OpenClaw file path escapes the selected working directory.");
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function absolutePath(value: string): string {
  const portable = value.replace(/\\/g, "/");
  const drive = /^[A-Za-z]:\//.exec(portable)?.[0];
  if (portable.startsWith("//") || (!drive && !portable.startsWith("/"))) {
    return fail("FILE_SCOPE_INVALID", "OpenClaw did not provide an absolute local file root.");
  }
  const prefix = drive ? `${drive[0].toUpperCase()}:/` : "/";
  return prefix + relativePath(portable.slice(drive ? 3 : 1));
}

function insideRelative(root: string, value: string): string {
  if (value === root) return "";
  const prefix = root.endsWith("/") ? root : `${root}/`;
  if (!value.startsWith(prefix)) return fail("FILE_SCOPE_INVALID", "OpenClaw file path is outside the resolved workspace root.");
  return value.slice(prefix.length);
}

function joined(base: string, path: string): string {
  return base ? path ? `${base.replace(/\/$/, "")}/${path}` : base : path;
}

function localPath(cwd: string, path: string): string {
  const portable = path.replace(/\\/g, "/");
  if (portable.startsWith("/") || /^[A-Za-z]:\//.test(portable)) {
    try { return insideRelative(cwd, absolutePath(path)); }
    catch { return fail("FILE_PATH_INVALID", "OpenClaw file path is outside the selected working directory."); }
  }
  return relativePath(path);
}

function integer(value: unknown, label: string): number {
  const number = asNumber(value);
  if (number === undefined || !Number.isSafeInteger(number) || number < 0) {
    return fail("PROTOCOL_ERROR", `OpenClaw returned invalid ${label}.`);
  }
  return number;
}

function modifiedAt(value: unknown): string {
  const time = asNumber(value);
  if (time === undefined) return EPOCH;
  const date = new Date(time);
  return Number.isFinite(date.getTime()) && time >= 0 ? date.toISOString() : EPOCH;
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript",
  json: "application/json", map: "application/json", xml: "application/xml", svg: "image/svg+xml",
  md: "text/markdown", markdown: "text/markdown", txt: "text/plain", csv: "text/csv",
  ts: "text/plain", tsx: "text/plain", jsx: "text/javascript", yaml: "text/plain", yml: "text/plain",
  toml: "text/plain", ini: "text/plain", log: "text/plain", sh: "text/plain", py: "text/plain",
  go: "text/plain", rs: "text/plain", c: "text/plain", h: "text/plain", cpp: "text/plain",
  java: "text/plain", sql: "text/plain", tex: "text/plain", env: "text/plain",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", ico: "image/x-icon", bmp: "image/bmp", heic: "image/heic", heif: "image/heif",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", mp4: "video/mp4", webm: "video/webm",
  pdf: "application/pdf", wasm: "application/wasm",
};

function mimeFor(path: string, wireMime?: string): string {
  const inferred = MIME_BY_EXTENSION[path.split(".").pop()?.toLowerCase() ?? ""];
  return wireMime && !["text/plain", "application/octet-stream"].includes(wireMime.toLowerCase())
    ? wireMime : inferred ?? wireMime ?? "application/octet-stream";
}

function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || /(?:json|xml|javascript|yaml)(?:;|$)/.test(mime) || mime === "image/svg+xml";
}

/** Standard padded base64 without Node's Buffer or browser-only atob. */
function decodeBase64(value: string): Uint8Array {
  if (value.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
      value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value) || !/^[^=]*={0,2}$/.test(value)) {
    return fail("PROTOCOL_ERROR", "OpenClaw returned invalid or oversized base64 file content.");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array(value.length / 4 * 3 - padding);
  let index = 0;
  for (let i = 0; i < value.length; i += 4) {
    const a = BASE64.indexOf(value[i]); const b = BASE64.indexOf(value[i + 1]);
    const c = value[i + 2] === "=" ? 0 : BASE64.indexOf(value[i + 2]);
    const d = value[i + 3] === "=" ? 0 : BASE64.indexOf(value[i + 3]);
    bytes[index++] = (a << 2) | (b >> 4);
    if (index < bytes.length) bytes[index++] = (b << 4) | (c >> 2);
    if (index < bytes.length) bytes[index++] = (c << 6) | d;
    if (i + 4 === value.length && ((padding === 2 && (b & 15)) || (padding === 1 && (c & 3)))) {
      return fail("PROTOCOL_ERROR", "OpenClaw returned noncanonical base64 file content.");
    }
  }
  return bytes;
}

type FileTarget = {
  scope: OpenClawFileScope;
  root: string;
  path: string;
  browserPath: string;
  rootListing?: Record<string, unknown>;
};

/** Read-only official file RPCs. Never fall back to running an agent or shell command. */
export class OpenClawFiles {
  constructor(private readonly transport: OpenClawTransport,
    private readonly resolveScope: (cwd: string) => Promise<OpenClawFileScope>) {}

  private requireMethod(method: string): void {
    if (!this.transport.hasMethod(method)) {
      fail("METHOD_UNAVAILABLE", `This OpenClaw gateway does not advertise ${method}; file access requires that method.`);
    }
  }

  private sessionParams(scope: OpenClawFileScope, path: string): Record<string, unknown> {
    return { sessionKey: scope.sessionKey, agentId: scope.agentId, path };
  }

  private confirmSession(result: Record<string, unknown>, target: Pick<FileTarget, "scope">): void {
    if (result.sessionKey !== target.scope.sessionKey) {
      fail("PROTOCOL_ERROR", "OpenClaw file response belongs to a different session.");
    }
  }

  private async target(cwd: string, path: string): Promise<FileTarget> {
    const normalizedCwd = absolutePath(cwd);
    const normalizedPath = localPath(normalizedCwd, path);
    const scope = await this.resolveScope(cwd);
    if (!scope.agentId || !scope.root || (scope.sessionKey !== undefined && !scope.sessionKey)) {
      return fail("FILE_SCOPE_INVALID", "OpenClaw could not resolve an agent and workspace for file access.");
    }
    let root = absolutePath(scope.root);
    // The session browser is rooted at sessionRoot; get also considers spawnedCwd.
    // Discover root here rather than assuming that the resolver's cwd is that root.
    let rootListing: Record<string, unknown> | undefined;
    if (scope.sessionKey) {
      this.requireMethod("sessions.files.list");
      rootListing = asRecord(await this.transport.request("sessions.files.list", this.sessionParams(scope, "")));
      this.confirmSession(rootListing, { scope });
      const serverRoot = asString(rootListing.root);
      if (!serverRoot || !isRecord(rootListing.browser)) {
        return fail("FILE_SCOPE_UNAVAILABLE", "OpenClaw did not expose a session workspace file root and browser.");
      }
      root = absolutePath(serverRoot);
      if (rootListing.browser.path !== "") return fail("PROTOCOL_ERROR", "OpenClaw returned a different session root directory.");
    }
    const prefix = insideRelative(root, normalizedCwd);
    return { scope, root, path: normalizedPath,
      browserPath: joined(prefix, normalizedPath), rootListing };
  }

  private directoryEntries(raw: unknown, target: FileTarget): BackendDirectoryEntry[] {
    if (!Array.isArray(raw)) return fail("PROTOCOL_ERROR", "OpenClaw directory response has no entries.");
    return raw.map((value) => {
      if (!isRecord(value) || typeof value.name !== "string" || !value.name || /[\\/]/.test(value.name) ||
          value.name === "." || value.name === ".." || (value.kind !== "file" && value.kind !== "directory") ||
          typeof value.path !== "string") {
        return fail("PROTOCOL_ERROR", "OpenClaw returned an invalid directory entry.");
      }
      const browserPath = relativePath(value.path);
      if (browserPath !== joined(target.browserPath, value.name)) {
        return fail("PROTOCOL_ERROR", "OpenClaw returned a file outside the requested directory.");
      }
      return { name: value.name, path: joined(target.path, value.name), kind: value.kind,
        size: value.size === undefined ? 0 : integer(value.size, "file size"),
        ...(value.updatedAtMs === undefined ? {} : { modifiedAt: modifiedAt(value.updatedAtMs) }) };
    });
  }

  async listDirectory(cwd: string, path: string): Promise<BackendDirectory> {
    const target = await this.target(cwd, path);
    if (target.scope.sessionKey) {
      const result = !target.browserPath ? target.rootListing! : asRecord(await this.transport.request(
        "sessions.files.list", this.sessionParams(target.scope, target.browserPath)));
      this.confirmSession(result, target);
      if (asString(result.root) === undefined || absolutePath(String(result.root)) !== target.root) {
        return fail("FILE_SCOPE_CHANGED", "OpenClaw session workspace changed while listing files; retry.");
      }
      const browser = asRecord(result.browser);
      if (browser.path !== target.browserPath) return fail("FILE_NOT_FOUND", "OpenClaw did not return the requested session directory.");
      if (browser.truncated === true || browser.hasMore === true) {
        return fail("DIRECTORY_INCOMPLETE", "OpenClaw truncated this session directory. Its session file API cannot paginate a complete listing.");
      }
      return { path: target.path, entries: this.directoryEntries(browser.entries, target) };
    }
    this.requireMethod("agents.workspace.list");
    const entries: BackendDirectoryEntry[] = [];
    const seen = new Set<string>();
    let offset = 0;
    let expectedTotal: number | undefined;
    for (;;) {
      const result = asRecord(await this.transport.request("agents.workspace.list", {
        agentId: target.scope.agentId, path: target.browserPath, offset, limit: LIST_LIMIT,
      }));
      if (result.agentId !== target.scope.agentId || result.path !== target.browserPath || integer(result.offset, "directory offset") !== offset) {
        return fail("PROTOCOL_ERROR", "OpenClaw returned a different workspace directory or page.");
      }
      const total = integer(result.totalEntries, "directory entry count");
      if (total > MAX_DIRECTORY_ENTRIES) return fail("DIRECTORY_TOO_LARGE", "OpenClaw directory exceeds the supported 100,000 entries.");
      if (expectedTotal !== undefined && total !== expectedTotal) return fail("DIRECTORY_CHANGED", "OpenClaw directory changed during pagination; retry.");
      expectedTotal = total;
      const page = this.directoryEntries(result.entries, target);
      if (offset + page.length > total) return fail("PROTOCOL_ERROR", "OpenClaw directory page exceeds its total entry count.");
      for (const entry of page) {
        if (seen.has(entry.path)) return fail("DIRECTORY_CHANGED", "OpenClaw repeated a file during pagination; retry.");
        seen.add(entry.path); entries.push(entry);
      }
      offset += page.length;
      if (offset === total && result.hasMore !== true) break;
      if (!page.length || offset === total) return fail("DIRECTORY_INCOMPLETE", "OpenClaw directory pagination did not produce a complete listing.");
    }
    return { path: target.path, entries };
  }

  private confirmFilePath(file: Record<string, unknown>, target: FileTarget): void {
    const value = asString(file.workspacePath) ?? asString(file.path);
    if (value === undefined) return fail("PROTOCOL_ERROR", "OpenClaw returned no file path.");
    const portable = value.replace(/\\/g, "/");
    const browserPath = portable.startsWith("/") || /^[A-Za-z]:\//.test(portable)
      ? insideRelative(target.root, absolutePath(value)) : relativePath(value);
    if (browserPath !== target.browserPath) return fail("PROTOCOL_ERROR", "OpenClaw returned a different workspace file.");
  }

  async readFile(cwd: string, path: string): Promise<BackendFile> {
    const target = await this.target(cwd, path);
    if (!target.path) return fail("FILE_PATH_INVALID", "OpenClaw file reads require a file path.");
    const session = Boolean(target.scope.sessionKey);
    const method = session ? "sessions.files.get" : "agents.workspace.get";
    this.requireMethod(method);
    // Absolute in-root paths avoid get's fileRoot-first lookup selecting a shadow
    // file when spawnedCwd is a subdirectory of the browser root.
    const params = session ? this.sessionParams(target.scope, joined(target.root, target.browserPath))
      : { agentId: target.scope.agentId, path: target.browserPath };
    let result: Record<string, unknown>;
    try { result = asRecord(await this.transport.request(method, params)); }
    catch (error) {
      const details = error instanceof OpenClawRpcError ? asRecord(error.details) : {};
      if (session && details.type === "session_file_too_large") {
        const size = details.size === undefined ? undefined : integer(details.size, "file size");
        return this.download(target, params, undefined, size);
      }
      throw error;
    }
    if (session) {
      this.confirmSession(result, target);
      if (typeof result.root !== "string" || absolutePath(result.root) !== target.root) {
        return fail("FILE_SCOPE_CHANGED", "OpenClaw session workspace changed while reading a file; retry.");
      }
    } else if (result.agentId !== target.scope.agentId) return fail("PROTOCOL_ERROR", "OpenClaw returned a file for a different agent.");
    const file = asRecord(result.file);
    if (file.missing === true) return fail("FILE_NOT_FOUND", "OpenClaw workspace file was not found.");
    this.confirmFilePath(file, target);
    const size = integer(file.size, "file size");
    if (size > MAX_FILE_BYTES) return fail("FILE_TOO_LARGE", "OpenClaw file exceeds the 24 MiB preview limit.");
    const content = asString(file.content);
    if (content === undefined && session) return this.download(target, params, file, size);
    if (content === undefined) return fail("PROTOCOL_ERROR", "OpenClaw returned no file content.");
    const encoding = session ? file.contentEncoding : file.encoding;
    if (encoding !== "base64" && encoding !== "utf8") return fail("PROTOCOL_ERROR", "OpenClaw returned an unsupported file encoding.");
    if (content.length > MAX_FILE_BYTES * (encoding === "base64" ? 4 / 3 : 1)) return fail("FILE_TOO_LARGE", "OpenClaw file exceeds the 24 MiB preview limit.");
    const bytes = encoding === "base64" ? decodeBase64(content) : new TextEncoder().encode(content);
    if (bytes.length !== size) return fail("PROTOCOL_ERROR", "OpenClaw returned incomplete file bytes.");
    const mime = mimeFor(target.path, asString(file.mimeType));
    return { bytes, mime, size, path: target.path, kind: encoding === "utf8" ? "text" : mime.startsWith("image/") ? "image" : "binary",
      modifiedAt: modifiedAt(file.updatedAtMs) };
  }

  private downloadUrl(raw: string): string {
    if (raw.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(raw)) return fail("DOWNLOAD_URL_INVALID", "OpenClaw returned an invalid file download URL.");
    const gateway = new URL(this.transport.url);
    gateway.protocol = gateway.protocol === "wss:" ? "https:" : "http:";
    let url: URL;
    try { url = new URL(raw, gateway); }
    catch { return fail("DOWNLOAD_URL_INVALID", "OpenClaw returned an invalid file download URL."); }
    const base = gateway.pathname === "/" ? "" : gateway.pathname.replace(/\/$/, "");
    const routes = [DOWNLOAD_PATH, `${base}${DOWNLOAD_PATH}`];
    const route = routes.find((prefix) => url.pathname.startsWith(prefix));
    const locator = route ? url.pathname.slice(route.length) : "";
    const [connection, ticket, extra] = locator.split("/");
    if (url.origin !== gateway.origin || url.username || url.password || url.search || url.hash ||
        !route || !connection || !/^[A-Za-z0-9_-]{43}$/.test(ticket ?? "") || extra !== undefined ||
        /%(?:2e|2f|5c)/i.test(connection) || connection === "." || connection === ".." ||
        /[^A-Za-z0-9._~%:-]/.test(connection)) {
      return fail("DOWNLOAD_URL_INVALID", "OpenClaw file download must use a grant on the connected gateway's artifact download route.");
    }
    return url.toString();
  }

  private async download(target: FileTarget, params: Record<string, unknown>, file?: Record<string, unknown>, expectedSize?: number): Promise<BackendFile> {
    if (expectedSize !== undefined && expectedSize > MAX_FILE_BYTES) return fail("FILE_TOO_LARGE", "OpenClaw file exceeds the 24 MiB preview limit.");
    this.requireMethod("sessions.files.download");
    const grant = asRecord(await this.transport.request("sessions.files.download", params));
    const rawUrl = asString(grant.url);
    const expiresAt = asString(grant.expiresAt);
    if (!rawUrl || !asString(grant.filename) || !asString(grant.mimeType) || !expiresAt || !Number.isFinite(Date.parse(expiresAt))) {
      return fail("PROTOCOL_ERROR", "OpenClaw returned an invalid session file download grant.");
    }
    if (Date.parse(expiresAt) <= Date.now()) return fail("DOWNLOAD_EXPIRED", "OpenClaw file download grant expired; retry.");
    const url = this.downloadUrl(rawUrl);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 30_000);
    try {
      // The connection-bound grant is the authorization. Do not forward device,
      // operator or browser credentials, including across an HTTP redirect.
      const response = await fetch(url, { credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal });
      if (response.status !== 200 || response.redirected) return fail("DOWNLOAD_FAILED", `OpenClaw file download failed (HTTP ${response.status}); retry if the connection or grant expired.`);
      if (response.url && this.downloadUrl(response.url) !== url) return fail("DOWNLOAD_URL_INVALID", "OpenClaw file download changed its grant URL.");
      const length = response.headers.get("content-length");
      const advertisedSize = length === null ? undefined : /^\d+$/.test(length) ? Number(length) : NaN;
      if (advertisedSize !== undefined && (!Number.isSafeInteger(advertisedSize) || advertisedSize > MAX_FILE_BYTES)) {
        controller.abort(); return fail("FILE_TOO_LARGE", "OpenClaw file download exceeds the 24 MiB preview limit.");
      }
      if (expectedSize !== undefined && advertisedSize !== undefined && advertisedSize !== expectedSize) {
        controller.abort(); return fail("FILE_CHANGED", "OpenClaw file size changed before downloading; retry.");
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.byteLength;
            if (size > MAX_FILE_BYTES) { controller.abort(); return fail("FILE_TOO_LARGE", "OpenClaw file download exceeds the 24 MiB preview limit."); }
            chunks.push(next.value);
          }
        } finally { reader.releaseLock(); }
      } else {
        // Native fetch may not expose a stream. Require a bounded declared size
        // before its arrayBuffer allocation; the official route sends this header.
        if (advertisedSize === undefined) { controller.abort(); return fail("DOWNLOAD_UNBOUNDED", "OpenClaw file download needs Content-Length on this platform."); }
        const bytes = new Uint8Array(await response.arrayBuffer());
        size = bytes.length; chunks.push(bytes);
      }
      if (size > MAX_FILE_BYTES || (advertisedSize !== undefined && size !== advertisedSize) ||
          (expectedSize !== undefined && size !== expectedSize)) return fail("DOWNLOAD_INCOMPLETE", "OpenClaw file download returned incomplete or changed bytes; retry.");
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const mime = mimeFor(target.path, asString(file?.mimeType) ?? asString(grant.mimeType));
      return { bytes, mime, size, path: target.path, kind: isTextMime(mime) ? "text" : mime.startsWith("image/") ? "image" : "binary",
        modifiedAt: file ? modifiedAt(file.updatedAtMs) : EPOCH };
    } catch (error) {
      if (error instanceof OpenClawRpcError) throw error;
      return fail("DOWNLOAD_FAILED", controller.signal.aborted ? "OpenClaw file download timed out or exceeded its size limit." :
        "OpenClaw file download failed. Browsers cannot read cross-origin downloads from gateways without CORS support; serve Puff and the gateway through the same origin. Also check gateway HTTP access and retry.");
    } finally { clearTimeout(deadline); }
  }
}
