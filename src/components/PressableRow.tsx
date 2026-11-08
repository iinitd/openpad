import { useRef } from "react";
import {
  Animated,
  Pressable,
  Platform,
  StyleSheet,
  type GestureResponderEvent,
  type PressableProps,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import * as Haptics from "expo-haptics";

// A native-feeling touchable: iOS gets a subtle press-down (scale 0.98 + press
// color overlay), Android gets the system ripple, web stays usable. Haptics
// fire on press-in so the hit feels instant.

type HapticFlavor = "light" | "medium" | "selection" | "warning" | "none";

export interface PressableRowProps extends Omit<PressableProps, "style" | "children"> {
  style?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
  haptic?: HapticFlavor;
  // Set false for inline bar icons where scale/opacity feel wrong (hero buttons
  // mostly). Scales from 1 → 0.97 by default.
  scale?: number | false;
  rippleColor?: string;
  children?: React.ReactNode;
}

function trigger(flavor: HapticFlavor) {
  if (flavor === "none" || Platform.OS === "web") return;
  const mod = Haptics;
  if (flavor === "medium") void mod.impactAsync(mod.ImpactFeedbackStyle.Medium);
  else if (flavor === "selection") void mod.selectionAsync();
  else if (flavor === "warning") void mod.notificationAsync(mod.NotificationFeedbackType.Warning);
  else void mod.impactAsync(mod.ImpactFeedbackStyle.Light);
}

export function PressableRow({
  style,
  pressedStyle,
  haptic = "selection",
  scale = 0.98,
  rippleColor = "rgba(15,23,42,0.06)",
  onPressIn,
  children,
  ...rest
}: PressableRowProps) {
  const anim = useRef(new Animated.Value(1)).current;

  const spring = (toValue: number) =>
    Animated.spring(anim, {
      toValue,
      useNativeDriver: Platform.OS !== "web",
      stiffness: 320,
      damping: 24,
      mass: 0.6,
    }).start();

  return (
    <Pressable
      android_ripple={{ color: rippleColor, borderless: false }}
      onPressIn={(e: GestureResponderEvent) => {
        trigger(haptic);
        if (scale !== false) spring(scale);
        onPressIn?.(e);
      }}
      onPressOut={() => {
        if (scale !== false) spring(1);
      }}
      style={({ pressed }: { pressed: boolean }) => [
        style,
        // iOS: our own tint overlay. Android: ripple provides the hint, no tint
        // (double-feedback feels dirty).
        pressed && Platform.OS === "ios" ? styles.iosPressed : null,
        pressed ? pressedStyle : null,
      ]}
      {...rest}
    >
      {scale !== false ? (
        <Animated.View style={{ transform: [{ scale: anim }] }}>{children}</Animated.View>
      ) : (
        children
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  iosPressed: {
    backgroundColor: "rgba(15,23,42,0.04)",
  },
});

// Convenience for one-off haptic-only events (e.g. opening a drawer via swipe).
export function hapticTap(flavor: HapticFlavor = "light") {
  trigger(flavor);
}
