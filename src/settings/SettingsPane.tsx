import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useConnectionStore } from "../stores/connection-store";
import { BackendConnections } from "../components/BackendConnections";
import { THEME } from "../styles/theme";

// Workspace switching lives in the Files sidebar and provider/model selection
// lives in the agent pane. Settings only keeps app-level connection controls.
export function SettingsPane() {
  const router = useRouter();
  const hasConnections = useConnectionStore((state) => state.connections.length > 0 || state.savedConnections.length > 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Settings</Text>

      <Text style={styles.sectionLabel}>Connections</Text>
      {hasConnections ? <BackendConnections /> : <Text style={styles.hint}>No saved connections yet.</Text>}
      <View>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push("/?add=1")}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Add connection</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  content: {
    padding: THEME.spacing.lg,
    gap: THEME.spacing.md,
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: THEME.colors.text,
    marginBottom: THEME.spacing.sm,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: THEME.colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: THEME.spacing.sm,
  },
  hint: { fontSize: 16, color: THEME.colors.textSecondary },
  button: {
    alignSelf: "flex-start",
    paddingHorizontal: THEME.spacing.lg,
    paddingVertical: THEME.spacing.sm,
    borderRadius: THEME.radii.md,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.background,
    marginTop: THEME.spacing.xs,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
    color: THEME.colors.text,
  },
});
