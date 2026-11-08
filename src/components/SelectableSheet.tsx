import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { HalfSheet } from "./HalfSheet";
import { SelectableText } from "./SelectableText";
import { THEME } from "../styles/theme";

/**
 * The tick iOS gives when a press turns into a preview. Rigid is the closest
 * match to that pop; Light reads as an ordinary tap.
 */
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
  return (
    <HalfSheet visible={visible} title="Text" onClose={onClose}>
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
