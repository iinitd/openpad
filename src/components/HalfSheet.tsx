import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Icon } from "./Icon";
import { PressableRow, hapticTap } from "./PressableRow";
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
  scrollToEndOnOpen = false,
  stickyHeaderIndices,
  actions,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Progress sheets read newest-last; a text sheet starts at the top. */
  scrollToEndOnOpen?: boolean;
  /** Pin the given children while the rest of the sheet scrolls. */
  stickyHeaderIndices?: number[];
  /** Quick actions shown under the title, above the content. */
  actions?: ReactNode;
}) {
  const { height } = useWindowDimensions();
  const sheetHeight = Math.round(height * 0.75);
  const scrollRef = useRef<ScrollView>(null);
  const userTookOver = useRef(false);

  // The sheet rises from the bottom on its own animation: Modal's built-in
  // "slide" would drag the dimming layer up with it, which reads as a black
  // panel climbing the screen.
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    closingRef.current = false;
    setMounted(true);
    Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, progress]);

  // Closing through the sheet's own controls starts the animation in the touch
  // handler: going through a state update first adds a frame of delay, and more
  // when the transcript is busy streaming.
  const closeNow = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    Animated.timing(progress, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      closingRef.current = false;
      setMounted(false);
    });
    onClose();
  };

  // Closing from the outside (the parent flipped `visible`) still animates out.
  useEffect(() => {
    if (visible || !mounted || closingRef.current) return;
    Animated.timing(progress, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [visible, mounted, progress]);

  useEffect(() => {
    userTookOver.current = false;
    if (!visible || !scrollToEndOnOpen) return;
    // One jump per open, so the newest step is in view. Never again while the
    // sheet stays open: streaming steps keep changing the content height, and
    // following them would drag a reader who has scrolled up back down. Any
    // touch on the list cancels the remaining retries.
    const timers = [0, 50, 120, 250].map((delay) =>
      setTimeout(() => {
        if (userTookOver.current) return;
        scrollRef.current?.scrollToEnd({ animated: false });
      }, delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [visible, scrollToEndOnOpen]);
  if (!mounted) return null;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [sheetHeight, 0],
  });

  return (
    <Modal visible transparent animationType="none" onRequestClose={closeNow}>
      <View style={styles.overlay}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.scrim, { opacity: progress }]}
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            hapticTap("light");
            closeNow();
          }}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <Animated.View
          style={[
            styles.sheet,
            { height: sheetHeight, transform: [{ translateY }] },
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <PressableRow
              style={styles.close}
              onPress={closeNow}
              haptic="light"
              accessibilityLabel="Close"
            >
              <Icon name="close" size={18} color={THEME.colors.textSecondary} />
            </PressableRow>
          </View>
          {actions ? <View style={styles.actions}>{actions}</View> : null}
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.content}
            stickyHeaderIndices={stickyHeaderIndices}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={() => {
              userTookOver.current = true;
            }}
            onTouchStart={() => {
              userTookOver.current = true;
            }}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  scrim: {
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
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
    paddingHorizontal: THEME.spacing.lg,
    paddingVertical: THEME.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.colors.border,
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
