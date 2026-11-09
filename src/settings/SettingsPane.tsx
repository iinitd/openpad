import { StyleSheet, Text, View } from "react-native";
import { Icon } from "../components/Icon";
import { THEME } from "../styles/theme";

/**
 * App-level settings. Nothing lives here yet — connections moved to their own
 * tab — so this is an honest empty state rather than a second copy of them.
 */
export function SettingsPane() {
  return (
    <View style={styles.container}>
      <View style={styles.empty}>
        <View style={styles.glyph}>
          <Icon name="settings" size={22} color={THEME.colors.textMuted} />
        </View>
        <Text style={styles.title}>Nothing to configure yet</Text>
        <Text style={styles.body}>
          Appearance, default model, and session preferences will land here.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
    padding: THEME.spacing.lg,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: THEME.spacing.sm,
    paddingBottom: THEME.spacing.xxl,
  },
  glyph: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: THEME.colors.surface,
    marginBottom: THEME.spacing.xs,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: THEME.colors.text,
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    color: THEME.colors.textMuted,
    maxWidth: 260,
  },
});
