import type { BackendDirectory, BackendDirectoryEntry, BackendFile } from "../types";
import type { OpenCodeTransport } from "./transport";
import { asRecord, asString, OpenCodeRequestError } from "./wire";

const MAX_FILE_BYTES = 24 * 1024 * 1024;

function isAbsolute(path: string): boolean {
  return path.startsWith("/");
}

/** Normalize a POSIX path without allowing it to leave the workspace root. */
function normalizePath(cwd: string, path: string): { relative: string; absolute: string } {
  if (!cwd || !isAbsolute(cwd)) {
    throw new OpenCodeRequestError("PROTOCOL_ERROR", "OpenCode file access requires an absolute working directory.");
  }
  const root = cwd.replace(/\/+$/, "") || "/";
  const raw = isAbsolute(path) ? path : `${root}/${path}`;
  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) {
        throw new OpenCodeRequestError("PROTOCOL_ERROR", "OpenCode file paths must stay inside the working directory.");
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  const absolute = `/${parts.join("/")}`;
  if (root !== "/" && absolute !== root && !absolute.startsWith(`${root}/`)) {
    throw new OpenCodeRequestError("PROTOCOL_ERROR", "OpenCode file paths must stay inside the working directory.");
  }
  const relative = root === "/" ? absolute.slice(1) : absolute === root ? "" : absolute.slice(root.length + 1);
  return { relative, absolute };
}

function mimeKind(mime: string, path: string): BackendFile["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml" ||
    mime === "application/javascript" || mime === "application/x-yaml") return "text";
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext && ["md", "markdown", "txt", "ts", "tsx", "js", "jsx", "json", "css", "html", "xml", "yml", "yaml", "toml", "sh", "py", "go", "rs", "java", "c", "h", "cpp"].includes(ext)) {
    return "text";
  }
  return "binary";
}

export class OpenCodeFiles {
  constructor(private readonly transport: OpenCodeTransport) {}

  async listDirectory(cwd: string, path: string): Promise<BackendDirectory> {
    const target = normalizePath(cwd, path);
    // See locationQuery in sessions.ts: the native fetch layer encodes the URL
    // once, so path values are passed through unencoded.
    const params = [`location[directory]=${cwd}`];
    if (target.relative) params.push(`path=${target.relative}`);
    const response = await this.transport.requestJson<Record<string, unknown>>(`/api/fs/list?${params.join("&")}`);
    const rows = Array.isArray(response.data) ? response.data : [];
    const entries: BackendDirectoryEntry[] = [];
    for (const value of rows) {
      const row = asRecord(value);
      const rawPath = asString(row.path);
      const kind = asString(row.type) === "directory" ? "directory" : "file";
      if (!rawPath) continue;
      const childPath = rawPath.replace(/\/+$/, "");
      const name = childPath.split("/").filter(Boolean).pop();
      if (!name) continue;
      entries.push({ name, path: childPath, kind, size: 0 });
    }
    return { path: target.relative, entries };
  }

  async readFile(cwd: string, path: string): Promise<BackendFile> {
    const target = normalizePath(cwd, path);
    if (!target.relative) {
      throw new OpenCodeRequestError("PROTOCOL_ERROR", "OpenCode file reads require a file path.");
    }
    const params = `location[directory]=${cwd}`;
    const result = await this.transport.requestBytes(`/api/fs/read/${target.relative}?${params}`);
    if (result.bytes.length > MAX_FILE_BYTES) {
      throw new OpenCodeRequestError("PROTOCOL_ERROR", "OpenCode file exceeds the 24 MiB preview limit.");
    }
    return {
      bytes: result.bytes,
      mime: result.mime,
      size: result.bytes.length,
      path: target.relative,
      kind: mimeKind(result.mime, target.relative),
      modifiedAt: result.modifiedAt ?? new Date().toISOString(),
    };
  }
}
