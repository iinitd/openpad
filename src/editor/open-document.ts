// Shared workspace-document loader. Extracted from FileTree so plugins can
// call it without importing a UI component (and without creating a circular
// dependency: plugins → FileTree → plugins).
//
// This is intentionally plugin-neutral: it looks at the file content, routes
// through the plugin registry to pick the right renderer (markdown vs
// lark-working-copy), and publishes the result to `editor-store` +
// `content-store`. Both plugins reuse this because their open paths are
// identical today — the difference lives in capability flags, not in the
// loader.

import { readWorkspaceTextFile, useFilesStore } from "../stores/files-store";
import { useEditorStore } from "../stores/editor-store";
import { useContentStore } from "../content/content-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { useConnectionStore } from "../stores/connection-store";
import { useSessionStore } from "../stores/session-store";
import { fileContentToHtml } from "./file-content";
// Import directly from the registry module, not from the plugins barrel, to
// break a module cycle: barrel -> lark-working-copy/plugin -> open-document
// -> barrel. During the barrel's first evaluation, the lark plugin triggers
// this file's load; if we re-entered the barrel here, previewPluginForFile
// would resolve to `undefined` and plugin dispatch would silently break for
// every file open (including the lark working copy preview).
import { previewPluginForFile } from "../plugins/registry";
import {
  resolveDocumentImages,
  resolveDocumentImagePatches,
  placeholderDocumentImages,
  hasImageMarkers,
  documentAssetPaths,
  invalidateDocumentAssetCache,
  bytesToBase64,
} from "./resolve-doc-images";
import { isNative } from "../constants/platform";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif"]);

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function extname(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

function isImagePath(path: string): boolean {
  return IMAGE_EXTS.has(extname(path));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function imageFileToHtml(path: string, dataUrl: string): string {
  const name = basename(path);
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;"><img src="${escapeHtml(dataUrl)}" alt="${escapeHtml(name)}" style="max-width:100%;height:auto;border-radius:12px;" /><div style="font-size:13px;color:#64748b;word-break:break-all;text-align:center;">${escapeHtml(name)}</div></div>`;
}

// Load a workspace file into the editor and remember it as the last-opened
// document for this cwd. Shared by the file tree, plugin `open()` entry
// points, and the auto-open-on-connect logic. Returns true on success.
export async function openWorkspaceDocument(
  cwd: string,
  path: string,
  options?: { isCurrent?: () => boolean },
): Promise<boolean> {
  const client = useConnectionStore.getState().client;
  const generation = useSessionStore.getState()._restoreGeneration;
  const contextIsCurrent = options?.isCurrent ?? (() =>
    useFilesStore.getState().cwd === cwd && useConnectionStore.getState().client === client);
  const isCurrent = () => useSessionStore.getState()._restoreGeneration === generation && contextIsCurrent();

  if (isImagePath(path)) {
    if (!client) throw new Error("Not connected to backend");
    const file = await client.readFile(cwd, path);
    if (!isCurrent()) return false;
    const mime = file.mime || "image/png";
    const base64 = await bytesToBase64(file.bytes);
    if (!isCurrent()) return false;
    const dataUrl = base64.startsWith("data:") ? base64 : `data:${mime};base64,${base64}`;
    const html = imageFileToHtml(path, dataUrl);
    useEditorStore.getState().openDocument(path, basename(path), html, false);
    useContentStore.getState().openFile(path, "markdown");
    usePreferencesStore.getState().setLastDocument(cwd, path);
    return true;
  }

  const raw = await readWorkspaceTextFile(cwd, path);
  // Reading can finish after the user switches workspaces. In that case the
  // caller's newer document owns the shared editor/content stores.
  if (!isCurrent()) return false;
  const baseHtml = fileContentToHtml(path, raw);
  // Route through the plugin registry so markdown vs. lark-working-copy
  // selection has one source of truth. The lark plugin wins when its match
  // returns a higher score (file has `destination:` frontmatter + custom
  // block ids); otherwise markdown handles anything with a known extension.
  const plugin = previewPluginForFile({ path, raw });
  const pluginId = plugin?.id ?? "markdown";
  const editable = plugin?.capabilities?.editable ?? true;
  if (!hasImageMarkers(baseHtml)) {
    useEditorStore.getState().openDocument(path, basename(path), baseHtml, editable);
    useContentStore.getState().openFile(path, pluginId);
    usePreferencesStore.getState().setLastDocument(cwd, path);
    return true;
  }
  useEditorStore
    .getState()
    .openDocument(path, basename(path), placeholderDocumentImages(baseHtml), editable);
  useContentStore.getState().openFile(path, pluginId);
  usePreferencesStore.getState().setLastDocument(cwd, path);
  // Reopening a document must never reuse an asset that changed while the
  // document was closed. Live changes are handled by useWatchOpenFile.
  invalidateDocumentAssetCache(cwd, documentAssetPaths(baseHtml));
  void (async () => {
    const resolved = isNative
      ? await resolveDocumentImagePatches(cwd, baseHtml, async (patch) => {
          if (!isCurrent()) return;
          const store = useEditorStore.getState();
          if (store.documentPath !== path) return;
          store.applyNativeAssetPatch?.(patch);
        })
      : await resolveDocumentImages(cwd, baseHtml);
    if (!isCurrent()) return;
    const store = useEditorStore.getState();
    if (store.documentPath === path) {
      if (isNative) store.setContent(resolved);
      else store.reloadContent(resolved);
    }
  })();
  return true;
}
