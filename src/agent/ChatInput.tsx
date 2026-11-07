import { memo, useRef, useState } from "react";
import { View, TextInput, TouchableOpacity, StyleSheet, Text, Image, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { useSessionStore } from "../stores/session-store";
import { useConnectionStore } from "../stores/connection-store";
import { Icon } from "../components/Icon";
import { PressableRow } from "../components/PressableRow";
import {
  COMPACT_COMPOSER_ICON_SIZE,
  COMPACT_COMPOSER_STYLES,
} from "../components/compact-composer-styles";
import { THEME } from "../styles/theme";
import { isWeb } from "../constants/platform";

interface PendingImage {
  id: string;
  name: string;
  mime: string;
  base64: string;
  uri: string;
}

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
  const [images, setImages] = useState<PendingImage[]>([]);
  const [picking, setPicking] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const backendKind = useConnectionStore((state) => state.client?.kind);
  // Only the OpenCode backend accepts attachments, and the queue is text-only,
  // so an image can only go out while the session is idle.
  const canAttach = backendKind === "opencode" && !isStreaming && !!agentId;

  async function handleAttach() {
    if (!canAttach || picking) return;
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 0.8,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      const base64 = asset.base64 ?? (await new File(asset.uri).base64());
      setImages((prev) => [
        ...prev,
        {
          id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: asset.fileName ?? `image-${prev.length + 1}.jpg`,
          mime: asset.mimeType ?? "image/jpeg",
          base64,
          uri: asset.uri,
        },
      ]);
    } catch {
      Alert.alert("Could not attach image", "The image could not be read. Try another one.");
    } finally {
      setPicking(false);
    }
  }

  async function handleSend() {
    const trimmed = text.trim();
    const outgoing = images.map(({ name, mime, base64 }) => ({ name, mime, base64 }));
    if ((!trimmed && outgoing.length === 0) || !agentId) return;

    const previousImages = images;
    setText("");
    setImages([]);
    try {
      // sendMessage transparently queues the message if a turn is already
      // running, so the user can fire off several in a row.
      await sendMessage(trimmed, outgoing.length > 0 ? outgoing : undefined);
    } catch (error) {
      // Keep the draft and the images so a failed send can be retried.
      setText(trimmed);
      setImages(previousImages);
      if (outgoing.length > 0) {
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
      {images.length > 0 ? (
        <View style={styles.attachmentRow}>
          {images.map((image) => (
            <View key={image.id} style={styles.attachmentThumbWrap}>
              <Image source={{ uri: image.uri }} style={styles.attachmentThumb} />
              <TouchableOpacity
                style={styles.attachmentRemove}
                onPress={() => setImages((prev) => prev.filter((item) => item.id !== image.id))}
                hitSlop={8}
                accessibilityLabel="Remove image"
              >
                <Text style={styles.attachmentRemoveText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.inputRow}>
        {/* Pill-shaped composer matching the document comment bubble: a rounded
            surface field with the send affordance as a round button inside. */}
        <View
          style={variant === "embedded"
            ? [COMPACT_COMPOSER_STYLES.pill, styles.pillFill]
            : styles.pill}
        >
          {canAttach ? (
            <TouchableOpacity
              style={styles.attachButton}
              onPress={handleAttach}
              disabled={picking}
              hitSlop={8}
              accessibilityLabel="Attach image"
            >
              <Icon name="image" size={17} color={THEME.colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
          <TextInput
            ref={inputRef}
            style={variant === "embedded"
              ? [COMPACT_COMPOSER_STYLES.input, styles.inputWeb]
              : styles.input}
            value={text}
            onChangeText={setText}
            placeholder={agentId ? "Ask the AI..." : "Create a session first"}
            placeholderTextColor={THEME.colors.textMuted}
            multiline
            editable={!!agentId}
            onSubmitEditing={handleSend}
            onKeyPress={handleKeyPress}
            submitBehavior="submit"
            returnKeyType="send"
          />
          {/* Send is always available (even mid-turn) so messages can be queued. */}
          <PressableRow
            style={[
              variant === "embedded" ? COMPACT_COMPOSER_STYLES.send : styles.send,
              ((!text.trim() && images.length === 0) || !agentId) && (
                variant === "embedded" ? COMPACT_COMPOSER_STYLES.sendDisabled : styles.sendDisabled
              ),
            ]}
            onPress={handleSend}
            disabled={(!text.trim() && images.length === 0) || !agentId}
            haptic="medium"
            scale={0.92}
          >
            <View style={variant === "embedded" ? COMPACT_COMPOSER_STYLES.sendInner : styles.sendInner}>
              <Icon
                name="send"
                size={variant === "embedded" ? COMPACT_COMPOSER_ICON_SIZE : 16}
                color="#fff"
              />
            </View>
          </PressableRow>
        </View>
        {/* Stop shows alongside the pill while a turn is running. */}
        {isStreaming ? (
          <TouchableOpacity
            style={[styles.cancelButton, variant === "embedded" && styles.cancelButtonEmbedded]}
            onPress={handleCancel}
            hitSlop={6}
            accessibilityLabel="Stop generating"
          >
            <Icon name="stop" size={16} color="#fff" />
          </TouchableOpacity>
        ) : null}
      </View>
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
    gap: 3,
  },
  queueList: {
    gap: THEME.spacing.xs,
    marginBottom: THEME.spacing.xs,
  },
  queueHint: {
    fontSize: 11,
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
    fontSize: 13,
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
    fontSize: 15,
    lineHeight: 17,
    color: THEME.colors.textSecondary,
    fontWeight: "600",
  },
  attachmentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: THEME.spacing.sm,
    marginBottom: THEME.spacing.xs,
    paddingHorizontal: THEME.spacing.xs,
  },
  attachmentThumbWrap: {
    position: "relative",
  },
  attachmentThumb: {
    width: 56,
    height: 56,
    borderRadius: THEME.radii.md,
    backgroundColor: THEME.colors.surface,
  },
  attachmentRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,23,42,0.82)",
  },
  attachmentRemoveText: {
    color: "#ffffff",
    fontSize: 13,
    lineHeight: 15,
    fontWeight: "600",
  },
  attachButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },
  // Rounded composer pill (standalone: floating with border + shadow), mirroring
  // the document comment bubble so the two inputs read as the same component.
  pill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: THEME.radii.full,
    paddingLeft: THEME.spacing.md,
    paddingRight: 6,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(148,163,184,0.35)",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  pillFill: {
    flex: 1,
  },
  input: {
    flex: 1,
    paddingHorizontal: 7,
    paddingVertical: 4,
    fontSize: 14,
    color: THEME.colors.text,
    maxHeight: 88,
    // Kill react-native-web's native focus outline on the underlying textarea.
    ...(isWeb ? { outlineStyle: "none" as unknown as undefined } : null),
  },
  inputWeb: {
    ...(isWeb ? { outlineStyle: "none" as unknown as undefined } : null),
  },
  send: {
    width: 32,
    height: 32,
    borderRadius: THEME.radii.full,
    backgroundColor: THEME.colors.primary,
    overflow: "hidden",
  },
  sendInner: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: {
    backgroundColor: "rgba(148,163,184,0.4)",
  },
  cancelButton: {
    width: 32,
    height: 32,
    borderRadius: THEME.radii.full,
    backgroundColor: THEME.colors.error,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  cancelButtonEmbedded: {
    width: 30,
    height: 30,
  },
});
