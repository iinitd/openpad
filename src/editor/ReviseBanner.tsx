import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { useEditorStore } from "../stores/editor-store";
import { useSessionStore } from "../stores/session-store";
import { useFilesStore } from "../stores/files-store";
import { useAgentProgressSummary } from "../hooks/use-agent-progress";
import { THEME } from "../styles/theme";

// A persistent banner shown in the document view while the agent is revising.
// It appears for BOTH a highlighted-passage revise and a whole-document one.
// Tapping opens the agent chat drawer so the user can follow the conversation.
// Jumping to the file being edited is surfaced separately — as a row inside the
// Files drawer — so the two intents (watch the agent / jump to the file) don't
// collide on a single banner.
export function ReviseBanner({ onPress }: { onPress?: () => void }) {
  const isStreaming = useSessionStore((s) => s.isStreaming);
  const cwd = useFilesStore((s) => s.cwd);
  // The in-flight revise target is scoped per-workspace. Only the active cwd's
  // target drives this banner — background agents in other workspaces don't
  // bleed into the current view.
  const reviseTarget = useEditorStore((s) => (cwd ? s.reviseTargetsByCwd[cwd] ?? null : null));
  const progressSummary = useAgentProgressSummary();

  if (!isStreaming || !reviseTarget) return null;

  // Prefer the live activity summary (the current step the agent is on); fall
  // back to a terse hint only when nothing's been reported yet. The old static
  // "AI is revising your document" line was redundant with the spinner.
  const label = progressSummary ?? "Tap to open the agent chat";

  const tappable = !!onPress;

  return (
    <TouchableOpacity
      style={styles.banner}
      activeOpacity={tappable ? 0.6 : 1}
      onPress={onPress}
      disabled={!tappable}
      accessibilityRole={tappable ? "button" : undefined}
      accessibilityLabel={tappable ? "Open agent chat" : undefined}
    >
      <ActivityIndicator size="small" color={THEME.colors.textSecondary} />
      <View style={styles.body}>
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
      </View>
      {tappable ? (
        <Svg width={18} height={18} viewBox="0 0 24 24" style={styles.chevron}>
          <Polyline
            points="9 6 15 12 9 18"
            stroke={THEME.colors.textMuted}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.sm,
    backgroundColor: THEME.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  body: {
    flex: 1,
  },
  label: {
    fontSize: 13,
    color: THEME.colors.text,
    lineHeight: 16,
  },
  chevron: {
    marginTop: 1,
  },
});
