import { useRef, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Icon } from "../components/Icon";
import { useConnectionStore } from "../stores/connection-store";
import {
  DEFAULT_AGENT_PROMPT,
  DEFAULT_COMMENT_PROMPT,
  usePreferencesStore,
} from "../stores/preferences-store";
import { COMMENT_PROMPT_PLACEHOLDERS } from "../editor/comment-prompt";
import { exportConfig, importConfig } from "./config-transfer";
import { PRIVACY_URL, SUPPORT_URL } from "./about-links";
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
  // Where the caret sits in the files prompt, so a placeholder lands there.
  const caretRef = useRef<{ start: number; end: number } | null>(null);
  const [importVisible, setImportVisible] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const handleExport = async () => {
    try {
      const json = exportConfig();
      await Clipboard.setStringAsync(json);
      if (Platform.OS === "web") {
        // eslint-disable-next-line no-alert
        alert("配置已复制到剪贴板（包含连接凭据等敏感信息）。");
      } else {
        Alert.alert("已导出", "配置 JSON 已复制到剪贴板（包含连接凭据等敏感信息）。");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "导出失败。";
      if (Platform.OS === "web") {
        // eslint-disable-next-line no-alert
        alert(message);
      } else {
        Alert.alert("导出失败", message);
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
      alert("配置已导入。连接与部分运行状态可能需要重启应用后完全生效。");
    } else {
      Alert.alert("已导入", "配置已导入。连接与部分运行状态可能需要重启应用后完全生效。");
    }
  };

  const insertPlaceholder = (token: string) => {
    const caret = caretRef.current;
    const current = commentPrompt;
    if (caret && caret.start <= current.length) {
      setCommentPrompt(
        current.slice(0, caret.start) + token + current.slice(caret.end),
      );
      return;
    }
    setCommentPrompt(current.trim().length > 0 ? `${current.trimEnd()} ${token}` : token);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      // Keeps a focused prompt field above the keyboard inside the sheet.
      automaticallyAdjustKeyboardInsets
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
        <View style={styles.promptHeader}>
          <Text style={styles.promptLabel}>Agent</Text>
          {agentPrompt.trim() !== DEFAULT_AGENT_PROMPT ? (
            <PressableRow
              style={styles.resetButton}
              haptic="light"
              scale={false}
              onPress={() => setAgentPrompt(DEFAULT_AGENT_PROMPT)}
              accessibilityRole="button"
              accessibilityLabel="Reset agent prompt"
            >
              <Text style={styles.resetText}>Reset</Text>
            </PressableRow>
          ) : null}
        </View>
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
        <View style={styles.promptHeader}>
          <Text style={styles.promptLabel}>Files</Text>
          {commentPrompt.trim() !== DEFAULT_COMMENT_PROMPT.trim() ? (
            <PressableRow
              style={styles.resetButton}
              haptic="light"
              scale={false}
              onPress={() => setCommentPrompt(DEFAULT_COMMENT_PROMPT)}
              accessibilityRole="button"
              accessibilityLabel="Reset file prompt"
            >
              <Text style={styles.resetText}>Reset</Text>
            </PressableRow>
          ) : null}
        </View>
        <TextInput
          style={styles.promptInput}
          value={commentPrompt}
          onChangeText={setCommentPrompt}
          onSelectionChange={(event) => {
            caretRef.current = event.nativeEvent.selection;
          }}
          onBlur={() => {
            caretRef.current = null;
          }}
          placeholder={DEFAULT_COMMENT_PROMPT}
          placeholderTextColor={THEME.colors.textMuted}
          multiline
          autoCapitalize="sentences"
          autoCorrect={false}
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
        <Text style={styles.rowHint}>
          Prepended to the message when you comment on a file or quote a passage.
        </Text>
      </View>

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
            <Text style={styles.rowTitle}>导出配置</Text>
            <Text style={styles.rowHint}>
              将连接与设置导出为 JSON 并复制到剪贴板（包含密码/token 等敏感信息）。
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
            <Text style={styles.rowTitle}>导入配置</Text>
            <Text style={styles.rowHint}>粘贴导出的 JSON 覆盖当前连接与设置。</Text>
          </View>
        </PressableRow>
      </View>

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
              What Puff stores on this device and what it sends to the servers you connect.
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

      <Modal visible={importVisible} transparent animationType="fade" onRequestClose={() => setImportVisible(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setImportVisible(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>导入配置</Text>
            <Text style={styles.rowHint}>粘贴此前导出的 Puff 配置 JSON。导入会覆盖当前连接与设置，可能需要重启应用后完全生效。</Text>
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
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.modalAction, styles.modalConfirm, pressed && styles.modalActionPressed]}
                onPress={handleImport}
                accessibilityRole="button"
              >
                <Text style={styles.modalConfirmText}>导入</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  promptInput: {
    minHeight: 136,
    marginTop: THEME.spacing.xs,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.md,
    borderRadius: THEME.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.background,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0.2,
    color: THEME.colors.text,
    textAlignVertical: "top",
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
