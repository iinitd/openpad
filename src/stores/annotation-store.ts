import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { Annotation } from "../types/annotation";
import type { BackendAttachment } from "../backend";
import { useSessionStore } from "./session-store";
import { useEditorStore } from "./editor-store";
import { useFilesStore } from "./files-store";

interface AnnotationStore {
  // Annotations that have been created (highlighted spans, optionally with a
  // comment) and sent to the agent.
  pendingAnnotations: Annotation[];

  addAnnotation: (annotation: Annotation) => void;
  removePendingAnnotation: (id: string) => void;
  clearPendingAnnotations: () => void;
  markAnnotationsSubmitted: (ids: string[]) => void;

  // Send one annotation (file + highlighted text + comment) to the agent. The
  // agent edits the file on disk itself; we don't post-process its reply.
  polishAnnotation: (annotation: Annotation, attachments?: BackendAttachment[]) => Promise<void>;

  // Send a free-form comment from the persistent document bar. `selectionText`
  // is optional: when the user has highlighted a passage it's attached as
  // context, otherwise the comment applies to the document as a whole.
  sendComment: (
    comment: string,
    selectionText: string | null,
    attachments?: BackendAttachment[],
  ) => Promise<void>;

  // Send a comment that references an embedded asset (an image or an exported
  // whiteboard) rather than a text passage. The document records the asset's
  // workspace-relative path, so we pass that path verbatim — the agent can open
  // the file to inspect it.
  sendImageComment: (
    ref: { path: string; kind: "image" | "whiteboard" },
    comment: string,
    attachments?: BackendAttachment[],
  ) => Promise<void>;
}

// OpenPad's only job is to locate the text and pass it, verbatim, to the
// agent. The agent already knows how to edit files in the workspace, so we send
// a plain instruction referencing the file, the exact selected text, and the
// user's comment — nothing more.
function buildAnnotationMessage(annotation: Annotation): string {
  return buildMessage(annotation.highlightedText, annotation.comment, annotation.blockIds);
}

// Shared message builder for both the annotation flow and the persistent
// comment bar. `selectionText` may be empty for a document-scoped comment.
function buildMessage(selectionText: string, comment: string, blockIds: string[] = []): string {
  const { documentPath } = useEditorStore.getState();
  const fileRef = documentPath ? `File: ${documentPath}` : "File: (the open document)";
  const hasSelection = selectionText.trim().length > 0;
  const instruction = comment.trim()
    ? comment.trim()
    : hasSelection
      ? "Polish this passage: improve clarity and flow while preserving meaning."
      : "Review this document and improve it.";

  const lines = [fileRef, ""];
  if (hasSelection) {
    lines.push("Selected text:", '"""', selectionText, '"""', "");
    if (blockIds.length > 0) lines.push(`Feishu block IDs: ${blockIds.join(" → ")}`, "");
  }
  lines.push(`Instruction: ${instruction}`);
  if (blockIds.length > 0) {
    lines.push("This is a pulled Feishu working copy. Edit this local file, preserve its block IDs and destination metadata, then use the established lark push/patch workflow when publishing; do not edit a raw mirror.");
  }
  return lines.join("\n");
}

// Message builder for an image / whiteboard reference. The document records the
// asset's workspace-relative path, so we pass that path (the agent can open the
// file). Empty comment falls back to a describe/improve instruction.
function buildImageMessage(
  ref: { path: string; kind: "image" | "whiteboard" },
  comment: string,
): string {
  const { documentPath } = useEditorStore.getState();
  const fileRef = documentPath ? `File: ${documentPath}` : "File: (the open document)";
  const noun = ref.kind === "whiteboard" ? "whiteboard" : "image";
  const instruction = comment.trim()
    ? comment.trim()
    : `Review this ${noun} and improve how the document uses it.`;
  return [
    fileRef,
    "",
    `Referenced ${noun}: ${ref.path}`,
    "",
    `Instruction: ${instruction}`,
  ].join("\n");
}

// Snapshot the document an in-flight revision is aimed at, so the banner can
// name it and offer a jump-back. `scope` distinguishes a highlighted-passage
// revise from a whole-document one. Also captures the document's current HTML
// as the diff baseline so the editor can highlight which blocks the agent
// changes once the file reloads (EXPERIMENTAL).
function markReviseTarget(scope: "selection" | "document"): void {
  const editor = useEditorStore.getState();
  const cwd = useFilesStore.getState().cwd;
  editor.setReviseTargetForCwd(cwd, {
    cwd,
    documentPath: editor.documentPath,
    documentTitle: editor.documentTitle,
    scope,
  });
  editor.beginReviseBaseline();
}

export const useAnnotationStore = create<AnnotationStore>()(
  subscribeWithSelector((set) => ({
    pendingAnnotations: [],

    addAnnotation: (annotation) =>
      set((state) => ({
        pendingAnnotations: [...state.pendingAnnotations, annotation],
      })),

    removePendingAnnotation: (id) =>
      set((state) => ({
        pendingAnnotations: state.pendingAnnotations.filter((a) => a.id !== id),
      })),

    clearPendingAnnotations: () => set({ pendingAnnotations: [] }),

    markAnnotationsSubmitted: (ids) =>
      set((state) => ({
        pendingAnnotations: state.pendingAnnotations.map((a) =>
          ids.includes(a.id) ? { ...a, status: "submitted" as const } : a,
        ),
      })),

    polishAnnotation: async (annotation, attachments) => {
      set((state) => {
        const exists = state.pendingAnnotations.some((a) => a.id === annotation.id);
        const list = exists
          ? state.pendingAnnotations
          : [...state.pendingAnnotations, annotation];
        return {
          pendingAnnotations: list.map((a) =>
            a.id === annotation.id ? { ...a, status: "submitted" as const } : a,
          ),
        };
      });

      // Send through the chat so the exchange shows up in the conversation
      // panel; the agent edits the file itself.
      markReviseTarget("selection");
      await useSessionStore.getState().sendMessage(buildAnnotationMessage(annotation), attachments);
    },

    sendComment: async (comment, selectionText, attachments) => {
      markReviseTarget(selectionText && selectionText.trim() ? "selection" : "document");
      await useSessionStore
        .getState()
        .sendMessage(buildMessage(selectionText ?? "", comment), attachments);
    },

    sendImageComment: async (ref, comment, attachments) => {
      // A referenced asset is a specific target, so treat it like a selection
      // revise (the banner shows the exact document being worked on).
      markReviseTarget("selection");
      await useSessionStore.getState().sendMessage(buildImageMessage(ref, comment), attachments);
    },
  })),
);
