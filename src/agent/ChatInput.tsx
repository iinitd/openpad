import { memo, useState } from "react";
import { Alert, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useSessionStore } from "../stores/session-store";
import { useConnectionStore } from "../stores/connection-store";
import {
  COMPOSER_PLACEHOLDER,
  ComposerField,
  toBackendAttachments,
  usePendingImages,
} from "../components/ComposerField";
import { THEME } from "../styles/theme";
import { isWeb } from "../constants/platform";

export const ChatInput = memo(function ChatInput({
  // "standalone" (default) draws its own bordered footer for the desktop chat
  // pane. "embedded" drops the top border / background so it can sit inside the
  // mobile floating dock, which already supplies the surface.
  variant = "standalone",
}: {
  variant?: "standalone" | "embedded";
} = {}) {
  const sendMessage = useSessionStore((state) => state.sendMessage);
  const cancelAgent = useSessionStore((state) => state.cancelAgent);
  const isStreaming = useSessionStore((state) => state.isStreaming);
  const agentId = useSessionStore((state) => state.agentId);
  const queued = useSessionStore((s) => s.queued);
  const removeQueued = useSessionStore((s) => s.removeQueued);
  const [text, setText] = useState("");
  const pending = usePendingImages();
  const backendKind = useConnectionStore((state) => state.client?.kind);
  // Only the OpenCode backend accepts attachments, and the queue is text-only,
  // so an image can only go out while the session is idle.
  const canAttach = backendKind === "opencode" && !isStreaming && !!agentId;

  async function handleSend() {
    const trimmed = text.trim();
    const outgoing = toBackendAttachments(pending.images);
    if ((!trimmed && !outgoing) || !agentId) return;

    try {
      // sendMessage transparently queues the message if a turn is already
      // running, so the user can fire off several in a row.
      await sendMessage(trimmed, outgoing);
      setText("");
      pending.clear();
    } catch (error) {
      // Keep the draft and the images so a failed send can be retried.
      if (outgoing) {
        Alert.alert("Image not sent", error instanceof Error ? error.message : "Try again.");
      }
    }
  }

  async function handleCancel() {
    try {
      await cancelAgent();
    } catch {
      // Ignore
    }
  }

  // Enter sends; it never inserts a newline. On web we intercept the keydown
  // before react-native-web's textarea inserts the "\n" (and skip while an IME
  // composition is active, so committing Chinese/Japanese candidates with Enter
  // doesn't fire a send). Shift+Enter still adds a newline. On native the same
  // behaviour comes from submitBehavior="submit" (Enter submits, keeps focus,
  // no newline), wired on the TextInput below.
  function handleKeyPress(e: {
    nativeEvent: { key?: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number };
    preventDefault?: () => void;
  }) {
    if (!isWeb) return;
    const ne = e.nativeEvent;
    if (ne.key === "Enter" && !ne.shiftKey && !ne.isComposing && ne.keyCode !== 229) {
      e.preventDefault?.();
      void handleSend();
    }
  }

  return (
    <View style={variant === "embedded" ? styles.containerEmbedded : styles.container}>
      {queued.length > 0 ? (
        <View style={styles.queueList}>
          {queued.length > 1 ? (
            <Text style={styles.queueHint}>
              {queued.length} messages queued · will send together after the current reply
            </Text>
          ) : (
            <Text style={styles.queueHint}>Queued · will send after the current reply</Text>
          )}
          {queued.map((q) => (
            <View key={q.id} style={styles.queueChip}>
              <Text style={styles.queueChipText} numberOfLines={2}>
                {q.text}
              </Text>
              <TouchableOpacity
                style={styles.queueRemove}
                onPress={() => removeQueued(q.id)}
                hitSlop={8}
                accessibilityLabel="Remove queued message"
              >
                <Text style={styles.queueRemoveText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
      <ComposerField
        variant={variant}
        value={text}
        onChangeText={setText}
        onSend={handleSend}
        onKeyPress={handleKeyPress}
        placeholder={COMPOSER_PLACEHOLDER}
        editable={!!agentId}
        images={pending.images}
        onRemoveImage={pending.remove}
        onPickImage={canAttach ? pending.pick : undefined}
        pickingImage={pending.picking}
        onStop={handleCancel}
        stopVisible={isStreaming}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: THEME.spacing.lg,
    paddingVertical: THEME.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: THEME.colors.border,
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  // Inside the dock: no chrome (the dock card owns the surface/border).
  containerEmbedded: {
    gap: THEME.spacing.xs,
  },
  queueList: {
    gap: THEME.spacing.xs,
    marginBottom: THEME.spacing.xs,
  },
  queueHint: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    paddingHorizontal: THEME.spacing.xs,
  },
  queueChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
    paddingLeft: THEME.spacing.md,
    paddingRight: 6,
    paddingVertical: 6,
  },
  queueChipText: {
    flex: 1,
    fontSize: 15,
    color: THEME.colors.text,
  },
  queueRemove: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(148,163,184,0.2)",
  },
  queueRemoveText: {
    fontSize: 17,
    lineHeight: 17,
    color: THEME.colors.textSecondary,
    fontWeight: "600",
  },
});
