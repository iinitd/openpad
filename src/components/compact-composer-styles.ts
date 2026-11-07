import { StyleSheet } from "react-native";
import { THEME } from "../styles/theme";

// Shared mobile composer geometry. The document and agent inputs have different
// behavior, but their core field should read as the same control.
export const COMPACT_COMPOSER_ICON_SIZE = 15;

export const COMPACT_COMPOSER_STYLES = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingLeft: THEME.spacing.md,
    paddingRight: 4,
    paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    borderRadius: THEME.radii.full,
    backgroundColor: THEME.colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 38,
    paddingHorizontal: 4,
    paddingVertical: 9,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: "center",
    color: THEME.colors.text,
  },
  send: {
    width: 30,
    height: 30,
    marginLeft: 6,
    borderRadius: 15,
    overflow: "hidden",
    backgroundColor: THEME.colors.accent,
  },
  sendInner: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: {
    backgroundColor: "rgba(24,24,27,0.06)",
  },
});
