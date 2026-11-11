import { useCallback, useRef, useEffect, useState } from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Highlight } from "@tiptap/extension-highlight";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table";
import { TableHeader } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table";
import { BadgedImage } from "./tiptap-extensions/badged-image";
import { Callout } from "./tiptap-extensions/callout";
import { ClippedTableView } from "./tiptap-extensions/clipped-table-view";
import { AnnotationMark } from "./tiptap-extensions/annotation-mark";
import { LarkBlockAttributes, LarkColumn, LarkEmbed, LarkFigure, LarkGrid } from "./tiptap-extensions/lark-structure";
import { EditorToolbar } from "./EditorToolbar";
import { DocumentCommentBar } from "./DocumentCommentBar";
import { DocumentToc } from "./DocumentToc";
import { ReviseBanner } from "./ReviseBanner";
import { extractHeadings, type DocumentHeading } from "./file-content";
import { Icon } from "../components/Icon";
import { useEditorStore } from "../stores/editor-store";
import { useAnnotationStore } from "../stores/annotation-store";
import { useSessionStore } from "../stores/session-store";
import { useFilesStore } from "../stores/files-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { useWatchOpenFile } from "./use-watch-open-file";
import { blockSignature } from "./block-diff";
import { THEME } from "../styles/theme";
import { isWeb } from "../constants/platform";
import { EDITOR_DOC_CSS } from "./editor-doc-css";
import { openWorkspaceDocument } from "./open-document";

/**
 * Inject editor-specific CSS into the document head (web only).
 */
function injectEditorStyles() {
  if (!isWeb) return;

  const id = "puff-editor-styles";
  // Reuse the existing tag if present (so hot reload refreshes the rules in
  // place instead of leaving a stale stylesheet without the newest classes).
  const style = document.getElementById(id) ?? document.createElement("style");
  style.id = id;
  style.textContent = EDITOR_DOC_CSS;
  if (!style.parentNode) document.head.appendChild(style);
}

interface ToolbarState {
  visible: boolean;
  top: number;
  left: number;
  from: number;
  to: number;
  text: string;
  blockIds: string[];
}

// A tapped image / whiteboard chosen as the AI-comment reference. Carries the
// document-declared workspace path (data-kel-src) so the agent can open the
// asset, plus a short label and kind for the chip.
interface ImageRefState {
  path: string;
  kind: "image" | "whiteboard";
  label: string;
}

const HIDDEN_TOOLBAR: ToolbarState = {
  visible: false,
  top: 0,
  left: 0,
  from: 0,
  to: 0,
  text: "",
  blockIds: [],
};

function newAnnotationId(): string {
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function EditorWeb({
  hideInlineCommentBar,
  onRequestFiles,
  active = true,
}: {
  hideInlineCommentBar?: boolean;
  onRequestFiles?: () => void;
  active?: boolean;
}) {
  const setContent = useEditorStore((s) => s.setContent);
  const addAnnotation = useAnnotationStore((s) => s.addAnnotation);
  const polishAnnotation = useAnnotationStore((s) => s.polishAnnotation);
  const sendComment = useAnnotationStore((s) => s.sendComment);
  const sendImageComment = useAnnotationStore((s) => s.sendImageComment);

  const [toolbar, setToolbar] = useState<ToolbarState>(HIDDEN_TOOLBAR);
  // A tapped image / whiteboard selected as the comment reference (mutually
  // exclusive with a text selection).
  const [imageRef, setImageRef] = useState<ImageRefState | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // On mobile all panes stay mounted with `display` toggled. Hiding a
  // contenteditable pane makes the browser drop the DOM selection, which fires
  // a collapse event. We must NOT treat that as the user deselecting — doing so
  // would wipe the highlighted-passage reference (and the revise context) the
  // moment they switch to the Agent tab to watch progress. This ref lets the
  // one-time editor callback read the latest `active` flag.
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    injectEditorStyles();
  }, []);

  const externalContentVersion = useEditorStore((s) => s.externalContentVersion);
  const documentTitle = useEditorStore((s) => s.documentTitle);
  const documentPath = useEditorStore((s) => s.documentPath);
  const mode = useEditorStore((s) => s.mode);
  const editable = useEditorStore((s) => s.editable);
  const setMode = useEditorStore((s) => s.setMode);
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    const cwd = useFilesStore.getState().cwd;
    if (!cwd || !documentPath || refreshing) return;
    setRefreshing(true);
    try { await openWorkspaceDocument(cwd, documentPath); } finally { setRefreshing(false); }
  }, [documentPath, refreshing]);

  // Table-of-contents drawer under the title. Headings are re-derived whenever
  // the document is opened/reloaded (externalContentVersion bumps); the drawer
  // is collapsed again on every document swap so it doesn't linger open across
  // files.
  const [tocOpen, setTocOpen] = useState(false);
  const [headings, setHeadings] = useState<DocumentHeading[]>([]);
  useEffect(() => {
    setHeadings(extractHeadings(useEditorStore.getState().content));
    setTocOpen(false);
  }, [externalContentVersion]);

  // The agent turn's live state, so the document view can show that a revision
  // is in flight (a pulsing highlight on the exact span). The persistent banner
  // itself is rendered by <ReviseBanner/>, driven by the shared reviseTarget.
  const isStreaming = useSessionStore((s) => s.isStreaming);
  const [revisingIds, setRevisingIds] = useState<string[]>([]);

  // Watch the open file for on-disk changes made by the agent; flashKey bumps
  // each time the file was reloaded so we can play a brief highlight animation.
  const flashKey = useWatchOpenFile();
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (flashKey === 0) return;
    setFlashing(true);
    const t = setTimeout(() => setFlashing(false), 1200);
    return () => clearTimeout(t);
  }, [flashKey]);

  const editor = useEditor({
    extensions: [
      // StarterKit already bundles link + underline; enable link (it's off by
      // default) so URLs in loaded docs are clickable-rendered.
      StarterKit.configure({ link: { openOnClick: false } }),
      Highlight,
      Table.configure({ resizable: false, View: ClippedTableView }),
      TableRow,
      TableHeader,
      TableCell,
      // allowBase64 so the inline data: URIs produced by resolve-doc-images
      // (Lark media read over the relay) survive TipTap's parseHTML — it drops
      // img[src^="data:"] otherwise. BadgedImage also keeps the kel-media
      // wrapper so the format corner badge renders.
      BadgedImage.configure({ allowBase64: true }),
      Callout,
      LarkBlockAttributes,
      LarkGrid,
      LarkColumn,
      LarkFigure,
      LarkEmbed,
      AnnotationMark,
    ],
    // Preview by default: not editable, so tapping/selecting text never opens
    // the on-screen keyboard. Selecting still works for bookmark/comment.
    editable: mode === "edit",
    content: useEditorStore.getState().content,
    onUpdate: ({ editor }) => {
      setContent(editor.getHTML());
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      if (from === to) {
        // While this pane is hidden (mobile tab switch), the browser collapses
        // the selection on its own. Ignore that so the active highlight/comment
        // reference survives switching to the Agent tab and back.
        if (!activeRef.current) return;
        setToolbar(HIDDEN_TOOLBAR);
        return;
      }

      const text = editor.state.doc.textBetween(from, to, " ");
      if (!text.trim()) {
        setToolbar(HIDDEN_TOOLBAR);
        return;
      }

      // A selection just became active. Store its range/text so the persistent
      // comment bar can carry it as context. (No floating popover is needed now
      // that the bar is always present.) Picking a text selection supersedes any
      // image reference.
      setImageRef(null);
      const blockIds: string[] = [];
      editor.state.doc.nodesBetween(from, to, (node) => {
        const id = node.attrs?.larkBlockId;
        const isPatchableText = node.isTextblock || node.type.name === "listItem";
        if (isPatchableText && typeof id === "string" && id && !blockIds.includes(id)) blockIds.push(id);
      });
      setToolbar({ visible: true, top: 0, left: 0, from, to, text, blockIds });
    },
    editorProps: {
      attributes: {
        style:
          "outline: none; min-height: 100%; padding: 16px; font-size: 15px; line-height: 1.6;",
      },
    },
  });

  // Re-sync when a workspace file is opened OR reloaded from disk after the
  // agent edited it (externalContentVersion bumps in both cases).
  useEffect(() => {
    if (!editor) return;
    if (externalContentVersion === 0) return;
    const latest = useEditorStore.getState().content;
    editor.commands.setContent(latest, { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, externalContentVersion]);

  // Restore the saved scroll offset for the document that was just opened.
  // Runs after the content sync above; we wait two frames so ProseMirror has
  // laid out the new document and the scroll height is final. `restoringRef`
  // gates the onScroll persist handler so the restore itself doesn't clobber
  // the saved value with an intermediate offset.
  const restoringRef = useRef(false);
  useEffect(() => {
    if (!editor) return;
    if (externalContentVersion === 0) return;
    const container = containerRef.current;
    const cwd = useFilesStore.getState().cwd;
    if (!container || !cwd || !documentPath) return;
    const saved = usePreferencesStore.getState().getDocumentScroll(cwd, documentPath);
    restoringRef.current = true;
    let innerRaf = 0;
    const raf1 = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = saved;
        }
        restoringRef.current = false;
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (innerRaf) cancelAnimationFrame(innerRaf);
      restoringRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, externalContentVersion, documentPath]);

  // Persist the scroll offset (throttled) as the user scrolls the document, so
  // reopening the same file after a refresh restores their reading position.
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleScroll = useCallback(() => {
    if (restoringRef.current) return;
    const container = containerRef.current;
    const cwd = useFilesStore.getState().cwd;
    if (!container || !cwd || !documentPath) return;
    const offset = container.scrollTop;
    if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current);
    scrollSaveTimer.current = setTimeout(() => {
      usePreferencesStore.getState().setDocumentScroll(cwd, documentPath, offset);
    }, 150);
  }, [documentPath]);

  useEffect(() => {
    return () => {
      if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current);
    };
  }, []);

  // Toggle the ProseMirror editable flag when the user flips preview/edit.
  // In preview mode the field is read-only, so focusing it never raises the
  // keyboard; selection (for bookmark/comment) still works.
  useEffect(() => {
    if (!editor) return;
    const shouldEdit = mode === "edit" && editable;
    if (editor.isEditable !== shouldEdit) {
      editor.setEditable(shouldEdit);
    }
  }, [editor, mode, editable]);

  // Mark the selection with an annotation highlight and return its id.
  const markSelection = useCallback(
    (from: number, to: number): string => {
      const annotationId = newAnnotationId();
      editor
        ?.chain()
        .focus()
        .setTextSelection({ from, to })
        .setAnnotation({ annotationId })
        .run();
      useEditorStore.getState().setAnnotationRange(annotationId, from, to);
      return annotationId;
    },
    [editor],
  );

  // Send from the persistent bottom comment bar. With a live selection we mark
  // it, pulse it, and route through polishAnnotation so the highlight + comment
  // reach the agent; with no selection it's a document-scoped comment.
  const handleBarSend = useCallback(
    async (barComment: string) => {
      // An image / whiteboard reference takes priority: route it as an asset
      // comment (the document records the path; the agent opens the file).
      if (imageRef) {
        const ref = imageRef;
        setImageRef(null);
        await sendImageComment({ path: ref.path, kind: ref.kind }, barComment.trim());
        return;
      }
      if (editor && toolbar.visible) {
        const { from, to, text, blockIds } = toolbar;
        const annotationId = markSelection(from, to);
        const annotation = {
          id: annotationId,
          from,
          to,
          highlightedText: text,
          blockIds,
          comment: barComment.trim(),
          status: "pending" as const,
        };
        setToolbar(HIDDEN_TOOLBAR);
        setRevisingIds((prev) =>
          prev.includes(annotationId) ? prev : [...prev, annotationId],
        );
        await polishAnnotation(annotation);
        return;
      }
      await sendComment(barComment.trim(), null);
    },
    [editor, toolbar, imageRef, markSelection, polishAnnotation, sendComment, sendImageComment],
  );

  const handleBarClearSelection = useCallback(() => {
    setToolbar(HIDDEN_TOOLBAR);
    setImageRef(null);
    editor?.commands.setTextSelection(editor.state.selection.from);
  }, [editor]);

  // Tapping a rendered image / whiteboard selects it as the comment reference.
  // The resolved <img>/<span.kel-media> carries data-kel-src (the workspace
  // path the document declared) and data-kind; we read those to build the chip
  // and, on send, route through sendImageComment. Listener lives on the
  // scroll container since the media lives inside ProseMirror's contenteditable.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const media = target?.closest<HTMLElement>("[data-kel-src]");
      if (!media) return;
      // In edit mode a tap places the caret / lets the user manipulate the node;
      // don't hijack it. Reference selection is a preview-mode affordance.
      if (useEditorStore.getState().mode === "edit") return;
      const path = media.getAttribute("data-kel-src");
      if (!path) return;
      e.preventDefault();
      const kind = media.getAttribute("data-kind") === "whiteboard" ? "whiteboard" : "image";
      const label = path.split("/").pop() || (kind === "whiteboard" ? "whiteboard" : "image");
      // Choosing an asset supersedes any text selection.
      setToolbar(HIDDEN_TOOLBAR);
      const sel = window.getSelection?.();
      sel?.removeAllRanges?.();
      setImageRef({ path, kind, label });
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [editor]);

  // Toggle the selection ring on the referenced asset (matched by its
  // data-kel-src) so the user sees which image/whiteboard the bar points at.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const all = container.querySelectorAll<HTMLElement>(".kel-media[data-kel-src]");
    all.forEach((el) => {
      const on = !!imageRef && el.getAttribute("data-kel-src") === imageRef.path;
      el.classList.toggle("kel-ref-selected", on);
    });
  }, [imageRef, externalContentVersion]);

  // Scroll the document to the Nth heading element (matching extractHeadings'
  // document order) and collapse the TOC. Uses a plain DOM query since the
  // headings live inside ProseMirror's contenteditable, not React's tree.
  const handleTocSelect = useCallback((index: number) => {
    setTocOpen(false);
    const container = containerRef.current;
    if (!container) return;
    const hs = container.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");
    const target = hs[index];
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // When the inline bar is suppressed (mobile), publish the selection + handlers
  // to the store so the external floating dock can render the comment bubble and
  // route sends back here. Cleared on unmount / when re-enabling the inline bar.
  const setCommentBridge = useEditorStore((s) => s.setCommentBridge);
  useEffect(() => {
    if (!hideInlineCommentBar) return;
    setCommentBridge({
      selectionText: toolbar.visible ? toolbar.text : null,
      imageRef: imageRef ? { path: imageRef.path, kind: imageRef.kind, label: imageRef.label } : null,
      onSend: handleBarSend,
      onClearSelection: toolbar.visible || imageRef ? handleBarClearSelection : undefined,
    });
  }, [
    hideInlineCommentBar,
    toolbar.visible,
    toolbar.text,
    imageRef,
    handleBarSend,
    handleBarClearSelection,
    setCommentBridge,
  ]);
  useEffect(() => {
    return () => {
      if (hideInlineCommentBar) setCommentBridge(null);
    };
  }, [hideInlineCommentBar, setCommentBridge]);

  // Clear the "revising" pulse once the turn ends. If the agent edited the
  // file, the content reloads and the marks vanish on their own; this covers
  // the case where the turn completes without a file change.
  useEffect(() => {
    if (!isStreaming && revisingIds.length > 0) {
      setRevisingIds([]);
    }
  }, [isStreaming, revisingIds.length]);

  // Toggle the pulsing `kel-ai-working` class on the exact annotated <mark>
  // elements while their revision is in flight. Done via direct DOM query
  // because the highlight lives inside ProseMirror's contenteditable, not in
  // React's tree. Re-runs whenever the doc re-renders (externalContentVersion).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const active = isStreaming ? revisingIds : [];
    // A highlight that spans multiple blocks is rendered by ProseMirror as
    // several <mark> fragments sharing one annotation id. All pulse, but only
    // the first fragment of each id shows the "revising…" chip (kel-ai-working-lead)
    // so a single highlight doesn't sprout a banner per line.
    const seen = new Set<string>();
    const marks = container.querySelectorAll<HTMLElement>("mark[data-annotation-id]");
    marks.forEach((el) => {
      const id = el.getAttribute("data-annotation-id");
      const on = !!id && active.includes(id);
      el.classList.toggle("kel-ai-working", on);
      const lead = on && !seen.has(id!);
      el.classList.toggle("kel-ai-working-lead", lead);
      if (lead) seen.add(id!);
    });
  }, [isStreaming, revisingIds, externalContentVersion]);

  // EXPERIMENTAL — paragraph-level "what did the AI change" tint. After a
  // revision reloads the file, `changedBlockSigs` holds the signatures (tag +
  // stripped text — see block-diff.ts) of the new / modified top-level blocks.
  // We toggle `.kel-changed` on the `.tiptap` children whose own signature is in
  // that set, via a direct DOM query — TipTap's setContent strips custom classes
  // off nodes, and it re-renders blocks differently than the raw diff HTML (it
  // wraps <li> text in <p>, etc.), so we match by signature rather than index.
  // Deferred to the next animation frame because `editor.commands.setContent()`
  // (the re-sync effect above) may not commit ProseMirror's new DOM
  // synchronously; tagging in the same tick could mark nodes about to be
  // replaced. Display-only: the tint stays until the next revision or file swap.
  const changedBlockSigs = useEditorStore((s) => s.changedBlockSigs);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const apply = () => {
      const root = container.querySelector<HTMLElement>(".tiptap");
      if (!root) return;
      const changed = new Set(changedBlockSigs);
      const blocks = Array.from(root.children) as HTMLElement[];
      blocks.forEach((el) => {
        const match = changed.size > 0 && changed.has(blockSignature(el.outerHTML));
        el.classList.toggle("kel-changed", match);
      });
    };
    const raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
  }, [changedBlockSigs, externalContentVersion]);

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        {onRequestFiles ? (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={onRequestFiles}
            accessibilityLabel="Open files"
          >
            <Icon name="folder" size={20} color={THEME.colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
        {mode === "edit" && editable ? (
          <View style={styles.toolbarWrap}>
            <EditorToolbar editor={editor} />
          </View>
        ) : (
          <View style={styles.topBarSpacer} />
        )}
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => void handleRefresh()}
          disabled={refreshing}
          accessibilityLabel="Refresh document preview"
        >
          <Icon name="refresh" size={19} color={refreshing ? THEME.colors.textMuted : THEME.colors.textSecondary} />
        </TouchableOpacity>
        {editable ? <TouchableOpacity
          style={[styles.iconButton, mode === "edit" && styles.iconButtonActive]}
          onPress={() => setMode(mode === "edit" ? "preview" : "edit")}
          accessibilityLabel={mode === "edit" ? "Stop editing" : "Edit document"}
        >
          <Icon
            name={mode === "edit" ? "check" : "edit"}
            size={20}
            color={mode === "edit" ? THEME.colors.primary : THEME.colors.textSecondary}
          />
        </TouchableOpacity> : null}
      </View>

      {documentTitle ? (
        <DocumentToc
          title={documentTitle}
          headings={headings}
          open={tocOpen}
          onToggle={() => setTocOpen((o) => !o)}
          onSelect={handleTocSelect}
        />
      ) : null}

      {/* While the agent is revising (a highlighted span OR the whole
          document), show a persistent, tappable banner in the document view so
          the wait is legible from here — and so the user can jump back to the
          exact file being edited if they've since opened another one. */}
      <ReviseBanner />

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={flashing ? "kel-doc-flash" : undefined}
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        <EditorContent editor={editor} />
      </div>

      {/* Persistent comment bar pinned to the bottom of the document view.
          Always present: with a selection it carries the highlighted passage
          as context, otherwise it sends a document-scoped comment. On mobile
          it's suppressed here and rendered inside the shared floating dock. */}
      {hideInlineCommentBar ? null : (
        <DocumentCommentBar
          selectionText={toolbar.visible ? toolbar.text : null}
          imageRef={imageRef ? { label: imageRef.label, kind: imageRef.kind } : null}
          onSend={handleBarSend}
          onClearSelection={toolbar.visible || imageRef ? handleBarClearSelection : undefined}
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
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
    backgroundColor: THEME.colors.background,
  },
  topBarSpacer: {
    flex: 1,
  },
  // Icon-only affordances in the top bar: a larger, tappable glyph instead of
  // the old tiny "☰ Files" / "✎ Edit" text labels.
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: THEME.spacing.xs,
    borderRadius: THEME.radii.md,
  },
  iconButtonActive: {
    backgroundColor: THEME.colors.surface,
  },
  toolbarWrap: {
    flex: 1,
  },
});
