import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { ActiveSelection } from "../types/annotation";
import type { DocumentAssetPatch } from "../editor/resolve-doc-images";
import type { BackendAttachment } from "../backend";

const EMPTY_DOCUMENT_HTML =
  '<div class="kel-empty-document">Select a file from Files to preview it.</div>';

// A live bridge the active editor (web TipTap or native WebView) publishes so a
// comment bar rendered *outside* the editor — e.g. the mobile dock that fuses
// the bubble with the tab bar — can drive the same selection/send flow. The
// handlers are editor-specific (marking the span, pulsing it, routing through
// polishAnnotation), so the editor owns them and only exposes them here.
export interface CommentBarBridge {
  selectionText: string | null;
  // An embedded asset (image / whiteboard) the user tapped as the comment
  // reference, if any. Mutually exclusive with a text selection in practice.
  imageRef?: { path: string; kind: "image" | "whiteboard"; label: string } | null;
  onSend: (comment: string, attachments?: BackendAttachment[]) => void | Promise<void>;
  secondaryAction?: {
    label: string;
    onSend: (comment: string, attachments?: BackendAttachment[]) => void | Promise<void>;
  };
  onClearSelection?: () => void;
}

// Where the in-flight AI revision is aimed. Captured when a comment/annotation
// is dispatched so the "AI is revising…" banner can (a) name the right scope
// and (b) let the user jump back to the exact document being edited even if
// they've since opened a different file. Cleared when the turn ends.
export interface ReviseTarget {
  cwd: string | null;
  documentPath: string | null;
  documentTitle: string | null;
  // "selection" = a highlighted passage was attached; "document" = a
  // document-scoped comment with no selection.
  scope: "selection" | "document";
}

interface EditorStore {
  content: string;
  annotations: Map<string, { from: number; to: number }>;
  // Path (relative to cwd) of the workspace file currently loaded, if any.
  documentPath: string | null;
  documentTitle: string | null;
  // Bumped whenever content is replaced from outside the editor (e.g. opening a
  // workspace file, or reloading it after the agent edited it on disk), so the
  // editor component knows to re-sync its document from `content`.
  externalContentVersion: number;
  // "preview" = read-only (tap/select never opens the keyboard; you can still
  // highlight to bookmark/comment). "edit" = fully editable rich-text.
  mode: "preview" | "edit";
  // Whether the current source supports in-editor editing. Lark working
  // copies (XML-backed) are read-only through the shared renderer because
  // TipTap HTML serialization would discard their metadata/frontmatter;
  // the editor shell hides the edit-mode toggle when this is false. The
  // flag is written by the plugin that opened the document (via its
  // `capabilities.editable` field) so plugin-specific vocabulary stays
  // inside the plugin layer.
  editable: boolean;
  // The current text selection in the document, surfaced by whichever editor
  // (web TipTap or native WebView) is active. Drives the persistent comment bar
  // so it can attach the highlighted passage as context. Null when nothing is
  // selected — the bar then sends a document-scoped comment with no selection.
  activeSelection: ActiveSelection | null;
  // The in-progress comment the user is typing in the persistent comment bar.
  // Kept in the store (not local component state) so an AI revise that reloads
  // the document mid-typing can't discard the user's draft: at worst the
  // highlighted reference clears, but the typed text survives.
  commentDraft: string;
  // Published by whichever editor is mounted so an external comment bar (the
  // mobile dock) can render the bubble and route sends back to the editor.
  // Null when no editor is driving it (fall back to a doc-scoped bar).
  commentBridge: CommentBarBridge | null;
  // In-flight AI revisions, keyed by cwd. A map (not a single slot) so running
  // agents in multiple workspaces don't clobber each other — switching
  // workspace restores the matching workspace's banner intact.
  reviseTargetsByCwd: Record<string, ReviseTarget>;

  // EXPERIMENTAL — paragraph-level "what did the AI change" highlighting.
  // Snapshot of the open document's HTML taken when a revision starts; used as
  // the diff baseline when the file reloads after the agent edits it. Scoped to
  // a documentPath so we only highlight when the reloaded file is the one the
  // revision was launched against.
  reviseBaseline: { documentPath: string | null; html: string } | null;
  // Signatures (tag + stripped text — see block-diff.ts) of the top-level
  // blocks that were new-or-modified by the last revision. The editor tints the
  // DOM blocks whose signature is in this set. Signatures (not indices) are used
  // because the editor re-renders blocks differently than the raw diff HTML, so
  // indices wouldn't line up. Kept until the next revision or a different file
  // is opened — display-only, no per-change confirm.
  changedBlockSigs: string[];
  applyNativeAssetPatch: ((patch: DocumentAssetPatch) => void | Promise<void>) | null;

  setContent: (html: string) => void;
  resetDocument: () => void;
  showEmptyDocument: () => void;
  openDocument: (path: string, title: string, html: string, editable?: boolean) => void;
  // Replace the current document's HTML in place (same file, new content from
  // disk). Bumps externalContentVersion so the editor re-syncs.
  reloadContent: (html: string) => void;
  setAnnotationRange: (id: string, from: number, to: number) => void;
  removeAnnotationRange: (id: string) => void;
  setMode: (mode: "preview" | "edit") => void;
  setActiveSelection: (selection: ActiveSelection | null) => void;
  setCommentDraft: (draft: string) => void;
  setCommentBridge: (bridge: CommentBarBridge | null) => void;
  // Set/clear the per-workspace revise target. Pass target=null to drop the
  // entry for that cwd. The cwd is the key; passing a cwd with no existing
  // entry and target=null is a no-op.
  setReviseTargetForCwd: (cwd: string | null, target: ReviseTarget | null) => void;
  // Capture the current document as the diff baseline for an incoming revision
  // and clear any prior change highlights. No-op-safe to call repeatedly.
  beginReviseBaseline: () => void;
  setChangedBlockSigs: (sigs: string[]) => void;
  setApplyNativeAssetPatch: (handler: ((patch: DocumentAssetPatch) => void | Promise<void>) | null) => void;
}

export const useEditorStore = create<EditorStore>()(
  subscribeWithSelector((set) => ({
    content: "<h1>Untitled Document</h1><p>Start writing, or ask the AI to help you draft something.</p>",
    annotations: new Map(),
    documentPath: null,
    documentTitle: null,
    externalContentVersion: 0,
    mode: "preview",
    editable: true,
    activeSelection: null,
    commentDraft: "",
    commentBridge: null,
    reviseTargetsByCwd: {},
    reviseBaseline: null,
    changedBlockSigs: [],
    applyNativeAssetPatch: null,

    setContent: (html) => set({ content: html }),

    resetDocument: () =>
      set((state) => ({
        content: "",
        documentPath: null,
        documentTitle: null,
        annotations: new Map(),
        externalContentVersion: state.externalContentVersion + 1,
        mode: "preview",
        editable: true,
        activeSelection: null,
        commentDraft: "",
        commentBridge: null,
        reviseBaseline: null,
        changedBlockSigs: [],
      })),

    showEmptyDocument: () =>
      set((state) => ({
        content: EMPTY_DOCUMENT_HTML,
        externalContentVersion: state.externalContentVersion + 1,
      })),

    openDocument: (path, title, html, editable = true) =>
      set((state) => ({
        content: html,
        documentPath: path,
        documentTitle: title,
        annotations: new Map(),
        externalContentVersion: state.externalContentVersion + 1,
        activeSelection: null,
        // Opening a different file is a deliberate context switch, so any draft
        // comment aimed at the previous doc is cleared. (A mere reloadContent —
        // e.g. the AI revising the same file — leaves the draft untouched.)
        commentDraft: "",
        // Newly opened files start read-only so tapping to read/select never
        // pops the keyboard; the user opts into editing explicitly.
        mode: "preview",
        editable,
        // A different document invalidates any pending change baseline/tint.
        reviseBaseline: null,
        changedBlockSigs: [],
      })),

    reloadContent: (html) =>
      set((state) => ({
        content: html,
        annotations: new Map(),
        externalContentVersion: state.externalContentVersion + 1,
      })),

    setAnnotationRange: (id, from, to) =>
      set((state) => {
        const next = new Map(state.annotations);
        next.set(id, { from, to });
        return { annotations: next };
      }),

    removeAnnotationRange: (id) =>
      set((state) => {
        const next = new Map(state.annotations);
        next.delete(id);
        return { annotations: next };
      }),

    setMode: (mode) => set({ mode }),
    setActiveSelection: (activeSelection) => set({ activeSelection }),
    setCommentDraft: (commentDraft) => set({ commentDraft }),
    setCommentBridge: (commentBridge) => set({ commentBridge }),
    setReviseTargetForCwd: (cwd, target) =>
      set((state) => {
        // No cwd (session not yet attached to a workspace): don't try to keep a
        // keyed entry — the banner just won't show until a cwd lands.
        if (!cwd) return state;
        const next = { ...state.reviseTargetsByCwd };
        if (target) next[cwd] = target;
        else delete next[cwd];
        return { reviseTargetsByCwd: next };
      }),

    beginReviseBaseline: () =>
      set((state) => ({
        reviseBaseline: { documentPath: state.documentPath, html: state.content },
        changedBlockSigs: [],
      })),

    setChangedBlockSigs: (changedBlockSigs) => set({ changedBlockSigs }),
    setApplyNativeAssetPatch: (applyNativeAssetPatch) => set({ applyNativeAssetPatch }),
  })),
);
