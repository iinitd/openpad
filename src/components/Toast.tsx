import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { create } from "zustand";
import { THEME } from "../styles/theme";

interface ToastState {
  message: string | null;
  token: number;
  show: (message: string) => void;
  hide: () => void;
}

/**
 * A single transient message, shown briefly and then gone. Used for states the
 * reader cannot act on — "reconnecting" and the like — instead of a persistent
 * banner that takes up layout.
 */
export const useToastStore = create<ToastState>((set, get) => ({
  message: null,
  token: 0,
  show: (message) => set({ message, token: get().token + 1 }),
  hide: () => set({ message: null }),
}));

export function showToast(message: string) {
  useToastStore.getState().show(message);
}

export function ToastHost() {
  const message = useToastStore((state) => state.message);
  const token = useToastStore((state) => state.token);
  const hide = useToastStore((state) => state.hide);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    Animated.timing(opacity, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) hide();
      });
    }, 2200);
    return () => clearTimeout(timer);
  }, [message, token, opacity, hide]);

  if (!message) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.host, { opacity }]}>
      <View style={styles.pill}>
        <Text style={styles.text}>{message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 112,
    alignItems: "center",
    paddingHorizontal: THEME.spacing.lg,
    zIndex: 40,
  },
  pill: {
    maxWidth: 320,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.sm,
    borderRadius: 999,
    backgroundColor: "rgba(24,24,27,0.92)",
  },
  text: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    color: "#fff",
  },
});
