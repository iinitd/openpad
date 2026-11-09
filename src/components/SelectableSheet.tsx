import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { HalfSheet } from "./HalfSheet";
import { SelectableText } from "./SelectableText";
import { Icon } from "./Icon";
import { PressableRow } from "./PressableRow";
import { selectedSlice, splitBangTokens, tokenRange } from "./bang-tokens";
import { THEME } from "../styles/theme";

/** The tap that opens a sheet should be felt, not just seen. */
export function hapticLongPress() {
  if (Platform.OS !== "web") {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
  }
}

/**
 * A message's text in a half sheet. Two ways to take part of it:
 *
 * - read: a native text view, for drag selection and the system edit menu.
 * - explode: the message shatters into word pieces that can be tapped, which
 *   is how you copy a phrase on a touch screen without fighting handles.
 */
export function SelectableSheet({
  visible,
  text,
  onClose,
}: {
  visible: boolean;
  text: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const tokens = useMemo(() => splitBangTokens(text), [text]);

  // Drag across the pieces to take a run of them, like dragging over text.
  const rects = useRef<Array<{ x: number; y: number; w: number; h: number }>>([]);
  const anchor = useRef<number | null>(null);
  const pressStart = useRef({ x: 0, y: 0, time: 0 });

  const tokenAt = (x: number, y: number): number | null => {
    let bestIndex: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < rects.current.length; index += 1) {
      const rect = rects.current[index];
      if (!rect) continue;
      const inside =
        x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
      const dx = x - (rect.x + rect.w / 2);
      const dy = y - (rect.y + rect.h / 2);
      const distance = inside ? 0 : dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return bestIndex;
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: (event) => {
        pressStart.current = {
          x: event.nativeEvent.locationX,
          y: event.nativeEvent.locationY,
          time: Date.now(),
        };
        return false;
      },
      // A held finger that starts moving picks a range; an ordinary drag keeps
      // scrolling the sheet.
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Date.now() - pressStart.current.time > 180 &&
        Math.abs(gesture.dx) + Math.abs(gesture.dy) > 4,
      onPanResponderGrant: () => {
        const index = tokenAt(pressStart.current.x, pressStart.current.y);
        if (index === null) return;
        anchor.current = index;
        setSelected(new Set([index]));
        if (Platform.OS !== "web") {
          void Haptics.selectionAsync();
        }
      },
      onPanResponderMove: (event) => {
        if (anchor.current === null) return;
        const index = tokenAt(event.nativeEvent.locationX, event.nativeEvent.locationY);
        if (index === null) return;
        setSelected(tokenRange(anchor.current, index));
      },
      onPanResponderRelease: () => {
        anchor.current = null;
      },
      onPanResponderTerminate: () => {
        anchor.current = null;
      },
    }),
  ).current;

  useEffect(() => {
    if (!visible) {
      setCopied(false);
      setExploded(false);
      setSelected(new Set());
    }
  }, [visible]);

  const toggleToken = (index: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const copy = () => {
    const value = exploded ? selectedSlice(text, tokens, selected) : text;
    void Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <HalfSheet
      visible={visible}
      title="Message"
      onClose={onClose}
      headerActions={
        <>
          <PressableRow
            style={styles.action}
            haptic="light"
            scale={false}
            onPress={() => {
              setExploded((current) => !current);
              setSelected(new Set());
            }}
            accessibilityRole="button"
            accessibilityLabel={exploded ? "Leave word picking" : "Pick words"}
          >
            <Icon
              name="bang"
              size={17}
              color={exploded ? THEME.colors.accent : THEME.colors.textSecondary}
            />
          </PressableRow>
          <PressableRow
            style={styles.action}
            haptic="light"
            scale={false}
            onPress={copy}
            accessibilityRole="button"
            accessibilityLabel={copied ? "Copied" : "Copy message"}
          >
            <Icon
              name={copied ? "check" : "copy"}
              size={16}
              color={THEME.colors.textSecondary}
            />
          </PressableRow>
        </>
      }
    >
      {exploded ? (
        <View style={styles.exploded}>
          <View style={styles.tokens} {...responder.panHandlers}>
            {tokens.map((token, index) => {
              const active = selected.has(index);
              return (
                <PressableRow
                  key={`${token.start}`}
                  style={[styles.token, active && styles.tokenActive]}
                  haptic="selection"
                  scale={false}
                  onLayout={(event) => {
                    const { x, y, width, height } = event.nativeEvent.layout;
                    rects.current[index] = { x, y, w: width, h: height };
                  }}
                  onPress={() => toggleToken(index)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.tokenText, active && styles.tokenTextActive]}>
                    {token.text}
                  </Text>
                </PressableRow>
              );
            })}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              {selected.size === 0
                ? "Tap, or hold and drag across"
                : `${selected.size} picked`}
            </Text>
            <PressableRow
              style={styles.footerAction}
              haptic="light"
              scale={false}
              onPress={() => setSelected(new Set(tokens.map((_, index) => index)))}
              accessibilityRole="button"
              accessibilityLabel="Pick every word"
            >
              <Text style={styles.footerActionText}>All</Text>
            </PressableRow>
            <PressableRow
              style={styles.footerAction}
              haptic="light"
              scale={false}
              onPress={() => setSelected(new Set())}
              accessibilityRole="button"
              accessibilityLabel="Clear the selection"
            >
              <Text style={styles.footerActionText}>None</Text>
            </PressableRow>
          </View>
        </View>
      ) : (
        <SelectableText text={text} style={styles.text} />
      )}
    </HalfSheet>
  );
}

const styles = StyleSheet.create({
  action: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontSize: 16,
    lineHeight: 24,
    color: THEME.colors.text,
  },
  exploded: {
    gap: THEME.spacing.md,
  },
  tokens: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  token: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  tokenActive: {
    backgroundColor: THEME.colors.accentSoft,
  },
  tokenText: {
    fontSize: 16,
    lineHeight: 22,
    color: THEME.colors.text,
  },
  tokenTextActive: {
    color: THEME.colors.accent,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
    paddingTop: THEME.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: THEME.colors.border,
  },
  footerText: {
    flex: 1,
    fontSize: 12,
    color: THEME.colors.textMuted,
  },
  footerAction: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: THEME.colors.surface,
  },
  footerActionText: {
    fontSize: 12,
    fontWeight: "500",
    color: THEME.colors.textSecondary,
  },
});
