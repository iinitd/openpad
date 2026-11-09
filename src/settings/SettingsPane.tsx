import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Icon } from "../components/Icon";
import { useConnectionStore } from "../stores/connection-store";
import { DEFAULT_AGENT_PROMPT, usePreferencesStore } from "../stores/preferences-store";
import { PressableRow, hapticTap } from "../components/PressableRow";
import { THEME } from "../styles/theme";

/**
 * App-level settings. The demo workspace lives here: it is a sandbox, so
 * showing it is a preference rather than a connection.
 */
export function SettingsPane() {
  const demoEnabled = useConnectionStore((state) => state.demoEnabled);
  const setDemoEnabled = useConnectionStore((state) => state.setDemoEnabled);
  const agentPrompt = usePreferencesStore((state) => state.agentPrompt);
  const commentPrompt = usePreferencesStore((state) => state.commentPrompt);
  const setAgentPrompt = usePreferencesStore((state) => state.setAgentPrompt);
  const setCommentPrompt = usePreferencesStore((state) => state.setCommentPrompt);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
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

      <Text style={styles.sectionLabel}>Prompts</Text>
      <View style={styles.card}>
        <Text style={styles.promptLabel}>Agent</Text>
        <TextInput
          style={styles.promptInput}
          value={agentPrompt}
          onChangeText={setAgentPrompt}
          placeholder={DEFAULT_AGENT_PROMPT}
          placeholderTextColor={THEME.colors.textMuted}
          multiline
          autoCapitalize="sentences"
          autoCorrect={false}
        />
        <Text style={styles.rowHint}>
          Sent when a new chat starts. Open chats keep the prompt they began with.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.promptLabel}>Files</Text>
        <TextInput
          style={styles.promptInput}
          value={commentPrompt}
          onChangeText={setCommentPrompt}
          placeholder="Optional context added to file comments and quoted passages."
          placeholderTextColor={THEME.colors.textMuted}
          multiline
          autoCapitalize="sentences"
          autoCorrect={false}
        />
        <Text style={styles.rowHint}>
          Prepended to the message when you comment on a file or quote a passage.
        </Text>
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
    gap: THEME.spacing.sm,
    paddingBottom: THEME.spacing.xxl,
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
  promptLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: THEME.colors.textSecondary,
    marginTop: THEME.spacing.sm,
  },
  promptInput: {
    minHeight: 88,
    marginTop: THEME.spacing.xs,
    paddingHorizontal: THEME.spacing.sm + 2,
    paddingVertical: THEME.spacing.sm,
    borderRadius: THEME.radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.background,
    fontSize: 13,
    lineHeight: 18,
    color: THEME.colors.text,
    textAlignVertical: "top",
  },
  rowHint: {
    fontSize: 12,
    lineHeight: 17,
    color: THEME.colors.textMuted,
  },
});
