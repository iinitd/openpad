import { TouchableOpacity, Text, ActivityIndicator, StyleSheet } from "react-native";
import { useSessionStore } from "../stores/session-store";
import { useAgentProgressSummary } from "../hooks/use-agent-progress";
import { THEME } from "../styles/theme";
import { Icon } from "../components/Icon";

interface WebPreviewRunBannerProps {
  onPress?: () => void;
}

export function WebPreviewRunBanner({ onPress }: WebPreviewRunBannerProps) {
  const running = useSessionStore((state) => state.isStreaming);
  const progress = useAgentProgressSummary();
  if (!running) return null;
  const summary = progress || "Agent 正在处理…";
  const content = (
    <>
      <Icon name="chat" size={16} color={THEME.colors.text} />
      <Text style={styles.summary} numberOfLines={2}>
        {summary}
      </Text>
      <ActivityIndicator size="small" color={THEME.colors.primary} />
    </>
  );
  if (!onPress) {
    return <TouchableOpacity activeOpacity={1} style={styles.banner} disabled>{content}</TouchableOpacity>;
  }
  return (
    <TouchableOpacity
      activeOpacity={0.6}
      style={styles.banner}
      onPress={onPress}
      accessibilityLabel="打开 Agent"
    >
      {content}
    </TouchableOpacity>
  );
}
const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.colors.border,
    backgroundColor: THEME.colors.surface,
  },
  summary: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: THEME.colors.textSecondary,
  },
});
