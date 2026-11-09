/**
 * File-comment prompt template. The prompt written in Settings is prepended to
 * the message sent when the user comments on a file or quotes a passage; the
 * two placeholders carry the context that used to be assembled in code.
 */

export const COMMENT_PROMPT_PLACEHOLDERS = ["{filename}", "{selected_text}"] as const;

export function renderCommentPrompt(
  template: string,
  context: { filename: string; selection: string },
): string {
  const trimmed = template.trim();
  if (!trimmed) return "";
  const selection = context.selection.trim();
  let text = trimmed
    .replace(/\{filename\}/gi, context.filename)
    .replace(/\{selected_text\}/gi, selection);

  if (!selection) {
    // An empty placeholder leaves a heading and a pair of quote fences behind;
    // drop them so a document-level comment does not arrive with an empty block.
    text = text
      .split("\n")
      .filter((line) => {
        const value = line.trim();
        if (/^selected text:?$/i.test(value)) return false;
        if (value === '"""') return false;
        return true;
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  }

  return text.trim();
}
