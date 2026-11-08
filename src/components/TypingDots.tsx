import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, View } from "react-native";
import { THEME } from "../styles/theme";

/** The three-dot "composing" indicator shared by the banner and activity rows. */
export function TypingDots({ color = THEME.colors.textSecondary }: { color?: string }) {
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
    <View style={styles.wrap} accessible={false}>
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
            style={[styles.dot, { backgroundColor: color, opacity, transform: [{ translateY }] }]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 20,
    height: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});
