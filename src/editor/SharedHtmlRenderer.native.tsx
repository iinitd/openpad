import { createPluginContext } from "../content/plugin-context";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Linking, Pressable } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { DocumentCommentBar } from "./DocumentCommentBar";
import { DocumentToc } from "./DocumentToc";
import { ChangedBlockCursor } from "./ChangedBlockCursor";
import { extractHeadings, type DocumentHeading } from "./file-content";
import { InstancePicker } from "../components/InstancePicker";
import { useWatchOpenFile } from "./use-watch-open-file";
import { useEditorStore } from "../stores/editor-store";
import { useAnnotationStore } from "../stores/annotation-store";
import { useSessionStore } from "../stores/session-store";
import { useFilesStore } from "../stores/files-store";
import { useConnectionStore } from "../stores/connection-store";
import { useContentStore } from "../content/content-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { THEME } from "../styles/theme";
import { buildSharedDocumentHtml } from "./shared-document-shell";
import {
  extractPlantUmlPlaceholders,
  renderPlantUmlPlaceholderHtml,
} from "./plantuml-preview";
import type { DocumentAssetPatch } from "./resolve-doc-images";
import { getPlugin } from "../plugins/registry";
import { usePluginInstances } from "../plugins/use-plugin-instances";

function injectCommand(webview: WebView | null, command: string, payload: Record<string, unknown> = {}) {
  const encoded = JSON.stringify({ command, ...payload }).replace(/</g, "\\u003c");
  webview?.injectJavaScript(`
    (function () {
      var message = ${encoded};
      var commands = window.__kelDocumentCommands || {};
      var fn = commands[message.command];
      if (typeof fn !== "function") return true;
      if (message.command === "replaceAsset") fn(message.path, message.html);
      else if (message.command === "replacePlantUml") fn(message.id, message.html);
      else if (message.command === "setImageRef") fn(message.path || "");
      else if (message.command === "restoreScroll" || message.command === "scrollToHeading") fn(message.value);
      else if (message.command === "markChangedBlocks") fn(message.value || []);
      else fn();
      return true;
    })();
  `);
}

export function SharedHtmlRendererNative({
  hideInlineCommentBar,
  onRequestFiles,
  onRequestAgent,
  active = true,
}: {
  hideInlineCommentBar?: boolean;
  onRequestFiles?: () => void;
  onRequestAgent?: () => void;
  active?: boolean;
}) {
  const webviewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const pendingNativePatchesRef = useRef<DocumentAssetPatch[]>([]);
  const plantUmlRunRef = useRef(0);

  const polishAnnotation = useAnnotationStore((s) => s.polishAnnotation);
  const sendComment = useAnnotationStore((s) => s.sendComment);
  const sendImageComment = useAnnotationStore((s) => s.sendImageComment);

  const externalContentVersion = useEditorStore((s) => s.externalContentVersion);
  const documentTitle = useEditorStore((s) => s.documentTitle);
  const documentPath = useEditorStore((s) => s.documentPath);
  const setCommentBridge = useEditorStore((s) => s.setCommentBridge);
  const setApplyNativeAssetPatch = useEditorStore((s) => s.setApplyNativeAssetPatch);
  const changedBlockSigs = useEditorStore((s) => s.changedBlockSigs);

  const tocOpen = useEditorStore((state) => state.tocOpen);
  const setTocOpen = useEditorStore((state) => state.setTocOpen);
  const [headings, setHeadings] = useState<DocumentHeading[]>([]);
  const [selectionText, setSelectionText] = useState<string | null>(null);
  const [selectionBlockIds, setSelectionBlockIds] = useState<string[]>([]);
  const [imageRef, setImageRef] = useState<{
    path: string;
    kind: "image" | "whiteboard";
    label: string;
  } | null>(null);
  const [revising, setRevising] = useState(false);
  const [changedCount, setChangedCount] = useState(0);
  const isStreaming = useSessionStore((s) => s.isStreaming);

  const html = useMemo(
    () => buildSharedDocumentHtml(useEditorStore.getState().content),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [externalContentVersion],
  );
  const plantUmlPlaceholders = useMemo(
    () => extractPlantUmlPlaceholders(useEditorStore.getState().content),
    [externalContentVersion],
  );

  useLayoutEffect(() => {
    setHeadings(extractHeadings(useEditorStore.getState().content));
    setTocOpen(false);
    setSelectionText(null);
    setSelectionBlockIds([]);
    setImageRef(null);
    setChangedCount(0);
    readyRef.current = false;
    pendingNativePatchesRef.current = [];
    plantUmlRunRef.current += 1;
    setCommentBridge(null);
  }, [externalContentVersion, setCommentBridge]);

  const hydratePlantUml = useCallback(() => {
    const runId = ++plantUmlRunRef.current;
    if (plantUmlPlaceholders.length === 0) return;

    void (async () => {
      for (const placeholder of plantUmlPlaceholders) {
        const html = await renderPlantUmlPlaceholderHtml(placeholder);
        if (runId !== plantUmlRunRef.current || !readyRef.current) return;
        injectCommand(webviewRef.current, "replacePlantUml", {
          id: placeholder.id,
          html,
        });
      }
    })();
  }, [plantUmlPlaceholders]);

  const restoreScroll = useCallback(() => {
    const cwd = useFilesStore.getState().cwd;
    if (!cwd || !documentPath) return;
    const saved = usePreferencesStore.getState().getDocumentScroll(cwd, documentPath);
    injectCommand(webviewRef.current, "restoreScroll", { value: saved });
  }, [documentPath]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: {
        type?: string;
        text?: string;
        offset?: number;
        path?: string;
        kind?: string;
        url?: string;
        html?: string;
        blockIds?: string[];
        count?: number;
      };
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case "ready":
          readyRef.current = true;
          restoreScroll();
          injectCommand(webviewRef.current, "markChangedBlocks", { value: changedBlockSigs });
          injectCommand(webviewRef.current, "setImageRef", { path: imageRef?.path ?? "" });
          hydratePlantUml();
          if (pendingNativePatchesRef.current.length > 0) {
            const pending = pendingNativePatchesRef.current;
            pendingNativePatchesRef.current = [];
            for (const patch of pending) {
              injectCommand(webviewRef.current, "replaceAsset", {
                path: patch.path,
                html: patch.html,
              });
            }
          }
          break;
        case "selection": {
          const text = (msg.text ?? "").trim();
          if (text.length === 0 && !activeRef.current) break;
          if (text.length === 0) break;
          setImageRef(null);
          setSelectionText(text);
          setSelectionBlockIds(
            Array.isArray(msg.blockIds)
              ? msg.blockIds.filter((id): id is string => typeof id === "string")
              : [],
          );
          break;
        }
        case "imageRef": {
          const path = (msg.path ?? "").trim();
          if (!path) break;
          const kind = msg.kind === "whiteboard" ? "whiteboard" : "image";
          const label = path.split("/").pop() || kind;
          setSelectionText(null);
          setSelectionBlockIds([]);
          setImageRef({ path, kind, label });
          break;
        }
        case "scroll": {
          const cwd = useFilesStore.getState().cwd;
          if (cwd && documentPath && typeof msg.offset === "number") {
            usePreferencesStore.getState().setDocumentScroll(cwd, documentPath, msg.offset);
          }
          break;
        }
        case "external":
          if (typeof msg.url === "string") void Linking.openURL(msg.url);
          break;
        case "changedBlocks":
          if (typeof msg.count === "number") setChangedCount(msg.count);
          break;
      }
    },
    [changedBlockSigs, documentPath, hydratePlantUml, imageRef?.path, restoreScroll],
  );

  const flashKey = useWatchOpenFile();
  useEffect(() => {
    if (flashKey === 0 || !readyRef.current) return;
    injectCommand(webviewRef.current, "flash");
  }, [flashKey]);

  useEffect(() => {
    if (!readyRef.current) return;
    injectCommand(webviewRef.current, "setImageRef", { path: imageRef?.path ?? "" });
  }, [imageRef]);

  useEffect(() => {
    if (!readyRef.current) return;
    injectCommand(webviewRef.current, "markChangedBlocks", { value: changedBlockSigs });
    if (changedBlockSigs.length === 0) setChangedCount(0);
  }, [changedBlockSigs]);

  const jumpNextChanged = useCallback(() => {
    injectCommand(webviewRef.current, "jumpToChangedBlock", { direction: "next" });
  }, []);
  const jumpPrevChanged = useCallback(() => {
    injectCommand(webviewRef.current, "jumpToChangedBlock", { direction: "prev" });
  }, []);

  useEffect(() => {
    if (!isStreaming && revising) {
      setRevising(false);
      injectCommand(webviewRef.current, "clearWorking");
    }
  }, [isStreaming, revising]);

  const handleBarSend = useCallback(
    async (barComment: string) => {
      if (imageRef) {
        const ref = imageRef;
        setImageRef(null);
        setRevising(true);
        await sendImageComment({ path: ref.path, kind: ref.kind }, barComment.trim());
        return;
      }
      const sel = selectionText;
      if (sel && sel.trim().length > 0) {
        injectCommand(webviewRef.current, "markWorking");
        setRevising(true);
        setSelectionText(null);
        setSelectionBlockIds([]);
        await polishAnnotation({
          id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          from: 0,
          to: 0,
          highlightedText: sel,
          blockIds: selectionBlockIds,
          comment: barComment.trim(),
          status: "pending",
        });
        return;
      }
      await sendComment(barComment.trim(), null);
    },
    [imageRef, polishAnnotation, selectionBlockIds, selectionText, sendComment, sendImageComment],
  );

  const handleClearSelection = useCallback(() => {
    setSelectionText(null);
    setSelectionBlockIds([]);
    setImageRef(null);
    injectCommand(webviewRef.current, "clearSelection");
    injectCommand(webviewRef.current, "setImageRef", { path: "" });
  }, []);

  const handleTocSelect = useCallback((index: number) => {
    setTocOpen(false);
    injectCommand(webviewRef.current, "scrollToHeading", { value: index });
  }, []);

  const applyNativeAssetPatch = useCallback((patch: DocumentAssetPatch) => {
    if (!readyRef.current) {
      pendingNativePatchesRef.current.push(patch);
      return;
    }
    injectCommand(webviewRef.current, "replaceAsset", { path: patch.path, html: patch.html });
  }, []);

  useEffect(() => {
    if (!hideInlineCommentBar) return;
    setCommentBridge({
      selectionText,
      imageRef: imageRef
        ? { path: imageRef.path, kind: imageRef.kind, label: imageRef.label }
        : null,
      onSend: handleBarSend,
      onClearSelection: selectionText || imageRef ? handleClearSelection : undefined,
    });
    return () => setCommentBridge(null);
  }, [
    handleBarSend,
    handleClearSelection,
    hideInlineCommentBar,
    imageRef,
    selectionText,
    setCommentBridge,
    externalContentVersion,
  ]);

  useEffect(() => {
    setApplyNativeAssetPatch(applyNativeAssetPatch);
    return () => setApplyNativeAssetPatch(null);
  }, [applyNativeAssetPatch, setApplyNativeAssetPatch]);

  return (
    <View style={styles.container}>
      <WorkingCopyPickerSlot />

      {documentTitle ? (
        <DocumentToc
          title={documentTitle}
          headings={headings}
          open={tocOpen}
          onToggle={() => setTocOpen(!tocOpen)}
          onSelect={handleTocSelect}
        />
      ) : null}

      <View style={styles.previewArea}>
        <WebView
          ref={webviewRef}
          key={externalContentVersion}
          style={styles.webview}
          originWhitelist={["*"]}
          source={{ html }}
          onMessage={handleMessage}
          javaScriptEnabled
          onShouldStartLoadWithRequest={(request) => {
            if (request.url === "about:blank" || request.url.startsWith("data:")) return true;
            if (/^https?:/i.test(request.url)) {
              void Linking.openURL(request.url);
              return false;
            }
            return true;
          }}
        />
        <ChangedBlockCursor
          count={changedCount}
          onJumpNext={jumpNextChanged}
          onJumpPrev={jumpPrevChanged}
        />
        {tocOpen ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setTocOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close outline"
          >
            <View style={styles.tocScrim} />
          </Pressable>
        ) : null}
      </View>

      {hideInlineCommentBar ? null : (
        <DocumentCommentBar
          selectionText={selectionText}
          imageRef={imageRef ? { label: imageRef.label, kind: imageRef.kind } : null}
          onSend={handleBarSend}
          onClearSelection={selectionText || imageRef ? handleClearSelection : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  tocScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15,23,42,0.18)",
  },
  previewArea: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  webview: {
    flex: 1,
    backgroundColor: "#fafafa",
  },
  pluginToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: THEME.spacing.md,
    backgroundColor: THEME.colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.colors.border,
  },
});

// Instance picker for the lark-working-copy plugin. Mirrors the web
// implementation so pulled docs are switchable from the editor top bar on
// native too. Collapses into nothing for any other active plugin.
function WorkingCopyPickerSlot() {
  const activePluginId = useContentStore((state) => state.active.pluginId);
  const activeInstanceKey = useContentStore((state) => state.active.instanceKey);
  const cwd = useFilesStore((state) => state.cwd);
  const workspaceId = useSessionStore((state) => state.workspaceId);
  const client = useConnectionStore((state) => state.client);
  const instances = usePluginInstances("lark-working-copy");
  const handleSelect = useCallback(
    async (key: string) => {
      const plugin = getPlugin("lark-working-copy");
      if (!plugin || plugin.kind !== "preview" || !plugin.open) return;
      await plugin.open(createPluginContext(client, cwd, workspaceId), { path: key });
    },
    [cwd, workspaceId, client],
  );
  if (activePluginId !== "lark-working-copy" || instances.length <= 1) return null;
  return (
    <View style={styles.pluginToolbar}>
      <InstancePicker
        title="Lark Working Copy"
        instances={instances}
        activeKey={activeInstanceKey}
        onSelect={handleSelect}
      />
    </View>
  );
}
