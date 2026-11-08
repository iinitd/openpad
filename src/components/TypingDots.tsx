import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, View } from "react-native";
import { THEME } from "../styles/theme";

const DOT = 4;
const SLOT = 16;
const GAP = 2;
// Distance from the centre dot to where each outer dot rests.
const SIDE_OFFSET = DOT + GAP;

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

/**
 * One indicator that morphs between a single dot (idle / finished) and three
 * dots (working): the outer dots slide out from the centre and fade in, so the
 * state change reads as one dot splitting rather than two icons swapping.
 */
export function ActivityDot({
  running,
  color = THEME.colors.textSecondary,
}: {
  running: boolean;
  color?: string;
}) {
  const expand = useRef(new Animated.Value(running ? 1 : 0)).current;
  const phase = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(expand, {
      toValue: running ? 1 : 0,
      duration: 220,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [expand, running]);

  useEffect(() => {
    if (!running) return;
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
  }, [phase, running]);

  const pulse = (index: number) => {
    const peak = 0.4 + index * 0.8;
    return phase.interpolate({
      inputRange: [0, peak - 0.3, peak, peak + 0.3, 3],
      outputRange: [0.45, 0.45, 1, 0.45, 0.45],
    });
  };

  // Collapsed, both outer dots sit on the centre; expanding slides them out to
  // their resting positions, so one dot appears to split into three.
  const slide = (direction: -1 | 1) =>
    expand.interpolate({
      inputRange: [0, 1],
      outputRange: [direction * SIDE_OFFSET * -1, 0],
    });

  // The centre dot is fully opaque while collapsed and follows the pulse once
  // the row is running: expand * (pulse - 1) + 1.
  const centerOpacity = Animated.add(
    Animated.multiply(expand, Animated.subtract(pulse(1), 1)),
    1,
  );

  return (
    <View style={styles.slot} accessible={false}>
      <Animated.View style={{ opacity: expand, transform: [{ translateX: slide(-1) }] }}>
        <Animated.View style={[styles.dot, { backgroundColor: color, opacity: pulse(0) }]} />
      </Animated.View>
      <Animated.View style={[styles.dot, { backgroundColor: color, opacity: centerOpacity }]} />
      <Animated.View style={{ opacity: expand, transform: [{ translateX: slide(1) }] }}>
        <Animated.View style={[styles.dot, { backgroundColor: color, opacity: pulse(2) }]} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: SLOT,
    height: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
  },
  slot: {
    width: SLOT,
    height: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: GAP,
  },
});
