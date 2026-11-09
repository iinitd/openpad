import { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { HalfSheet } from "./HalfSheet";
import { SelectableText } from "./SelectableText";
import { Icon } from "./Icon";
import { PressableRow } from "./PressableRow";
import { selectedSlice, splitBangTokens } from "./bang-tokens";
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
          <View style={styles.tokens}>
            {tokens.map((token, index) => {
              const active = selected.has(index);
              return (
                <PressableRow
                  key={`${token.start}`}
                  style={[styles.token, active && styles.tokenActive]}
                  haptic="selection"
                  scale={false}
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
                ? "Tap words to pick them"
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
