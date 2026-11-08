import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Polygon, Polyline } from "react-native-svg";
import { useSessionStore } from "../stores/session-store";
import { useAgentProgressSummary } from "../hooks/use-agent-progress";
import { THEME } from "../styles/theme";

// Host-level "agent is working" banner. Rendered above the active preview
// Renderer (markdown, web-preview, lark-working-copy, …) so every plugin
// surface gets the same affordance — a progress summary that doubles as the
// shortcut to open the agent pane. Lives outside the plugin layer on
// purpose: all plugins share the same session, so a single banner keyed off
// isStreaming is correct for every one of them.
interface ContentActivityBannerProps {
  onPress?: () => void;
}

function TypingIndicator() {
  const phase = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    phase.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(phase, {
          toValue: 3,
          duration: 900,
          easing: Easing.linear,
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.delay(140),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [phase]);

  return (
    <View style={styles.typingIndicator} accessible={false}>
      {[0, 1, 2].map((index) => {
        const peak = 0.4 + index * 0.8;
        const inputRange = [0, peak - 0.3, peak, peak + 0.3, 3];
        const opacity = phase.interpolate({
          inputRange,
          outputRange: [0.38, 0.38, 1, 0.38, 0.38],
        });
        const translateY = phase.interpolate({
          inputRange,
          outputRange: [0, 0, -2, 0, 0],
        });
        return (
          <Animated.View
            key={index}
            style={[styles.typingDot, { opacity, transform: [{ translateY }] }]}
          />
        );
      })}
    </View>
  );
}

export function ContentActivityBanner({ onPress }: ContentActivityBannerProps) {
  const running = useSessionStore((state) => state.isStreaming);
  const progress = useAgentProgressSummary();
  if (!running) return null;
  const summary = progress || "Agent is working…";
  const tappable = !!onPress;
  const inner = (
    <>
      <TypingIndicator />
      <Text style={styles.summary} numberOfLines={2} ellipsizeMode="tail">
        {summary}
      </Text>
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
    height: 56,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.colors.border,
    backgroundColor: THEME.colors.surface,
  },
  content: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  contentPressed: {
    opacity: 0.68,
  },
  typingIndicator: {
    width: 20,
    height: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  typingDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: THEME.colors.textSecondary,
  },
  // The 18px SVG sits 15px from the edge, so its centre lands exactly 24px
  // from the right — the centre of the Host's Agent action. Its outline is an
  // open polyline: only the two diagonals are stroked, never the joined base.
  agentTail: {
    position: "absolute",
    top: -9,
    right: 15,
  },
  summary: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    color: THEME.colors.textSecondary,
  },
});
