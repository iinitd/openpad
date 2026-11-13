import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../stores/editor-store";
import { useFilesStore, readWorkspaceTextFile } from "../stores/files-store";
import { useConnectionStore } from "../stores/connection-store";
import { fileContentToHtml } from "./file-content";
import {
  documentAssetPaths,
  hasImageMarkers,
  invalidateDocumentAssetCache,
  placeholderDocumentImages,
  resolveDocumentImages,
  resolveDocumentImagePatches,
} from "./resolve-doc-images";
import { diffChangedBlockSignatures } from "./block-diff";
import { isNative } from "../constants/platform";
import { startVisibilityAwarePoller } from "../utils/visibility-poller";

const POLL_INTERVAL_MS = 2000;
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif"]);

function isImagePath(path: string | null): boolean {
  if (!path) return false;
  const dot = path.lastIndexOf(".");
  return dot >= 0 && IMAGE_EXTS.has(path.slice(dot).toLowerCase());
}

/**
 * Watch the currently-open workspace file for on-disk changes (the agent edits
 * files directly). We poll `readFile` and compare content; when it changes we
 * reload the editor and return a `flashKey` the editor can use to play a brief
 * "this was just edited" animation.
 *
 * Polling is used because the daemon exposes no push-based fs-watch API. The
 * open document is a single small file, so a 2s poll is cheap.
 */
export function useWatchOpenFile(): number {
  const documentPath = useEditorStore((s) => s.documentPath);
  const cwd = useFilesStore((s) => s.cwd);
  const connected = useConnectionStore((s) => s.connectionState.status === "connected");

  const [flashKey, setFlashKey] = useState(0);
  const lastContentRef = useRef<string | null>(null);
  const assetSignaturesRef = useRef<Map<string, string>>(new Map());

  // Reset the baseline whenever the open file changes, so opening a file (which
  // itself is a "change") doesn't trigger a spurious flash. The first poll after
  // this re-establishes the baseline.
  useEffect(() => {
    lastContentRef.current = null;
    assetSignaturesRef.current = new Map();
  }, [cwd, documentPath]);

  useEffect(() => {
    if (!connected || !cwd || !documentPath || isImagePath(documentPath)) return;
    const watchedCwd = cwd;
    const watchedDocumentPath = documentPath;

    let cancelled = false;

    const isCurrentWatch = () =>
      !cancelled &&
      useFilesStore.getState().cwd === watchedCwd &&
      useEditorStore.getState().documentPath === watchedDocumentPath;

    async function assetSignatures(paths: string[]): Promise<Map<string, string>> {
      const client = useConnectionStore.getState().client;
      const signatures = new Map<string, string>();
      if (!client || paths.length === 0) return signatures;
      const byDirectory = new Map<string, Set<string>>();
      for (const path of paths) {
        const slash = path.lastIndexOf("/");
        const directory = slash >= 0 ? path.slice(0, slash) : "";
        const name = slash >= 0 ? path.slice(slash + 1) : path;
        const names = byDirectory.get(directory) ?? new Set<string>();
        names.add(name);
        byDirectory.set(directory, names);
      }
      await Promise.all([...byDirectory.entries()].map(async ([directory, names]) => {
        try {
          const listing = await client.listDirectory(watchedCwd, directory);
          for (const entry of listing.entries) {
            if (entry.kind !== "file" || !names.has(entry.name)) continue;
            const path = directory ? `${directory}/${entry.name}` : entry.name;
            signatures.set(path, `${entry.modifiedAt}:${entry.size}`);
          }
        } catch {
          // Missing/transient directories are represented as absent signatures;
          // when they appear later the signature change triggers a reload.
        }
      }));
      return signatures;
    }

    function changedAssetPaths(previous: Map<string, string>, next: Map<string, string>): string[] {
      const paths = new Set([...previous.keys(), ...next.keys()]);
      return [...paths].filter((path) => previous.get(path) !== next.get(path));
    }

    async function reload(raw: string, changedAssets: string[] = []) {
      if (changedAssets.length > 0) invalidateDocumentAssetCache(watchedCwd, changedAssets);
      const baseHtml = fileContentToHtml(watchedDocumentPath, raw);
      const editor = useEditorStore.getState();
      const baseline = editor.reviseBaseline;

      const applyReload = (html: string) => {
        if (!isCurrentWatch()) return false;
        const store = useEditorStore.getState();
        if (baseline && baseline.documentPath === watchedDocumentPath && changedAssets.length === 0) {
          const changed = diffChangedBlockSignatures(baseline.html, html);
          store.reloadContent(html);
          store.setChangedBlockSigs(changed);
          return true;
        }
        store.reloadContent(html);
        return true;
      };

      if (!hasImageMarkers(baseHtml)) {
        if (applyReload(baseHtml)) setFlashKey((key) => key + 1);
        return;
      }

      // Match the open-file path: show updated document text immediately, then
      // stream the heavier asset resolution behind it so agent edits feel live.
      if (!applyReload(placeholderDocumentImages(baseHtml))) return;
      setFlashKey((key) => key + 1);

      const html = isNative
        ? await resolveDocumentImagePatches(watchedCwd, baseHtml, async (patch) => {
            const store = useEditorStore.getState();
            if (!isCurrentWatch()) return;
            await store.applyNativeAssetPatch?.(patch);
          })
        : await resolveDocumentImages(watchedCwd, baseHtml);
      if (!isCurrentWatch()) return;
      const store = useEditorStore.getState();
      if (isNative) {
        // Native already patched the live WebView incrementally above; keep the
        // store's canonical HTML in sync without forcing a second reload.
        store.setContent(html);
      } else {
        applyReload(html);
      }
    }

    async function poll() {
      if (cancelled) return;
      try {
        const raw = await readWorkspaceTextFile(watchedCwd, watchedDocumentPath);
        if (cancelled) return;
        const unresolvedHtml = fileContentToHtml(watchedDocumentPath, raw);
        const paths = documentAssetPaths(unresolvedHtml);
        const nextSignatures = await assetSignatures(paths);
        if (cancelled) return;
        if (lastContentRef.current === null) {
          // First read after (re)opening: establish baseline, no flash.
          lastContentRef.current = raw;
          assetSignaturesRef.current = nextSignatures;
          return;
        }
        if (raw !== lastContentRef.current) {
          lastContentRef.current = raw;
          const changedAssets = changedAssetPaths(assetSignaturesRef.current, nextSignatures);
          assetSignaturesRef.current = nextSignatures;
          await reload(raw, changedAssets);
          return;
        }
        const changedAssets = changedAssetPaths(assetSignaturesRef.current, nextSignatures);
        assetSignaturesRef.current = nextSignatures;
        if (changedAssets.length > 0) {
          await reload(raw, changedAssets);
        }
      } catch {
        // Transient read failure (file mid-write, permission blip) — ignore and
        // retry on the next tick.
      }
    }

    // Establish the baseline immediately, then poll serially only while the
    // page is visible. This prevents overlapping reads on a slow connection.
    const stopPolling = startVisibilityAwarePoller(poll, POLL_INTERVAL_MS, {
      runImmediately: true,
    });

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [connected, cwd, documentPath]);

  return flashKey;
}
