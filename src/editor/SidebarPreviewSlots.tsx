import { createPluginContext } from "../content/plugin-context";
// Plugin-driven slot in the Files sidebar. Each registered preview plugin
// whose scope is "project" or "workspace" gets a row at the top of the
// tree listing its instances; tapping an instance opens it through the
// plugin's own `open()` entry point. Plugins with scope "file" do not
// render here — they are reached by tapping a file in the tree below.
//
// This component intentionally stays plugin-neutral: no reference to
// web-preview / markdown / lark-working-copy ids, no plugin-specific CSS.
// All plugin-shaped data is read through the registry + the generic
// `usePluginInstances` hook.

import { useCallback, useLayoutEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { listPreviewPlugins, type PreviewPlugin, type PreviewInstance } from "../plugins";
import { usePluginInstances } from "../plugins/use-plugin-instances";
import { useContentStore } from "../content/content-store";
import { useFilesStore } from "../stores/files-store";
import { useSessionStore } from "../stores/session-store";
import { useConnectionStore } from "../stores/connection-store";
import { Icon } from "../components/Icon";
import { PressableRow } from "../components/PressableRow";
import { THEME } from "../styles/theme";

interface Props {
  onOpened?: () => void;
}

export function SidebarPreviewSlots({ onOpened }: Props) {
  // The registry is populated at import time; a plain snapshot is enough —
  // there is no live mutation after startup.
  const plugins = listPreviewPlugins().filter((p) => p.scope !== "file");
  const [visiblePluginIds, setVisiblePluginIds] = useState<Set<string>>(
    () => new Set(),
  );
  const onVisibilityChange = useCallback((pluginId: string, visible: boolean) => {
    setVisiblePluginIds((current) => {
      if (current.has(pluginId) === visible) return current;
      const next = new Set(current);
      if (visible) next.add(pluginId);
      else next.delete(pluginId);
      return next;
    });
  }, []);
  if (plugins.length === 0) return null;
  return (
    <View style={visiblePluginIds.size > 0 ? styles.section : undefined}>
      {visiblePluginIds.size > 0 ? (
        <Text style={styles.sectionTitle}>Previews</Text>
      ) : null}
      {plugins.map((plugin) => (
        <PluginSlot
          key={plugin.id}
          plugin={plugin}
          onOpened={onOpened}
          onVisibilityChange={onVisibilityChange}
        />
      ))}
    </View>
  );
}

function PluginSlot({
  plugin,
  onOpened,
  onVisibilityChange,
}: {
  plugin: PreviewPlugin;
  onOpened?: () => void;
  onVisibilityChange: (pluginId: string, visible: boolean) => void;
}) {
  const instances = usePluginInstances(plugin.id);
  const activeContent = useContentStore((state) => state.active);
  const cwd = useFilesStore((s) => s.cwd);
  const workspaceId = useSessionStore((s) => s.workspaceId);
  const client = useConnectionStore((s) => s.client);
  // Transient per-instance loading flag so the row shows a spinner during
  // the first open. Keyed by instance key so switching one instance does
  // not visually block another.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  useLayoutEffect(() => {
    onVisibilityChange(plugin.id, instances.length > 0);
  }, [instances.length, onVisibilityChange, plugin.id]);
  if (instances.length === 0 && !plugin.open) {
    // Plugin has no instances yet and no way to open — nothing to render.
    return null;
  }

  async function open(instance: PreviewInstance) {
    if (busyKey) return;
    setBusyKey(instance.key);
    try {
      await plugin.open?.(createPluginContext(client, cwd, workspaceId), instance.target);
      onOpened?.();
    } finally {
      setBusyKey(null);
    }
  }

  // Collapse into a single-row affordance when the plugin only has one
  // instance — avoids a tall placeholder for the common case.
  if (instances.length <= 1) {
    const first = instances[0];
    if (!first) return null;
    const isActive = activeContent.pluginId === plugin.id;
    return (
      <PressableRow
        style={[styles.row, isActive && styles.rowActive]}
        onPress={() => open(first)}
        disabled={busyKey !== null}
        haptic="light"
      >
        <View style={styles.inner}>
          <View style={styles.iconBadge}>
            {busyKey === first.key ? (
              <ActivityIndicator size="small" color={THEME.colors.primary} style={styles.spinner} />
            ) : (
              <Icon name="target" size={15} color={THEME.colors.primary} />
            )}
          </View>
          <Text style={styles.label}>{first.label}</Text>
        </View>
      </PressableRow>
    );
  }

  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{plugin.title}</Text>
      {instances.map((instance) => {
        const isActive =
          activeContent.pluginId === plugin.id && activeContent.instanceKey === instance.key;
        return (
          <PressableRow
            key={instance.key || "__root__"}
            style={[styles.row, isActive && styles.rowActive]}
            onPress={() => open(instance)}
            disabled={busyKey !== null}
            haptic="light"
          >
            <View style={styles.inner}>
              <View style={styles.iconBadge}>
                {busyKey === instance.key ? (
                  <ActivityIndicator size="small" color={THEME.colors.primary} style={styles.spinner} />
                ) : (
                  <Icon name="target" size={15} color={THEME.colors.primary} />
                )}
              </View>
              <Text style={styles.label} numberOfLines={1}>
                {instance.label}
              </Text>
            </View>
          </PressableRow>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: THEME.spacing.xs,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: THEME.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.7,
    paddingHorizontal: THEME.spacing.md,
    paddingBottom: THEME.spacing.xs,
  },
  group: {
    marginBottom: THEME.spacing.sm,
  },
  groupTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: THEME.colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: THEME.spacing.md,
    paddingTop: THEME.spacing.xs,
    paddingBottom: 4,
  },
  row: {
    marginBottom: THEME.spacing.xs,
    borderRadius: 11,
    backgroundColor: THEME.colors.background,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  rowActive: {
    backgroundColor: THEME.colors.surface,
    borderColor: "#d6dee7",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
    paddingHorizontal: THEME.spacing.sm,
    paddingVertical: 8,
  },
  iconBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: THEME.colors.surface,
  },
  spinner: {
    width: 15,
    transform: [{ scale: 0.72 }],
  },
  label: {
    fontSize: 15,
    color: THEME.colors.text,
    fontWeight: "500",
    flexShrink: 1,
  },
});
