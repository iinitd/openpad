import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { HalfSheet } from "./HalfSheet";
import { SelectableText } from "./SelectableText";
import { THEME } from "../styles/theme";

/** The tap that opens a sheet should be felt, not just seen. */
export function hapticLongPress() {
  if (Platform.OS !== "web") {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

/**
 * A message's text in a half sheet, where a native text view gives real
 * selection: highlight, drag handles and the usual edit menu.
 */
export function SelectableSheet({
  text,
  onClose,
}: {
  text: string;
  onClose: () => void;
}) {
  return (
    <HalfSheet visible title="Text" onClose={onClose}>
      <SelectableText text={text} style={styles.text} />
    </HalfSheet>
  );
}

const styles = {
  text: {
    fontSize: 16,
    lineHeight: 24,
    color: THEME.colors.text,
  },
};
