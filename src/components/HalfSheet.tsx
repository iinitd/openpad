import { useEffect, useRef, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Icon } from "./Icon";
import { PressableRow } from "./PressableRow";
import { THEME } from "../styles/theme";

/**
 * A half-height sheet that slides up from the bottom. Used for reading the full
 * text behind a clamped transcript row (reasoning, tool steps) without leaving
 * the conversation.
 */
export function HalfSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { height } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (!visible) return;
    // The newest step is the one being read, so open at the end. The modal
    // mounts and lays its content out across a few frames, hence the retries.
    // Deliberately not driven by content-size changes: a row expanding later
    // would otherwise yank the list back down.
    const timers = [0, 60, 180, 350].map((delay) =>
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View style={[styles.sheet, { height: Math.round(height * 0.52) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <PressableRow
              style={styles.close}
              onPress={onClose}
              haptic="light"
              accessibilityLabel="Close"
            >
              <Icon name="close" size={18} color={THEME.colors.textSecondary} />
            </PressableRow>
          </View>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15,23,42,0.32)",
  },
  sheet: {
    backgroundColor: THEME.colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: THEME.spacing.xl,
    shadowColor: "#18181b",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 16,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: THEME.colors.border,
    marginTop: THEME.spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: THEME.spacing.lg,
    paddingVertical: THEME.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.colors.border,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: THEME.colors.text,
  },
  close: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: THEME.spacing.lg,
    paddingTop: THEME.spacing.md,
  },
});
