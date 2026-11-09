import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { HalfSheet } from "./HalfSheet";
import { SelectableText } from "./SelectableText";
import { Icon } from "./Icon";
import { PressableRow } from "./PressableRow";
import { THEME } from "../styles/theme";

/** The tap that opens a sheet should be felt, not just seen. */
export function hapticLongPress() {
  if (Platform.OS !== "web") {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
  }
}

/**
 * A message's text in a half sheet, where a native text view gives real
 * selection: highlight, drag handles and the usual edit menu.
 */
export function SelectableSheet({
  visible,
  text,
  onClose,
}: {
  visible: boolean;
  text: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!visible) setCopied(false);
  }, [visible]);

  return (
    <HalfSheet
      visible={visible}
      title="Message"
      onClose={onClose}
      actions={
        <PressableRow
          style={styles.action}
          haptic="light"
          scale={false}
          onPress={() => {
            void Clipboard.setStringAsync(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
          accessibilityRole="button"
          accessibilityLabel="Copy message"
        >
          <Icon
            name="copy"
            size={14}
            color={copied ? THEME.colors.success : THEME.colors.textSecondary}
          />
          <Text style={[styles.actionText, copied && styles.actionTextDone]}>
            {copied ? "Copied" : "Copy"}
          </Text>
        </PressableRow>
      }
    >
      <SelectableText text={text} style={styles.text} />
    </HalfSheet>
  );
}

const styles = StyleSheet.create({
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: THEME.colors.surface,
  },
  actionText: {
    fontSize: 13,
    fontWeight: "500",
    color: THEME.colors.textSecondary,
  },
  actionTextDone: {
    color: THEME.colors.success,
  },
  text: {
    fontSize: 16,
    lineHeight: 24,
    color: THEME.colors.text,
  },
});
