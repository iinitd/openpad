// Resolve document image/whiteboard references into inline data URIs so the
// editor can actually render them.
//
// The document is the single source of truth: every embedded asset records its
// own workspace-relative path in the tag (e.g.
// `<img src="assets/doc-media/foo.jpg">`, `<whiteboard src="diagrams/x.svg">`).
// `file-content.ts` rewrites those into a marker form —
// `<img src="kel-file:<relative-path>" ...>` — and this module turns each marker
// into a `data:` URI by reading that exact path through the daemon. The app
// therefore does NOT depend on any directory layout, filename convention, or
// external index: whatever path the document states is what gets loaded. A path
// that can't be read degrades to a small text placeholder so nothing overflows.
//
// Resolution is async (it reads files over the relay) and cached, so the 2s
// open-file poll doesn't re-encode the same assets on every tick.

import { useConnectionStore } from "../stores/connection-store";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

// `${cwd}::${path}` -> resolved asset. Only successful resolutions are cached,
// so a missing/failed asset is retried on the next poll (e.g. once a whiteboard
// is exported into the workspace after the doc first opened).
const assetCache = new Map<string, ResolvedAsset>();

export function clearDocumentAssetCache(): void {
  assetCache.clear();
}

export function invalidateDocumentAssetCache(cwd: string, paths: string[]): void {
  for (const rawPath of paths) assetCache.delete(`${cwd}::${normalizePath(rawPath)}`);
}

export function invalidateAllDocumentAssets(cwd: string): void {
  const prefix = `${cwd}::`;
  for (const key of assetCache.keys()) if (key.startsWith(prefix)) assetCache.delete(key);
}

interface ResolvedAsset {
  uri: string;
  // Intrinsic pixel size, when we can determine it. SVGs frequently ship with
  // only a viewBox and no width/height, so as an <img> they have no intrinsic
  // size and collapse to ~0px; we recover dimensions from the viewBox so the
  // image scales correctly on both web and the native WebView.
  width?: number;
  height?: number;
}

export interface DocumentAssetPatch {
  path: string;
  html: string;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// ~196KB of source bytes encoded between event-loop yields. Big enough that the
// per-chunk overhead is negligible, small enough that a multi-MB image never
// blocks the JS thread long enough to drop a frame / stall touch handling.
const ENCODE_CHUNK_BYTES = 65_535 * 3;

// Encode raw bytes to base64 without relying on btoa/Buffer (neither is
// guaranteed on Hermes). Straightforward 3-byte → 4-char transform, but async
// and chunked: after every ~196KB we `await setTimeout(0)` to hand the JS
// thread back to the UI. A 5MB image is otherwise ~1.7M loop iterations that
// would run in a single synchronous burst and freeze tab switches / the file
// drawer while a big document opens. Concatenation is bounded per chunk (then
// joined once) so we never grow one multi-MB string via repeated `+=`.
export async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  const len = bytes.length;
  const fullTriplets = Math.floor(len / 3) * 3;
  const chunks: string[] = [];
  let out = "";
  let sinceYield = 0;
  let i = 0;
  for (; i < fullTriplets; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    sinceYield += 3;
    if (sinceYield >= ENCODE_CHUNK_BYTES) {
      chunks.push(out);
      out = "";
      sinceYield = 0;
      // Macrotask yield so pending touches / timers get a turn between chunks.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  const rem = len - fullTriplets;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + "==";
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + "=";
  }
  chunks.push(out);
  return chunks.join("");
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

// Normalize a document-supplied relative path: strip a leading "./" and any
// leading slashes so it's always workspace-relative for the daemon.
function normalizePath(p: string): string {
  return p.replace(/^\.\//, "").replace(/^\/+/, "");
}

// Read the exact workspace-relative path the document states and inline it.
async function resolveAsset(cwd: string, rawPath: string): Promise<ResolvedAsset | null> {
  const path = normalizePath(rawPath);
  const cacheKey = `${cwd}::${path}`;
  const hit = assetCache.get(cacheKey);
  if (hit) return hit;

  const client = useConnectionStore.getState().client;
  if (!client) return null;

  try {
    const { bytes } = await client.readFile(cwd, path);
    const ext = extOf(path);
    const mime = MIME_BY_EXT[ext] ?? "image/png";
    const asset: ResolvedAsset = {
      uri: `data:${mime};base64,${await bytesToBase64(bytes)}`,
    };
    if (ext === "svg") {
      // Pull an intrinsic size from width/height or the viewBox so an <img>
      // that would otherwise collapse to 0px renders at a sensible size.
      const dims = svgDimensions(bytes);
      if (dims) {
        asset.width = dims.width;
        asset.height = dims.height;
      }
    }
    if (useConnectionStore.getState().client !== client) return null;
    assetCache.set(cacheKey, asset);
    return asset;
  } catch {
    return null; // Missing or transient read failure: don't cache, retry later.
  }
}

// Decode a small prefix of an SVG's bytes and read its intrinsic size. Prefers
// explicit width/height (px), else derives it from the viewBox. Returns null
// when nothing usable is found.
function svgDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // The <svg …> open tag is at the very start; decode ~1KB of ASCII/UTF-8.
  let head = "";
  const n = Math.min(bytes.length, 1024);
  for (let i = 0; i < n; i++) head += String.fromCharCode(bytes[i]!);
  const openTag = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (!openTag) return null;
  const numAttr = (name: string): number | null => {
    const m = new RegExp(`\\b${name}="([0-9.]+)`, "i").exec(openTag);
    return m ? parseFloat(m[1]!) : null;
  };
  const w = numAttr("width");
  const h = numAttr("height");
  if (w && h) return { width: w, height: h };
  const vb = /\bviewBox="([\d.\s,-]+)"/i.exec(openTag)?.[1];
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2]! > 0 && parts[3]! > 0) {
      return { width: parts[2]!, height: parts[3]! };
    }
  }
  return null;
}

// Matches the marker `file-content.ts` emits for a document-declared asset path.
const MARKER_RE = /<img\b[^>]*?\bsrc="kel-file:([^"]+)"[^>]*?>/gi;

export function documentAssetPaths(html: string): string[] {
  return Array.from(
    new Set([...html.matchAll(MARKER_RE)].map((match) => normalizePath(match[1]!))),
  );
}

function attrOf(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag);
  return m?.[1] ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// True when `html` still carries at least one unresolved asset marker. Lets the
// open path decide whether a second, image-resolving pass is even needed.
export function hasImageMarkers(html: string): boolean {
  MARKER_RE.lastIndex = 0;
  return MARKER_RE.test(html);
}

// Cheap synchronous pass: turn every `kel-file:` marker into a lightweight
// placeholder box (no file reads, no base64) so the document text can render
// instantly and the UI stays responsive. The real assets are inlined later by
// `resolveDocumentImages`. Placeholders reserve visible space and name the kind
// so a long document doesn't reflow jarringly when images pop in.
export function placeholderDocumentImages(html: string): string {
  return html.replace(MARKER_RE, (tag, path: string) => {
    const alt = attrOf(tag, "alt") || "image";
    const kind = alt === "whiteboard" ? "whiteboard" : "image";
    const badge = kind === "whiteboard" ? "board" : "image";
    return `<span class="kel-media kel-media-loading" data-kind="${kind}" data-format="${badge}" data-kel-src="${path}">${
      kind === "whiteboard" ? "board" : "image"
    }…</span>`;
  });
}

function replacementHtmlForTag(tag: string, path: string, asset: ResolvedAsset | null): string {
  const alt = attrOf(tag, "alt") || "image";
  const kind = alt === "whiteboard" ? "whiteboard" : "image";
  if (!asset) {
    const label = kind === "whiteboard" ? "whiteboard" : alt;
    return `<p><em>🖼️ [${label}]</em></p>`;
  }
  const badge = kind === "whiteboard" ? "board" : "image";
  const sizeAttr =
    asset.width && asset.height
      ? ` width="${asset.width}" height="${asset.height}"`
      : "";
  const img =
    `<img src="${asset.uri}" alt="${alt}"${sizeAttr} data-kind="${kind}" data-format="${badge}" data-kel-src="${path}" />`;
  return `<span class="kel-media" data-kind="${kind}" data-format="${badge}" data-kel-src="${path}">${img}</span>`;
}

export function applyResolvedDocumentAssetPatch(
  html: string,
  path: string,
  replacementHtml: string,
): string {
  const normalized = normalizePath(path);
  const marker = new RegExp(
    `<img\\b[^>]*\\bsrc="kel-file:${escapeRegExp(normalized)}"[^>]*?>`,
    "gi",
  );
  if (marker.test(html)) {
    marker.lastIndex = 0;
    return html.replace(marker, replacementHtml);
  }
  const placeholder = new RegExp(
    `<span class="kel-media kel-media-loading"[^>]*data-kel-src="${escapeRegExp(normalized)}"[^>]*>[\\s\\S]*?<\\/span>`,
    "gi",
  );
  if (placeholder.test(html)) {
    placeholder.lastIndex = 0;
    return html.replace(placeholder, replacementHtml);
  }
  return html;
}

export async function resolveDocumentImagePatches(
  cwd: string | null,
  html: string,
  onPatch: (patch: DocumentAssetPatch) => void | Promise<void>,
): Promise<string> {
  if (!cwd) return html;
  const matches = [...html.matchAll(MARKER_RE)];
  if (matches.length === 0) return html;

  let nextHtml = html;
  const seen = new Set<string>();
  for (const match of matches) {
    const tag = match[0]!;
    const path = normalizePath(match[1]!);
    if (seen.has(path)) continue;
    seen.add(path);
    const asset = await resolveAsset(cwd, path);
    const replacement = replacementHtmlForTag(tag, path, asset);
    nextHtml = applyResolvedDocumentAssetPatch(nextHtml, path, replacement);
    await onPatch({ path, html: replacement });
  }
  return nextHtml;
}

// Replace every `kel-file:` marker in `html` with an inline data URI, or a text
// placeholder when the file can't be read. Each resolved asset is wrapped in a
// <span.kel-media> that carries a corner badge (data-kind marks whiteboards) so
// the reader can tell a real picture apart from an exported whiteboard. Returns
// the html unchanged when there are no markers.
export async function resolveDocumentImages(
  cwd: string | null,
  html: string,
): Promise<string> {
  if (!cwd) return html;
  const matches = [...html.matchAll(MARKER_RE)];
  if (matches.length === 0) return html;

  const paths = Array.from(new Set(matches.map((m) => m[1]!)));
  const resolved = new Map<string, ResolvedAsset | null>();
  await Promise.all(
    paths.map(async (p) => {
      resolved.set(p, await resolveAsset(cwd, p));
    }),
  );

  return html.replace(MARKER_RE, (tag, path: string) => {
    return replacementHtmlForTag(tag, path, resolved.get(path) ?? null);
  });
}
