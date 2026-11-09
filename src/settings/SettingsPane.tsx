import { StyleSheet, Switch, Text, View } from "react-native";
import { Icon } from "../components/Icon";
import { useConnectionStore } from "../stores/connection-store";
import { PressableRow, hapticTap } from "../components/PressableRow";
import { THEME } from "../styles/theme";

/**
 * App-level settings. The demo workspace lives here: it is a sandbox, so
 * showing it is a preference rather than a connection.
 */
export function SettingsPane() {
  const demoEnabled = useConnectionStore((state) => state.demoEnabled);
  const setDemoEnabled = useConnectionStore((state) => state.setDemoEnabled);

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>Workspace</Text>

      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowGlyph}>
            <Icon name="grid" size={16} color={THEME.colors.textSecondary} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Show demo workspace</Text>
            <Text style={styles.rowHint}>
              A sandbox project with sample files and a scripted agent. Turn it off
              once you have a real backend.
            </Text>
          </View>
          <Switch
            value={demoEnabled}
            onValueChange={(value) => {
              hapticTap("selection");
              void setDemoEnabled(value);
            }}
            trackColor={{ true: THEME.colors.primary, false: THEME.colors.border }}
            thumbColor="#fff"
          />
        </View>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
    padding: THEME.spacing.lg,
    gap: THEME.spacing.sm,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: THEME.colors.textMuted,
  },
  card: {
    borderRadius: THEME.radii.lg,
    backgroundColor: THEME.colors.backgroundSecondary,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.md,
    paddingVertical: THEME.spacing.sm,
  },
  rowGlyph: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: THEME.colors.surface,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    color: THEME.colors.text,
  },
  rowHint: {
    fontSize: 12,
    lineHeight: 17,
    color: THEME.colors.textMuted,
  },
});
