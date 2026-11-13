import { memo, useState } from "react";
import { Alert, View, Text, TouchableOpacity, StyleSheet, TextInput } from "react-native";
import { useSessionStore } from "../stores/session-store";
import { useConnectionStore } from "../stores/connection-store";
import {
  COMPOSER_PLACEHOLDER,
  ComposerField,
  toBackendAttachments,
  usePendingImages,
} from "../components/ComposerField";
import { hapticTap } from "../components/PressableRow";
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
  const editQueued = useSessionStore((s) => s.editQueued);
  const sendQueuedNow = useSessionStore((s) => s.sendQueuedNow);
  const [text, setText] = useState("");
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
  const [editingQueuedText, setEditingQueuedText] = useState("");
  const pending = usePendingImages();
  const backendKind = useConnectionStore((state) => state.client?.kind);
  // Only the OpenCode backend accepts attachments. A turn in flight no longer
  // blocks picking one: the image waits in the queue with its message and goes
  // out when the run ends.
  const canAttach = backendKind === "opencode" && !!agentId;

  async function handleSend() {
    const trimmed = text.trim();
    const outgoing = toBackendAttachments(pending.images);
    if ((!trimmed && !outgoing) || !agentId) return;

    // Clear the composer first: the transcript shows the message as soon as
    // sendMessage starts, and an image upload keeps the request busy for a
    // moment. Clearing afterwards left the same text in both places.
    const draft = text;
    const images = pending.images;
    setText("");
    pending.clear();
    try {
      // sendMessage transparently queues the message if a turn is already
      // running, so the user can fire off several in a row.
      await sendMessage(trimmed, outgoing);
    } catch (error) {
      // Put the draft and the images back so a failed send can be retried.
      setText(draft);
      pending.restore(images);
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
          <Text style={styles.queueTitle}>Queued</Text>
          {queued.map((q, index) => {
            const editing = editingQueuedId === q.id;
            return (
              <View key={q.id} style={styles.queueChip}>
                <View style={styles.queueChipBody}>
                  {editing ? (
                    <TextInput
                      style={styles.queueEditInput}
                      value={editingQueuedText}
                      onChangeText={setEditingQueuedText}
                      multiline
                      autoFocus
                      placeholder="Edit queued message"
                      placeholderTextColor={THEME.colors.textMuted}
                    />
                  ) : (
                    <Text style={styles.queueChipText} numberOfLines={3}>
                      {q.text.trim() ||
                        (q.attachments?.length
                          ? q.attachments.length === 1
                            ? "Image"
                            : `${q.attachments.length} images`
                          : "")}
                    </Text>
                  )}
                  <Text style={styles.queueMeta}>{index === 0 ? "Next" : `#${index + 1}`}</Text>
                </View>
                <View style={styles.queueActions}>
                  {editing ? (
                    <>
                      <TouchableOpacity
                        style={styles.queueAction}
                        onPress={() => {
                          hapticTap("light");
                          const trimmed = editingQueuedText.trim();
                          if (trimmed) editQueued(q.id, trimmed);
                          setEditingQueuedId(null);
                          setEditingQueuedText("");
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Save queued message"
                      >
                        <Text style={styles.queueActionText}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.queueAction}
                        onPress={() => {
                          hapticTap("light");
                          setEditingQueuedId(null);
                          setEditingQueuedText("");
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel editing queued message"
                      >
                        <Text style={styles.queueActionText}>Cancel</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={styles.queueAction}
                        onPress={() => {
                          hapticTap("light");
                          setEditingQueuedId(q.id);
                          setEditingQueuedText(q.text);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Edit queued message"
                      >
                        <Text style={styles.queueActionText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.queueAction}
                        onPress={() => {
                          hapticTap("light");
                          void sendQueuedNow(q.id);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Send queued message now"
                      >
                        <Text style={styles.queueActionText}>Send now</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  <TouchableOpacity
                    style={styles.queueRemove}
                    onPress={() => {
                      hapticTap("light");
                      if (editingQueuedId === q.id) {
                        setEditingQueuedId(null);
                        setEditingQueuedText("");
                      }
                      removeQueued(q.id);
                    }}
                    hitSlop={8}
                    accessibilityLabel="Remove queued message"
                  >
                    <Text style={styles.queueRemoveText}>×</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
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
    gap: 8,
    marginBottom: THEME.spacing.sm,
  },
  queueTitle: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.08,
    textTransform: "uppercase",
    color: THEME.colors.textMuted,
    marginBottom: 2,
  },
  // Waiting messages echo the transcript: a bubble on your side of the
  // conversation, in grey because it has not gone out yet.
  queueChip: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: THEME.spacing.sm,
    backgroundColor: THEME.colors.surface,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
    paddingLeft: THEME.spacing.md,
    paddingRight: 8,
    paddingVertical: 8,
  },
  queueChipBody: {
    flex: 1,
    gap: 4,
  },
  queueChipText: {
    fontSize: 14,
    lineHeight: 20,
    color: THEME.colors.textSecondary,
  },
  queueMeta: {
    fontSize: 11,
    color: THEME.colors.textMuted,
  },
  queueEditInput: {
    minHeight: 40,
    fontSize: 14,
    lineHeight: 20,
    color: THEME.colors.text,
    padding: 0,
  },
  queueActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 6,
    maxWidth: 190,
  },
  queueAction: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  queueActionText: {
    fontSize: 12,
    fontWeight: "500",
    color: THEME.colors.textSecondary,
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
