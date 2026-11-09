import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Icon } from "./Icon";
import { THEME } from "../styles/theme";

// A single, shared full-screen loading view used for both auto-reconnect (on
// the connect screen) and session restore (on the workspace screen). Keeping
// the same quiet launch surface across both routes prevents a visual flash.
export function ConnectingView({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string | null;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1250,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [progress]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-24, 80],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.12, 0.88, 1],
    outputRange: [0, 1, 1, 0],
  });

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.mark}>
          <Icon
            name="edit"
            size={21}
            color={THEME.colors.textSecondary}
            strokeWidth={1.6}
          />
        </View>
        <Text style={styles.brand}>Puff</Text>

        <View style={styles.status}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="middle">
              {subtitle}
            </Text>
          ) : null}
        </View>

        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressBar,
              { opacity, transform: [{ translateX }] },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: THEME.spacing.xl,
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  content: {
    width: "100%",
    maxWidth: 320,
    alignItems: "center",
  },
  mark: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
    borderRadius: 14,
    backgroundColor: THEME.colors.background,
    shadowColor: THEME.colors.text,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  brand: {
    marginTop: 14,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.5,
    color: THEME.colors.textSecondary,
  },
  status: {
    marginTop: THEME.spacing.xl,
    alignItems: "center",
    gap: 5,
  },
  title: {
    fontSize: 18,
    fontWeight: "500",
    color: THEME.colors.text,
  },
  subtitle: {
    maxWidth: 280,
    fontSize: 14,
    lineHeight: 17,
    color: THEME.colors.textMuted,
    textAlign: "center",
  },
  progressTrack: {
    width: 80,
    height: 2,
    marginTop: 22,
    overflow: "hidden",
    borderRadius: 1,
    backgroundColor: THEME.colors.border,
  },
  progressBar: {
    width: 24,
    height: 2,
    borderRadius: 1,
    backgroundColor: THEME.colors.textSecondary,
  },
});
