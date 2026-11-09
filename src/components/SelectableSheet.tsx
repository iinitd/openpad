import { useEffect, useState } from "react";
import { Platform, StyleSheet } from "react-native";
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
      headerActions={
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
          accessibilityLabel={copied ? "Copied" : "Copy message"}
        >
          <Icon
            name={copied ? "check" : "copy"}
            size={16}
            color={THEME.colors.textSecondary}
          />
        </PressableRow>
      }
    >
      <SelectableText text={text} style={styles.text} />
    </HalfSheet>
  );
}

const styles = StyleSheet.create({
  action: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontSize: 16,
    lineHeight: 24,
    color: THEME.colors.text,
  },
});
