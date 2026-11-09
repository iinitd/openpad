import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useConnectionStore } from "../stores/connection-store";
import { BackendConnections } from "../components/BackendConnections";
import { Icon } from "../components/Icon";
import { PressableRow, hapticTap } from "../components/PressableRow";
import { THEME } from "../styles/theme";

// Workspace switching lives in the Files sidebar and provider/model selection
// lives in the agent pane. Settings only keeps app-level connection controls.
//
// The pane has no title of its own: it is hosted by the projects sheet (or the
// standalone settings screen), both of which draw the "Settings" header.
export function SettingsPane({
  onAddConnection,
}: {
  onAddConnection?: () => void;
} = {}) {
  const router = useRouter();
  const hasConnections = useConnectionStore(
    (state) => state.connections.length > 0 || state.savedConnections.length > 0,
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionLabel}>Connections</Text>
      {hasConnections ? (
        <BackendConnections />
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            No connections yet. Add one to point OpenPad at your own backend.
          </Text>
        </View>
      )}

      <PressableRow
        style={styles.addRow}
        haptic="light"
        // Keeps the children as direct siblings so the row layout holds.
        scale={false}
        pressedStyle={styles.addRowPressed}
        onPress={() => {
          hapticTap("light");
          if (onAddConnection) {
            onAddConnection();
            return;
          }
          router.push("/?add=1");
        }}
        accessibilityRole="button"
        accessibilityLabel="Add connection"
      >
        <View style={styles.addGlyph}>
          <Icon name="plus" size={15} color={THEME.colors.accent} />
        </View>
        <View style={styles.addBody}>
          <Text style={styles.addTitle}>Add connection</Text>
          <Text style={styles.addHint}>Server URL, or pair with a relay</Text>
        </View>
        <Icon name="chevron-right" size={16} color={THEME.colors.textMuted} />
      </PressableRow>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  content: {
    paddingHorizontal: THEME.spacing.lg,
    paddingTop: THEME.spacing.lg,
    paddingBottom: THEME.spacing.xxl,
    gap: THEME.spacing.md,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: THEME.colors.textMuted,
  },
  emptyCard: {
    padding: THEME.spacing.lg,
    borderRadius: THEME.radii.lg,
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  emptyText: {
    fontSize: 15,
    lineHeight: 21,
    color: THEME.colors.textSecondary,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.md,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.md,
    borderRadius: THEME.radii.lg,
    backgroundColor: THEME.colors.surface,
  },
  addRowPressed: {
    backgroundColor: "#ececef",
  },
  addGlyph: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: THEME.colors.accentSoft,
  },
  addBody: {
    flex: 1,
    gap: 2,
  },
  addTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: THEME.colors.text,
  },
  addHint: {
    fontSize: 12,
    color: THEME.colors.textMuted,
  },
});
