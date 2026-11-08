import type { BackendAttachment } from "../backend";
import { createPluginContext } from "../content/plugin-context";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
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
import { getPlugin } from "../plugins/registry";
import { usePluginInstances } from "../plugins/use-plugin-instances";

function postCommand(
  iframe: HTMLIFrameElement | null,
  command: string,
  payload: Record<string, unknown> = {},
) {
  iframe?.contentWindow?.postMessage({ type: "kel-document-command", command, ...payload }, "*");
}

export function SharedHtmlRendererWeb({
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
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const activeRef = useRef(active);
  const plantUmlRunRef = useRef(0);
  activeRef.current = active;

  const polishAnnotation = useAnnotationStore((s) => s.polishAnnotation);
  const sendComment = useAnnotationStore((s) => s.sendComment);
  const sendImageComment = useAnnotationStore((s) => s.sendImageComment);

  const externalContentVersion = useEditorStore((s) => s.externalContentVersion);
  const documentTitle = useEditorStore((s) => s.documentTitle);
  const documentPath = useEditorStore((s) => s.documentPath);
  const setCommentBridge = useEditorStore((s) => s.setCommentBridge);
  const changedBlockSigs = useEditorStore((s) => s.changedBlockSigs);

  const [tocOpen, setTocOpen] = useState(false);
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
        postCommand(iframeRef.current, "replacePlantUml", {
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
    postCommand(iframeRef.current, "restoreScroll", { value: saved });
  }, [documentPath]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || typeof event.data !== "string") return;
      let msg: {
        type?: string;
        text?: string;
        offset?: number;
        path?: string;
        kind?: string;
        url?: string;
        blockIds?: string[];
        count?: number;
        edge?: string;
      };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case "ready":
          readyRef.current = true;
          restoreScroll();
          postCommand(iframeRef.current, "markChangedBlocks", { value: changedBlockSigs });
          postCommand(iframeRef.current, "setImageRef", { path: imageRef?.path ?? "" });
          hydratePlantUml();
          break;
        case "changedBlocks":
          if (typeof msg.count === "number") setChangedCount(msg.count);
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
          if (typeof msg.url === "string") window.open(msg.url, "_blank", "noopener,noreferrer");
          break;
        case "edgeSwipe":
          if (msg.edge === "left") onRequestFiles?.();
          if (msg.edge === "right") onRequestAgent?.();
          break;
      }
    };

    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [
    changedBlockSigs,
    documentPath,
    hydratePlantUml,
    imageRef?.path,
    onRequestAgent,
    onRequestFiles,
    restoreScroll,
  ]);

  const flashKey = useWatchOpenFile();
  useEffect(() => {
    if (flashKey === 0 || !readyRef.current) return;
    postCommand(iframeRef.current, "flash");
  }, [flashKey]);

  useEffect(() => {
    if (!readyRef.current) return;
    postCommand(iframeRef.current, "setImageRef", { path: imageRef?.path ?? "" });
  }, [imageRef]);

  useEffect(() => {
    if (!readyRef.current) return;
    postCommand(iframeRef.current, "markChangedBlocks", { value: changedBlockSigs });
    if (changedBlockSigs.length === 0) setChangedCount(0);
  }, [changedBlockSigs]);

  const jumpNextChanged = useCallback(() => {
    postCommand(iframeRef.current, "jumpToChangedBlock", { direction: "next" });
  }, []);
  const jumpPrevChanged = useCallback(() => {
    postCommand(iframeRef.current, "jumpToChangedBlock", { direction: "prev" });
  }, []);

  useEffect(() => {
    if (!isStreaming && revising) {
      setRevising(false);
      postCommand(iframeRef.current, "clearWorking");
    }
  }, [isStreaming, revising]);

  const handleBarSend = useCallback(
    async (barComment: string, attachments?: BackendAttachment[]) => {
      if (imageRef) {
        const ref = imageRef;
        setImageRef(null);
        setRevising(true);
        await sendImageComment({ path: ref.path, kind: ref.kind }, barComment.trim(), attachments);
        return;
      }
      const sel = selectionText;
      if (sel && sel.trim().length > 0) {
        postCommand(iframeRef.current, "markWorking");
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
        }, attachments);
        return;
      }
      await sendComment(barComment.trim(), null, attachments);
    },
    [imageRef, polishAnnotation, selectionBlockIds, selectionText, sendComment, sendImageComment],
  );

  const handleClearSelection = useCallback(() => {
    setSelectionText(null);
    setSelectionBlockIds([]);
    setImageRef(null);
    postCommand(iframeRef.current, "clearSelection");
    postCommand(iframeRef.current, "setImageRef", { path: "" });
  }, []);

  const handleTocSelect = useCallback((index: number) => {
    setTocOpen(false);
    postCommand(iframeRef.current, "scrollToHeading", { value: index });
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

  return (
    <View style={styles.container}>
      <WorkingCopyPickerSlot />

      {documentTitle ? (
        <DocumentToc
          title={documentTitle}
          headings={headings}
          open={tocOpen}
          onToggle={() => setTocOpen((o) => !o)}
          onSelect={handleTocSelect}
        />
      ) : null}

      <View style={styles.previewArea}>
        <iframe
          ref={iframeRef}
          key={externalContentVersion}
          title={documentTitle || "Document Preview"}
          srcDoc={html}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads"
          style={{ border: 0, width: "100%", flex: 1, minWidth: 0, minHeight: 0, background: "white" }}
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
    minWidth: 0,
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

// Instance picker for the lark-working-copy plugin. Rendered inside the
// editor top bar so the user can switch between pulled docs the same way
// Web Preview exposes its root picker. For every other plugin (markdown,
// agent-opened file, etc.) the plugin either returns a single instance or
// nothing, and the picker collapses into a no-op.
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
