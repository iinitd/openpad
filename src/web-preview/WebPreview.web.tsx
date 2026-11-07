import type { BackendAttachment } from "../backend";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useWebPreviewStore } from "./web-preview-store";
import { buildWebPreviewHtml } from "./html";
import { THEME } from "../styles/theme";
import { DocumentCommentBar } from "../editor/DocumentCommentBar";
import { useEditorStore } from "../stores/editor-store";
import { sendPreviewComment } from "./preview-comment";
import type { WebPreviewProps } from "./WebPreview";
import { useFilesStore } from "../stores/files-store";
import { createPreviewStateScope, readPreviewState, writePreviewState } from "./preview-state";

export function WebPreview({ onRequestFiles, onRequestAgent, hideInlineCommentBar, active = true }: WebPreviewProps) {
  const snapshot = useWebPreviewStore((state) => state.snapshot);
  const error = useWebPreviewStore((state) => state.error);
  const loading = useWebPreviewStore((state) => state.loading);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [selectionText, setSelectionText] = useState<string | null>(null);
  const setCommentBridge = useEditorStore((state) => state.setCommentBridge);
  const cwd = useFilesStore((state) => state.cwd);
  const stateScope = useMemo(
    () => createPreviewStateScope(cwd || "", snapshot?.rootPath || ""),
    [cwd, snapshot?.rootPath],
  );
  const html = useMemo(() => snapshot ? buildWebPreviewHtml(snapshot) : "", [snapshot]);
  const clearSelection = useCallback(() => {
    setSelectionText(null);
    iframeRef.current?.contentWindow?.postMessage({ type: "kel-preview-command", command: "clear-selection" }, "*");
  }, []);
  const send = useCallback(async (comment: string, attachments?: BackendAttachment[]) => {
    await sendPreviewComment(comment, selectionText, attachments);
    clearSelection();
  }, [clearSelection, selectionText]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || typeof event.data !== "string") return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "selection" && active) {
          setSelectionText(typeof message.text === "string" ? message.text : null);
        }
        if (message.type === "edgeSwipe" && active) {
          if (message.edge === "left") onRequestFiles?.();
          if (message.edge === "right") onRequestAgent?.();
        }
        if (message.type === "preview-state-get" && typeof message.requestId === "string" && typeof message.key === "string") {
          void readPreviewState(
            { getItem: (key) => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) },
            stateScope,
            message.key,
          ).then((value) => iframeRef.current?.contentWindow?.postMessage({
            type: "kel-preview-command", command: "preview-state-value", requestId: message.requestId, value,
          }, "*"));
        }
        if (message.type === "preview-state-set" && typeof message.requestId === "string" && typeof message.key === "string") {
          void writePreviewState(
            { getItem: (key) => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) },
            stateScope,
            message.key,
            message.value,
          ).then((ok) => iframeRef.current?.contentWindow?.postMessage({
            type: "kel-preview-command", command: "preview-state-set-result", requestId: message.requestId, ok,
          }, "*"));
        }
      } catch {}
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [active, onRequestAgent, onRequestFiles, stateScope]);
  useEffect(() => {
    if (!hideInlineCommentBar) return;
    setCommentBridge({ selectionText, onSend: send, onClearSelection: selectionText ? clearSelection : undefined });
    return () => setCommentBridge(null);
  }, [clearSelection, hideInlineCommentBar, selectionText, send, setCommentBridge]);
  useEffect(() => setSelectionText(null), [snapshot?.fingerprint]);
  return (
    <View style={styles.container}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {snapshot ? (
        <iframe
          ref={iframeRef}
          title={snapshot.title}
          srcDoc={html}
          sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
          style={{ border: 0, width: "100%", flex: 1, minHeight: 0, background: "white" }}
        />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.muted}>{loading ? "Loading preview…" : "preview/index.html unavailable"}</Text>
        </View>
      )}
      {hideInlineCommentBar ? null : (
        <DocumentCommentBar
          selectionText={selectionText}
          onSend={send}
          onClearSelection={selectionText ? clearSelection : undefined}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, backgroundColor: "#fff" },
  muted: { fontSize: 13, color: THEME.colors.textMuted, textAlign: "center" },
  error: { padding: 6, color: THEME.colors.error, backgroundColor: "#fff1f2", fontSize: 12 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
});
