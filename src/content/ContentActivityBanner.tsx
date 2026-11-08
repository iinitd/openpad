import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Polygon, Polyline } from "react-native-svg";
import { useSessionStore } from "../stores/session-store";
import { useAgentActivitySummary } from "../hooks/use-agent-progress";
import { THEME } from "../styles/theme";
import { TypingDots } from "../components/TypingDots";

// Host-level "agent is working" banner. Rendered above the active preview
// Renderer (markdown, web-preview, lark-working-copy, …) so every plugin
// surface gets the same affordance — a progress summary that doubles as the
// shortcut to open the agent pane. Lives outside the plugin layer on
// purpose: all plugins share the same session, so a single banner keyed off
// isStreaming is correct for every one of them.
interface ContentActivityBannerProps {
  onPress?: () => void;
}

export function ContentActivityBanner({ onPress }: ContentActivityBannerProps) {
  const running = useSessionStore((state) => state.isStreaming);
  const activity = useAgentActivitySummary();
  if (!running) return null;
  const tappable = !!onPress;
  const inner = (
    <>
      <View style={styles.labelRow}>
        <TypingDots />
        <Text style={styles.label} numberOfLines={1}>
          {activity ? activity.label : "Agent is working"}
        </Text>
        {activity && activity.steps > 1 ? (
          <Text style={styles.meta}>{activity.steps} steps</Text>
        ) : null}
      </View>
      {activity?.preview ? (
        <Text style={styles.preview} numberOfLines={2} ellipsizeMode="tail">
          {activity.preview}
        </Text>
      ) : null}
    </>
  );
  return (
    <Pressable
      style={styles.banner}
      onPress={onPress}
      disabled={!tappable}
      accessibilityRole={tappable ? "button" : undefined}
      accessibilityLabel={tappable ? "Open agent chat" : undefined}
    >
      {({ pressed }) => (
        <>
          <Svg
            width={18}
            height={10}
            viewBox="0 0 18 10"
            pointerEvents="none"
            style={styles.agentTail}
          >
            <Polygon
              points="0.75,10 9,0.75 17.25,10"
              fill={THEME.colors.surface}
            />
            <Polyline
              points="0.75,9.5 9,0.75 17.25,9.5"
              fill="none"
              stroke={THEME.colors.border}
              strokeWidth={1}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <View
            style={[
              styles.content,
              pressed && tappable ? styles.contentPressed : null,
            ]}
          >
            {inner}
          </View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "relative",
    zIndex: 31,
    overflow: "visible",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.colors.border,
    backgroundColor: THEME.colors.surface,
  },
  // The banner is as tall as its content now, so this wrapper must not be
  // flex:1 — a zero-basis child of an auto-height parent collapses.
  content: {},
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  contentPressed: {
    opacity: 0.68,
  },
  // The 18px SVG sits 15px from the edge, so its centre lands exactly 24px
  // from the right — the centre of the Host's Agent action. Its outline is an
  // open polyline: only the two diagonals are stroked, never the joined base.
  agentTail: {
    position: "absolute",
    top: -9,
    right: 15,
  },
  label: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: THEME.colors.textSecondary,
  },
  meta: {
    fontSize: 11,
    color: "#b3b3bc",
  },
  // Aligned with the label, so the dots read as the bullet for the whole block.
  preview: {
    marginTop: 3,
    marginLeft: 24,
    fontSize: 14,
    lineHeight: 19,
    color: THEME.colors.textMuted,
  },
});
