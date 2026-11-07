import { memo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { PressableRow } from "../components/PressableRow";
import { ComposerField, toBackendAttachments, usePendingImages } from "../components/ComposerField";
import { useEditorStore } from "../stores/editor-store";
import { useConnectionStore } from "../stores/connection-store";
import { useSessionStore } from "../stores/session-store";
import type { BackendAttachment } from "../backend";
import { THEME } from "../styles/theme";
import { isWeb } from "../constants/platform";

interface DocumentCommentBarProps {
  // The currently-highlighted passage, if any. When present it's shown as a
  // context chip and passed to the agent along with the comment; when null the
  // comment applies to the whole document.
  selectionText: string | null;
  // A tapped image / whiteboard reference, if any. Mutually exclusive with a
  // text selection: it's shown as a distinct chip and routed to the agent as an
  // asset reference by the caller.
  imageRef?: { label: string; kind: "image" | "whiteboard" } | null;
  // Send the comment to the agent. `selectionText` (or null) is attached by the
  // caller, together with any images picked in the bar.
  onSend: (comment: string, attachments?: BackendAttachment[]) => void | Promise<void>;
  secondaryAction?: {
    label: string;
    onSend: (comment: string, attachments?: BackendAttachment[]) => void | Promise<void>;
  };
  // Clear the active selection (dismiss the context chip without sending).
  onClearSelection?: () => void;
  // "standalone" (default) draws its own padded footer for the desktop editor.
  // "embedded" drops the outer chrome so it can be stacked inside the mobile
  // floating dock directly above the tab bar.
  variant?: "standalone" | "embedded";
}

// A persistent bar for commenting on the document. It's always available: with
// a selection it carries the highlighted passage as context, without one it
// sends a document-scoped comment. Typing here never spawns a separate popover —
// the input is inline. It shares its field with the chat composer; the
// difference is the document context wrapped around whatever it sends.
export const DocumentCommentBar = memo(function DocumentCommentBar({
  selectionText,
  imageRef,
  onSend,
  secondaryAction,
  onClearSelection,
  variant = "standalone",
}: DocumentCommentBarProps) {
  // The draft lives in the editor store, not local state, so an AI revise that
  // reloads the document mid-typing can't wipe what the user has typed. Worst
  // case the highlighted reference clears; the text stays put.
  const comment = useEditorStore((s) => s.commentDraft);
  const setComment = useEditorStore((s) => s.setCommentDraft);
  const pending = usePendingImages();
  const backendKind = useConnectionStore((state) => state.client?.kind);
  const isStreaming = useSessionStore((state) => state.isStreaming);
  const canAttach = backendKind === "opencode" && !isStreaming;
  const hasSelection = !!selectionText && selectionText.trim().length > 0;
  const hasImageRef = !!imageRef;
  // Either kind of reference (text, asset, or an attached image) lets an empty
  // comment through with a default instruction.
  const hasRef = hasSelection || hasImageRef || pending.images.length > 0;
  const sendDisabled = !comment.trim() && !hasRef;

  const submit = async () => {
    if (sendDisabled) return;
    const trimmed = comment.trim();
    const attachments = toBackendAttachments(pending.images);
    try {
      await onSend(trimmed, attachments);
      setComment("");
      pending.clear();
    } catch {
      // Keep the draft and the images when the send fails.
    }
  };

  // Same Enter-to-send behaviour as the chat composer: intercept before the
  // web textarea inserts a newline, and leave IME composition alone.
  const handleKeyPress = (e: {
    nativeEvent: { key?: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number };
    preventDefault?: () => void;
  }) => {
    if (!isWeb) return;
    const ne = e.nativeEvent;
    if (ne.key === "Enter" && !ne.shiftKey && !ne.isComposing && ne.keyCode !== 229) {
      e.preventDefault?.();
      void submit();
    }
  };

  const submitSecondary = async () => {
    if (sendDisabled || !secondaryAction) return;
    const trimmed = comment.trim();
    const attachments = toBackendAttachments(pending.images);
    try {
      await secondaryAction.onSend(trimmed, attachments);
      setComment("");
      pending.clear();
    } catch {
      // Keep the draft and the images when the send fails.
    }
  };

  return (
    <View style={variant === "embedded" ? styles.barEmbedded : styles.bar}>
      {hasSelection ? (
        <View style={styles.chipRow}>
          <Text style={styles.chipQuote}>“</Text>
          <Text style={styles.chipText} numberOfLines={1}>
            {selectionText}
          </Text>
          {onClearSelection ? (
            <PressableRow onPress={onClearSelection} hitSlop={8} haptic="light" scale={0.9}>
              <Text style={styles.chipClear}>✕</Text>
            </PressableRow>
          ) : null}
        </View>
      ) : hasImageRef ? (
        <View style={[styles.chipRow, styles.chipRowAsset]}>
          <Text style={styles.chipAssetIcon}>
            {imageRef!.kind === "whiteboard" ? "▧" : "▦"}
          </Text>
          <Text style={[styles.chipText, styles.chipTextAsset]} numberOfLines={1}>
            {imageRef!.label}
          </Text>
          {onClearSelection ? (
            <PressableRow onPress={onClearSelection} hitSlop={8} haptic="light" scale={0.9}>
              <Text style={[styles.chipClear, styles.chipClearAsset]}>✕</Text>
            </PressableRow>
          ) : null}
        </View>
      ) : null}
      <ComposerField
        variant={variant}
        value={comment}
        onChangeText={setComment}
        onSend={() => void submit()}
        onKeyPress={handleKeyPress}
        placeholder={
          hasImageRef
            ? imageRef!.kind === "whiteboard"
              ? "对这块白板说点什么…"
              : "对这张图片说点什么…"
            : hasSelection
              ? "对选中内容说点什么…"
              : "点击输入，评论这篇文档…"
        }
        sendDisabled={sendDisabled}
        images={pending.images}
        onRemoveImage={pending.remove}
        onPickImage={canAttach ? pending.pick : undefined}
        pickingImage={pending.picking}
        secondaryAction={
          secondaryAction
            ? { label: secondaryAction.label, onPress: () => void submitSecondary(), disabled: sendDisabled }
            : undefined
        }
      />
    </View>
  );
});

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: THEME.spacing.md,
    paddingTop: THEME.spacing.sm,
    paddingBottom: THEME.spacing.md,
    backgroundColor: "transparent",
    gap: THEME.spacing.xs,
  },
  // Inside the dock: no outer padding/background (the dock provides both), and
  // the input pill is flat (no shadow/border) since it shares the dock card.
  barEmbedded: {
    gap: THEME.spacing.xs,
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    maxWidth: "100%",
    backgroundColor: "#fef9c3",
    borderRadius: THEME.radii.full,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: 5,
    marginLeft: THEME.spacing.xs,
  },
  chipQuote: {
    fontSize: 13,
    color: "#a16207",
    fontWeight: "700",
  },
  chipText: {
    flexShrink: 1,
    fontSize: 12,
    color: "#713f12",
  },
  chipClear: {
    fontSize: 12,
    color: "#92400e",
    fontWeight: "700",
    paddingLeft: 4,
  },
  // Asset (image / whiteboard) reference chip — a cool slate tint to read
  // distinctly from the yellow text-selection chip.
  chipRowAsset: {
    backgroundColor: "#e2e8f0",
  },
  chipAssetIcon: {
    fontSize: 13,
    color: "#475569",
  },
  chipTextAsset: {
    color: "#334155",
  },
  chipClearAsset: {
    color: "#475569",
  },
});
