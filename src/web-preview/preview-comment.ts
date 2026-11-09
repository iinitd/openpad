import { useSessionStore } from "../stores/session-store";
import { useWebPreviewStore } from "./web-preview-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { renderCommentPrompt } from "../editor/comment-prompt";
import type { BackendAttachment } from "../backend";

export async function sendPreviewComment(
  comment: string,
  selectionText: string | null,
  attachments?: BackendAttachment[],
) {
  const preview = useWebPreviewStore.getState();
  const previewRoot = preview.snapshot?.previewPath || "preview";
  const projectRoot = preview.snapshot?.rootPath || "";
  const selected = selectionText?.trim() || "";
  const instruction = comment.trim() || (selected
    ? "Review this selected preview content and improve it while preserving its meaning."
    : "Review the current web preview and improve it.");
  const template = usePreferencesStore.getState().commentPrompt;
  const rendered = template.trim()
    ? renderCommentPrompt(template, {
        filename: `${previewRoot}/index.html`,
        selection: selected,
      })
    : "";
  const lines = [
    ...(rendered ? [rendered, ""] : []),
    `Preview entry: ${previewRoot}/index.html`,
    projectRoot
      ? `Project root (preview may reference assets anywhere under here): ${projectRoot}/`
      : `Project root (preview may reference assets anywhere under here): <workspace root>`,
    "Locate and edit the source file(s) that produce the rendered content.",
    "",
  ];
  if (selected) lines.push("Rendered selection:", '"""', selected, '"""', "");
  lines.push(`Instruction: ${instruction}`);
  await useSessionStore.getState().sendMessage(lines.join("\n"), attachments);
}
