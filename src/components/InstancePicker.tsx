// Instance picker shared by preview surfaces.
//
// Shows a tappable pill in the top bar labelled with the current instance.
// When the plugin exposes more than one instance, tapping it opens a modal
// sheet listing the alternatives. If there is only one (or zero) instance
// the pill becomes a plain, non-tappable label — no empty affordance.
//
// This component intentionally stays unaware of which plugin is active —
// the caller supplies the instance list, the active key, and the switch
// handler. That keeps it reusable for lark-working-copy in Phase 3.

import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { PreviewInstance } from "../plugins";
import { Icon } from "./Icon";
import { THEME } from "../styles/theme";

interface Props {
  // Plugin-friendly label shown as the sheet header, e.g. "Web Preview".
  title: string;
  // The instance list to pick from. Each entry is already labelled.
  instances: PreviewInstance[];
  // Which instance key is currently active. May be absent when the picker
  // mounts before `listInstances` resolves — in that case we fall back to
  // the first entry so the pill always shows something.
  activeKey: string | null;
  // Called with the chosen instance key. Awaited internally so the sheet
  // can disable rows and show a transient spinner during slow switches.
  onSelect: (key: string) => Promise<void> | void;
}

export function InstancePicker({ title, instances, activeKey, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const active =
    instances.find((instance) => instance.key === activeKey) ?? instances[0] ?? null;
  if (!active) {
    // Nothing to show. The parent decides whether to render a placeholder.
    return null;
  }

  const canSwitch = instances.length > 1;

  async function handlePick(key: string) {
    if (!canSwitch || key === active?.key) {
      setOpen(false);
      return;
    }
    setBusyKey(key);
    try {
      await onSelect(key);
    } finally {
      setBusyKey(null);
      setOpen(false);
    }
  }

  return (
    <>
      <TouchableOpacity
        style={styles.pill}
        activeOpacity={0.75}
        onPress={() => canSwitch && setOpen(true)}
        disabled={!canSwitch}
        accessibilityLabel={canSwitch ? `Switch ${title}` : active.label}
      >
        <Text style={styles.pillLabel} numberOfLines={1}>
          {active.label}
        </Text>
        {canSwitch ? (
          <Icon name="chevron-down" size={12} color={THEME.colors.textSecondary} />
        ) : null}
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <ScrollView style={styles.scroll}>
              {instances.map((instance) => {
                const isActive = instance.key === active.key;
                const isBusy = busyKey === instance.key;
                return (
                  <TouchableOpacity
                    key={instance.key || "__root__"}
                    style={[styles.row, isActive && styles.rowActive]}
                    onPress={() => handlePick(instance.key)}
                    disabled={busyKey !== null}
                    activeOpacity={0.7}
                  >
                    <View style={styles.rowBody}>
                      <Text style={styles.rowLabel} numberOfLines={1}>
                        {instance.label}
                      </Text>
                      {instance.subtitle ? (
                        <Text style={styles.rowSubtitle} numberOfLines={1}>
                          {instance.subtitle}
                        </Text>
                      ) : null}
                    </View>
                    {isActive ? (
                      <Icon name="chevron-right" size={14} color={THEME.colors.primary} />
                    ) : null}
                    {isBusy ? <View style={styles.busyDot} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: THEME.spacing.sm,
    paddingVertical: 4,
    borderRadius: THEME.radii.full,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.backgroundSecondary,
    maxWidth: 220,
  },
  pillLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: THEME.colors.text,
    flexShrink: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: THEME.spacing.lg,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "70%",
    backgroundColor: "#fff",
    borderRadius: THEME.radii.lg,
    padding: THEME.spacing.lg,
    gap: THEME.spacing.sm,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: THEME.colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: THEME.spacing.xs,
  },
  scroll: {
    maxHeight: 360,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.sm,
    borderRadius: THEME.radii.md,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    marginBottom: THEME.spacing.sm,
    backgroundColor: THEME.colors.background,
  },
  rowActive: {
    borderColor: THEME.colors.primary,
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: THEME.colors.text,
  },
  rowSubtitle: {
    fontSize: 13,
    color: THEME.colors.textMuted,
  },
  busyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: THEME.colors.primary,
  },
});
