import { useRef, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Icon } from "../components/Icon";
import { HalfSheet } from "../components/HalfSheet";
import {
  DEFAULT_AGENT_PROMPT,
  DEFAULT_COMMENT_PROMPT,
  usePreferencesStore,
} from "../stores/preferences-store";
import { COMMENT_PROMPT_PLACEHOLDERS } from "../editor/comment-prompt";
import { exportConfig, importConfig } from "./config-transfer";
import { PRIVACY_URL, SUPPORT_URL } from "./about-links";
import { PressableRow } from "../components/PressableRow";
import { THEME } from "../styles/theme";

// Import replaces every connection and preference in one tap, and the exported
// format is still settling. Keep the transfer code wired but out of the UI.
const CONFIG_TRANSFER_VISIBLE: boolean = false;

/**
 * App-level settings: connections, prompts, about. Config transfer stays behind
 * `CONFIG_TRANSFER_VISIBLE` until importing is safe to hand to anyone.
 */
export function SettingsPane({
  onAddConnection,
}: {
  /** Opens the full-page connection form the workspace sheet hosts. */
  onAddConnection?: () => void;
} = {}) {
  const agentPrompt = usePreferencesStore((state) => state.agentPrompt);
  const commentPrompt = usePreferencesStore((state) => state.commentPrompt);
  const setAgentPrompt = usePreferencesStore((state) => state.setAgentPrompt);
  const setCommentPrompt = usePreferencesStore((state) => state.setCommentPrompt);
  // Where the caret sits in the files prompt editor, so a placeholder lands there.
  const filesCaretRef = useRef<{ start: number; end: number } | null>(null);
  const [promptEditor, setPromptEditor] = useState<"agent" | "files" | null>(null);
  const [importVisible, setImportVisible] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const handleExport = async () => {
    try {
      const json = exportConfig();
      await Clipboard.setStringAsync(json);
      if (Platform.OS === "web") {
        // eslint-disable-next-line no-alert
        alert("Config copied to clipboard (includes sensitive credentials such as passwords and tokens).");
      } else {
        Alert.alert(
          "Exported",
          "Config JSON copied to clipboard (includes sensitive credentials such as passwords and tokens).",
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Export failed.";
      if (Platform.OS === "web") {
        // eslint-disable-next-line no-alert
        alert(message);
      } else {
        Alert.alert("Export failed", message);
      }
    }
  };

  const handleImport = () => {
    const result = importConfig(importText);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    setImportVisible(false);
    setImportText("");
    setImportError(null);
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      alert("Config imported. Connections and some runtime state may fully apply after restarting the app.");
    } else {
      Alert.alert(
        "Imported",
        "Config imported. Connections and some runtime state may fully apply after restarting the app.",
      );
    }
  };

  const insertPlaceholder = (token: string) => {
    const caret = filesCaretRef.current;
    const current = commentPrompt;
    if (caret && caret.start <= current.length) {
      setCommentPrompt(current.slice(0, caret.start) + token + current.slice(caret.end));
      return;
    }
    setCommentPrompt(current.trim().length > 0 ? `${current.trimEnd()} ${token}` : token);
  };

  const promptPreview = (value: string, fallback: string) => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  };

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionLabel}>Connections</Text>
      <View style={styles.card}>
        <PressableRow
          style={styles.actionRow}
          haptic="light"
          scale={false}
          onPress={() => onAddConnection?.()}
          accessibilityRole="button"
          accessibilityLabel="Add connection"
        >
          <View style={styles.rowGlyph}>
            <Icon name="plus" size={15} color={THEME.colors.textSecondary} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Add connection</Text>
            <Text style={styles.rowHint}>Server URL, or pair with a relay. Servers you save show up in Workspace.</Text>
          </View>
          <Icon name="chevron-right" size={16} color={THEME.colors.textMuted} />
        </PressableRow>
      </View>

      <Text style={styles.sectionLabel}>Prompts</Text>
      <View style={styles.card}>
        <PressableRow
          style={styles.actionRow}
          haptic="light"
          scale={false}
          onPress={() => setPromptEditor("agent")}
          accessibilityRole="button"
          accessibilityLabel="Edit system prompt"
        >
          <View style={styles.rowGlyph}>
            <Icon name="file" size={16} color={THEME.colors.textSecondary} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>System prompt</Text>
            <Text style={styles.rowHint}>
              Sent as the first user message when a new chat session starts. It sets the agent's behavior for that session; existing chats keep the prompt they started with.
            </Text>
          </View>
          <Icon name="chevron-right" size={16} color={THEME.colors.textMuted} />
        </PressableRow>
      </View>

      <View style={styles.card}>
        <PressableRow
          style={styles.actionRow}
          haptic="light"
          scale={false}
          onPress={() => setPromptEditor("files")}
          accessibilityRole="button"
          accessibilityLabel="Edit files prompt"
        >
          <View style={styles.rowGlyph}>
            <Icon name="file" size={16} color={THEME.colors.textSecondary} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Files prompt</Text>
            <Text style={styles.rowHint}>
              Prepended to the message when you comment on a file or quote a passage in the editor.
            </Text>
          </View>
          <Icon name="chevron-right" size={16} color={THEME.colors.textMuted} />
        </PressableRow>
      </View>

      {CONFIG_TRANSFER_VISIBLE ? (
        <>
          <Text style={styles.sectionLabel}>Config</Text>
          <View style={styles.card}>
            <PressableRow
              style={styles.actionRow}
              haptic="light"
              scale={false}
              onPress={() => void handleExport()}
              accessibilityRole="button"
              accessibilityLabel="Export config"
            >
              <View style={styles.rowGlyph}>
                <Icon name="copy" size={16} color={THEME.colors.textSecondary} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>Export config</Text>
                <Text style={styles.rowHint}>
                  Copy connections and settings as JSON to the clipboard (includes sensitive credentials such as passwords and tokens).
                </Text>
              </View>
            </PressableRow>
            <View style={styles.divider} />
            <PressableRow
              style={styles.actionRow}
              haptic="light"
              scale={false}
              onPress={() => {
                setImportError(null);
                setImportText("");
                setImportVisible(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Import config"
            >
              <View style={styles.rowGlyph}>
                <Icon name="file" size={16} color={THEME.colors.textSecondary} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>Import config</Text>
                <Text style={styles.rowHint}>Paste exported JSON to replace current connections and settings.</Text>
              </View>
            </PressableRow>
          </View>
        </>
      ) : null}

      <Text style={styles.sectionLabel}>About</Text>
      <View style={styles.card}>
        <PressableRow
          style={styles.actionRow}
          haptic="light"
          scale={false}
          onPress={() => void Linking.openURL(PRIVACY_URL)}
          accessibilityRole="link"
          accessibilityLabel="Privacy policy"
        >
          <View style={styles.rowGlyph}>
            <Icon name="eye" size={16} color={THEME.colors.textSecondary} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Privacy Policy</Text>
            <Text style={styles.rowHint}>
              What Clacko stores on this device and what it sends to the servers you connect.
            </Text>
          </View>
        </PressableRow>
        <View style={styles.divider} />
        <PressableRow
          style={styles.actionRow}
          haptic="light"
          scale={false}
          onPress={() => void Linking.openURL(SUPPORT_URL)}
          accessibilityRole="link"
          accessibilityLabel="Support"
        >
          <View style={styles.rowGlyph}>
            <Icon name="chat" size={16} color={THEME.colors.textSecondary} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Support</Text>
            <Text style={styles.rowHint}>
              Report a problem or ask a question about connecting a backend.
            </Text>
          </View>
        </PressableRow>
      </View>

      <Modal visible={CONFIG_TRANSFER_VISIBLE && importVisible} transparent animationType="fade" onRequestClose={() => setImportVisible(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setImportVisible(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Import config</Text>
            <Text style={styles.rowHint}>Paste a previously exported Clacko config JSON. Import replaces current connections and settings and may fully apply after restarting the app.</Text>
            <TextInput
              style={styles.importInput}
              value={importText}
              onChangeText={(text) => {
                setImportText(text);
                if (importError) setImportError(null);
              }}
              placeholder='{"format":"puff-config", ...}'
              placeholderTextColor={THEME.colors.textMuted}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              textAlignVertical="top"
            />
            {importError ? <Text style={styles.importError}>{importError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [styles.modalAction, pressed && styles.modalActionPressed]}
                onPress={() => setImportVisible(false)}
                accessibilityRole="button"
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.modalAction, styles.modalConfirm, pressed && styles.modalActionPressed]}
                onPress={handleImport}
                accessibilityRole="button"
              >
                <Text style={styles.modalConfirmText}>Import</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>

    <HalfSheet
      visible={promptEditor === "agent"}
      title="System prompt"
      onClose={() => setPromptEditor(null)}
      headerActions={
        agentPrompt.trim() !== DEFAULT_AGENT_PROMPT ? (
          <PressableRow
            style={styles.sheetAction}
            haptic="light"
            scale={false}
            onPress={() => setAgentPrompt(DEFAULT_AGENT_PROMPT)}
            accessibilityRole="button"
            accessibilityLabel="Reset system prompt"
          >
            <Text style={styles.resetText}>Reset</Text>
          </PressableRow>
        ) : undefined
      }
    >
      <Text style={styles.rowHint}>
        Used as the first user message when a new chat session is created. It defines how the agent should behave in that session. Existing sessions keep the system prompt they began with.
      </Text>
      <TextInput
        style={styles.sheetPromptInput}
        value={agentPrompt}
        onChangeText={setAgentPrompt}
        placeholder={DEFAULT_AGENT_PROMPT}
        placeholderTextColor={THEME.colors.textMuted}
        multiline
        autoFocus
        autoCapitalize="sentences"
        autoCorrect={false}
        textAlignVertical="top"
      />
    </HalfSheet>

    <HalfSheet
      visible={promptEditor === "files"}
      title="Files prompt"
      onClose={() => {
        filesCaretRef.current = null;
        setPromptEditor(null);
      }}
      headerActions={
        commentPrompt.trim() !== DEFAULT_COMMENT_PROMPT.trim() ? (
          <PressableRow
            style={styles.sheetAction}
            haptic="light"
            scale={false}
            onPress={() => setCommentPrompt(DEFAULT_COMMENT_PROMPT)}
            accessibilityRole="button"
            accessibilityLabel="Reset files prompt"
          >
            <Text style={styles.resetText}>Reset</Text>
          </PressableRow>
        ) : undefined
      }
    >
      <Text style={styles.rowHint}>
        Used when you comment on a file or quote a passage in the editor. This prompt is prepended to that message.
      </Text>
      <TextInput
        style={styles.sheetPromptInput}
        value={commentPrompt}
        onChangeText={setCommentPrompt}
        onSelectionChange={(event) => {
          filesCaretRef.current = event.nativeEvent.selection;
        }}
        placeholder={DEFAULT_COMMENT_PROMPT}
        placeholderTextColor={THEME.colors.textMuted}
        multiline
        autoFocus
        autoCapitalize="sentences"
        autoCorrect={false}
        textAlignVertical="top"
      />
      <View style={styles.placeholders}>
        <Text style={styles.placeholderLead}>Insert</Text>
        {COMMENT_PROMPT_PLACEHOLDERS.map((token) => (
          <PressableRow
            key={token}
            style={styles.placeholderChip}
            haptic="light"
            scale={false}
            onPress={() => insertPlaceholder(token)}
            accessibilityRole="button"
            accessibilityLabel={`Insert ${token}`}
          >
            <Text style={styles.placeholderChipText}>{token}</Text>
          </PressableRow>
        ))}
      </View>
    </HalfSheet>
    </>
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
  promptHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: THEME.spacing.sm,
  },
  promptLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: THEME.colors.textSecondary,
  },
  resetButton: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  resetText: {
    fontSize: 12,
    fontWeight: "500",
    color: THEME.colors.textSecondary,
  },
  promptPreviewRow: {
    marginTop: THEME.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.md,
    borderRadius: THEME.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.background,
  },
  promptPreviewText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0.2,
    color: THEME.colors.text,
  },
  sheetAction: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  sheetPromptInput: {
    minHeight: 220,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.md,
    borderRadius: THEME.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.backgroundSecondary,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0.2,
    color: THEME.colors.text,
  },
  placeholders: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: THEME.spacing.sm,
  },
  placeholderLead: {
    fontSize: 12,
    color: THEME.colors.textMuted,
    marginRight: 2,
  },
  placeholderChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: THEME.colors.surface,
  },
  placeholderChipText: {
    fontFamily: THEME.fonts.mono,
    fontSize: 11,
    color: THEME.colors.textSecondary,
  },
  rowHint: {
    fontSize: 12,
    lineHeight: 17,
    color: THEME.colors.textMuted,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.md,
    paddingVertical: THEME.spacing.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: THEME.colors.border,
  },
  modalOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: THEME.spacing.xl,
    backgroundColor: "rgba(15,23,42,0.32)",
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    gap: THEME.spacing.md,
    padding: THEME.spacing.lg,
    borderRadius: THEME.radii.xl,
    backgroundColor: THEME.colors.background,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: THEME.colors.text,
  },
  importInput: {
    minHeight: 180,
    maxHeight: 320,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.md,
    borderRadius: THEME.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.surface,
    fontFamily: THEME.fonts.mono,
    fontSize: 13,
    lineHeight: 18,
    color: THEME.colors.text,
  },
  importError: {
    fontSize: 13,
    lineHeight: 18,
    color: THEME.colors.error,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: THEME.spacing.sm,
  },
  modalAction: {
    paddingHorizontal: THEME.spacing.lg,
    paddingVertical: 9,
    borderRadius: THEME.radii.lg,
  },
  modalActionPressed: {
    opacity: 0.6,
  },
  modalConfirm: {
    backgroundColor: THEME.colors.primary,
  },
  modalCancelText: {
    fontSize: 15,
    color: THEME.colors.textSecondary,
  },
  modalConfirmText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
});
