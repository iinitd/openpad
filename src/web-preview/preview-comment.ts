import { useSessionStore } from "../stores/session-store";
import { useWebPreviewStore } from "./web-preview-store";
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
  const lines = [
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
