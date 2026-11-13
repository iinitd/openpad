import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { Icon } from "./Icon";
import { ImageViewer } from "./ImageViewer";
import { hapticTap } from "./PressableRow";
import { PressableRow } from "./PressableRow";
import {
  COMPACT_COMPOSER_ICON_SIZE,
  COMPACT_COMPOSER_STYLES,
} from "./compact-composer-styles";
import type { BackendAttachment } from "../backend";
import { useConnectionStore } from "../stores/connection-store";
import { THEME } from "../styles/theme";
import { isWeb } from "../constants/platform";

/**
 * The composer addresses the server it talks to: "Talk to Bloop". The name is
 * the one chosen when the connection was added, so the field reads as the
 * conversation it belongs to rather than as a generic prompt.
 */
export function useComposerPlaceholder(): string {
  const name = useConnectionStore((state) => {
    const saved = state.savedConnections.find(
      (entry) => entry.id === state.activeConnectionId,
    );
    return saved?.alias?.trim() ?? "";
  });
  return name ? `Talk to ${name}…` : "Talk to Puff…";
}

export interface PendingImage {
  id: string;
  name: string;
  mime: string;
  base64: string;
  uri: string;
}

export async function pickImageAttachment(): Promise<PendingImage | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    quality: 0.8,
    base64: true,
  });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) return null;
  const base64 = asset.base64 ?? (await new File(asset.uri).base64());
  return {
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: asset.fileName ?? `image-${Date.now()}.jpg`,
    mime: asset.mimeType ?? "image/jpeg",
    base64,
    uri: asset.uri,
  };
}

/** Images waiting to be sent from one composer. */
export function usePendingImages() {
  const [images, setImages] = useState<PendingImage[]>([]);
  const [picking, setPicking] = useState(false);

  const pick = useCallback(async () => {
    if (picking) return;
    setPicking(true);
    try {
      const image = await pickImageAttachment();
      if (image) setImages((prev) => [...prev, image]);
    } catch {
      Alert.alert("Could not attach image", "The image could not be read. Try another one.");
    } finally {
      setPicking(false);
    }
  }, [picking]);

  const remove = useCallback((id: string) => {
    setImages((prev) => prev.filter((image) => image.id !== id));
  }, []);

  const clear = useCallback(() => setImages([]), []);
  // Put a failed send's images back into the strip.
  const restore = useCallback((next: PendingImage[]) => setImages(next), []);

  return { images, picking, pick, remove, clear, restore };
}

export function toBackendAttachments(images: PendingImage[]): BackendAttachment[] | undefined {
  if (images.length === 0) return undefined;
  return images.map(({ name, mime, base64 }) => ({ name, mime, base64 }));
}

interface ComposerFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  placeholder: string;
  editable?: boolean;
  variant?: "standalone" | "embedded";
  sendDisabled?: boolean;
  images: PendingImage[];
  onRemoveImage: (id: string) => void;
  onPickImage?: () => void;
  pickingImage?: boolean;
  onKeyPress?: (event: {
    nativeEvent: { key?: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number };
    preventDefault?: () => void;
  }) => void;
  secondaryAction?: { label: string; onPress: () => void; disabled: boolean };
  onStop?: () => void;
  stopVisible?: boolean;
}

/**
 * The composer shared by the chat pane and the document comment bar: one text
 * field, one send affordance, and the same image attachment strip. Callers keep
 * their own draft state and own what "send" means — the chat pane dispatches to
 * the session, the document bar adds the document context around the comment.
 */
export function ComposerField({
  value,
  onChangeText,
  onSend,
  placeholder,
  editable = true,
  variant = "standalone",
  sendDisabled,
  images,
  onRemoveImage,
  onPickImage,
  pickingImage = false,
  onKeyPress,
  secondaryAction,
  onStop,
  stopVisible = false,
}: ComposerFieldProps) {
  const disabled = sendDisabled ?? (!value.trim() && images.length === 0);

  // The field grows with the text up to three lines, then scrolls inside the
  // same box. Below the threshold the composer stays a pill; past it, the pill
  // becomes a rounded rectangle so the text has a straight edge to live against.
  const minInputHeight = variant === "embedded" ? 40 : 36;
  const maxInputHeight = variant === "embedded" ? 84 : 82;
  const verticalPadding = variant === "embedded" ? 18 : 8;
  const horizontalPadding = variant === "embedded" ? 8 : 14;
  // A hidden copy of the text measures the wrapped height. `contentSize` on the
  // input itself only tracks explicit newlines reliably once the field has a
  // fixed height, so long single lines that wrap visually were never counted.
  const [fieldWidth, setFieldWidth] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  // Which pending image is open full-screen, if any.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // Sending clears the strip while the viewer may still be up; close it rather
  // than leave an index pointing at an image that no longer exists.
  useEffect(() => {
    if (viewerIndex !== null && viewerIndex >= images.length) setViewerIndex(null);
  }, [images.length, viewerIndex]);
  const inputHeight = Math.min(
    maxInputHeight,
    Math.max(minInputHeight, contentHeight + verticalPadding),
  );
  const expanded = inputHeight > minInputHeight + 1;

  return (
    <View style={variant === "embedded" ? styles.embeddedRow : styles.row}>
      {fieldWidth > 0 ? (
        <Text
          pointerEvents="none"
          style={[styles.measure, { width: Math.max(1, fieldWidth - horizontalPadding) }]}
          onLayout={(event) => {
            const height = Math.ceil(event.nativeEvent.layout.height);
            if (height !== contentHeight) setContentHeight(height);
          }}
        >
          {value || " "}
        </Text>
      ) : null}
      {images.length > 0 ? (
        <View style={styles.attachmentRow}>
          {images.map((image, index) => (
            <View key={image.id} style={styles.attachmentThumbWrap}>
              <Pressable
                onPress={() => {
                  hapticTap("light");
                  setViewerIndex(index);
                }}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Open image ${index + 1} of ${images.length}`}
              >
                <Image source={{ uri: image.uri }} style={styles.attachmentThumb} />
              </Pressable>
              <TouchableOpacity
                style={styles.attachmentRemove}
                onPress={() => {
                  hapticTap("light");
                  onRemoveImage(image.id);
                }}
                hitSlop={8}
                accessibilityLabel="Remove image"
              >
                <Text style={styles.attachmentRemoveText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.pillRow}>
        <View
          style={[
            variant === "embedded"
              ? [COMPACT_COMPOSER_STYLES.pill, styles.pillFill]
              : styles.pill,
            { alignItems: expanded ? "flex-end" : "center" },
            expanded && styles.pillExpanded,
          ]}
        >
          {onPickImage ? (
            <TouchableOpacity
              style={styles.attachButton}
              onPress={() => {
                hapticTap("light");
                onPickImage?.();
              }}
              disabled={pickingImage || !editable}
              hitSlop={8}
              accessibilityLabel="Attach image"
            >
              <Icon name="image" size={17} color={THEME.colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
          <TextInput
            style={[
              variant === "embedded"
                ? [COMPACT_COMPOSER_STYLES.input, styles.inputWeb]
                : styles.input,
              { height: inputHeight, maxHeight: maxInputHeight },
            ]}
            onLayout={(event) => {
              const width = Math.ceil(event.nativeEvent.layout.width);
              if (width > 0 && width !== fieldWidth) setFieldWidth(width);
            }}
            // Keep scrolling enabled at all times: with a clamped height the
            // text view follows the caret, which is what makes a long draft
            // readable while typing.
            scrollEnabled
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={THEME.colors.textMuted}
            multiline
            editable={editable}
            onSubmitEditing={onSend}
            onKeyPress={onKeyPress}
            submitBehavior="submit"
            returnKeyType="send"
          />
          <PressableRow
            style={[
              variant === "embedded" ? COMPACT_COMPOSER_STYLES.send : styles.send,
              disabled && (
                variant === "embedded" ? COMPACT_COMPOSER_STYLES.sendDisabled : styles.sendDisabled
              ),
            ]}
            onPress={onSend}
            disabled={disabled}
            haptic="medium"
            scale={0.92}
          >
            <View style={variant === "embedded" ? COMPACT_COMPOSER_STYLES.sendInner : styles.sendInner}>
              <Icon
                name="send"
                size={variant === "embedded" ? COMPACT_COMPOSER_ICON_SIZE : 16}
                color={disabled ? THEME.colors.textMuted : "#ffffff"}
              />
            </View>
          </PressableRow>
          {secondaryAction ? (
            <PressableRow
              style={[styles.secondaryAction, secondaryAction.disabled && styles.secondaryActionDisabled]}
              onPress={secondaryAction.onPress}
              disabled={secondaryAction.disabled}
              haptic="light"
              scale={0.95}
            >
              <Text style={styles.secondaryActionText}>{secondaryAction.label}</Text>
            </PressableRow>
          ) : null}
        </View>
        {stopVisible && onStop ? (
          <TouchableOpacity
            style={[styles.cancelButton, variant === "embedded" && styles.cancelButtonEmbedded]}
            onPress={onStop}
            hitSlop={6}
            accessibilityLabel="Stop generating"
          >
            <Icon name="stop" size={16} color={THEME.colors.error} />
          </TouchableOpacity>
        ) : null}
      </View>
      <ImageViewer
        images={images.map((image) => image.uri)}
        index={viewerIndex}
        onClose={() => setViewerIndex(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: THEME.spacing.xs,
  },
  embeddedRow: {
    gap: 3,
  },
  pillRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },
  pill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radii.full,
    paddingLeft: THEME.spacing.md,
    paddingRight: 6,
    paddingVertical: 6,
  },
  pillFill: {
    flex: 1,
  },
  pillExpanded: {
    borderRadius: THEME.radii.xl,
  },
  measure: {
    position: "absolute",
    left: -10000,
    top: 0,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: THEME.fonts.sans,
  },
  input: {
    flex: 1,
    paddingHorizontal: 7,
    paddingVertical: 4,
    fontSize: 16,
    lineHeight: 22,
    color: THEME.colors.text,
    ...(isWeb ? { outlineStyle: "none" as unknown as undefined } : null),
  },
  inputWeb: {
    ...(isWeb ? { outlineStyle: "none" as unknown as undefined } : null),
  },
  attachButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
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
    backgroundColor: "rgba(24,24,27,0.06)",
  },
  secondaryAction: {
    height: 32,
    paddingHorizontal: THEME.spacing.md,
    borderRadius: THEME.radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: THEME.colors.accentSoft,
    marginLeft: 6,
  },
  secondaryActionDisabled: {
    opacity: 0.5,
  },
  secondaryActionText: {
    fontSize: 13,
    fontWeight: "600",
    color: THEME.colors.accent,
  },
  cancelButton: {
    width: 32,
    height: 32,
    borderRadius: THEME.radii.full,
    backgroundColor: THEME.colors.surface,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  cancelButtonEmbedded: {
    width: 30,
    height: 30,
  },
  attachmentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: THEME.spacing.sm,
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
    fontSize: 15,
    lineHeight: 15,
    fontWeight: "600",
  },
});
