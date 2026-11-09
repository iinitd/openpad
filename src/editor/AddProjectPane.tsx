import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { BackendDirectoryEntry } from "../backend";
import { useConnectionStore } from "../stores/connection-store";
import { Icon } from "../components/Icon";
import { hapticTap } from "../components/PressableRow";
import { THEME } from "../styles/theme";

interface AddProjectPaneProps {
  sourceLabel: string;
  connectionId: string | null;
  /** Browsing starts here; the user can walk upward from it. */
  rootCwd: string | null;
  onSelect: (cwd: string, label: string) => void;
  bottomInset?: number;
}

function basename(path: string): string {
  return path.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? path;
}

function joinAbsolute(root: string, relative: string): string {
  return relative ? `${root.replace(/\/+$/, "")}/${relative}` : root.replace(/\/+$/, "");
}

function parentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function parentAbsolute(path: string): string | null {
  const normalized = path.replace(/\/+$/, "");
  if (!normalized || normalized === "/") return null;
  const index = normalized.lastIndexOf("/");
  if (index < 0) return null;
  return index === 0 ? "/" : normalized.slice(0, index);
}

/**
 * Folder browser for adding a working directory. It is a pane rather than a
 * dialog: the projects sheet hosts it, and its own header provides the way
 * back, so the two never stack.
 */
export function AddProjectPane({
  sourceLabel,
  connectionId,
  rootCwd,
  onSelect,
  bottomInset = 0,
}: AddProjectPaneProps) {
  const [browseRoot, setBrowseRoot] = useState<string | null>(rootCwd);
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<BackendDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async (nextRoot: string, nextPath: string) => {
    if (!connectionId) return;
    const client = useConnectionStore.getState().connections
      .find((connection) => connection.id === connectionId)?.client;
    if (!client) {
      setError("This connection is not available.");
      setEntries([]);
      return;
    }
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const directory = await client.listDirectory(nextRoot, nextPath);
      if (current !== generation.current) return;
      setBrowseRoot(nextRoot);
      setPath(nextPath);
      setEntries(
        directory.entries
          .filter((entry) => entry.kind === "directory")
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (cause) {
      if (current !== generation.current) return;
      setError(cause instanceof Error ? cause.message : "Could not read this folder.");
      setEntries([]);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    setBrowseRoot(rootCwd);
    setPath("");
    setEntries([]);
    setError(null);
    if (rootCwd) void load(rootCwd, "");
    return () => {
      generation.current += 1;
    };
  }, [connectionId, rootCwd, load]);

  const currentLabel = path ? basename(path) : browseRoot ? basename(browseRoot) : "";
  const currentAbsolute = browseRoot ? joinAbsolute(browseRoot, path) : null;
  const canGoUp = Boolean(browseRoot) && (path.length > 0 || parentAbsolute(browseRoot!) !== null);
  const canSelect =
    Boolean(browseRoot) && !loading && !error && (path.length > 0 || browseRoot !== rootCwd);

  function goUp() {
    if (!browseRoot || loading) return;
    if (path) {
      void load(browseRoot, parentPath(path));
      return;
    }
    const parent = parentAbsolute(browseRoot);
    if (parent) void load(parent, "");
  }

  if (!browseRoot) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.stateText}>
          Open a project on this connection first, then add folders inside it.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.pane}>
      <View style={styles.headerBand}>
        <View style={styles.pathBody}>
          <Text style={styles.pathTitle} numberOfLines={1}>
            {currentLabel || "Folder"}
          </Text>
          <Text style={styles.pathText} numberOfLines={1}>
            {sourceLabel}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      >
        {canGoUp ? (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={goUp}
            onPressIn={() => hapticTap("light")}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Go to parent folder"
          >
            <View style={styles.rowIcon}>
              <Icon name="chevron-up" size={15} color={THEME.colors.textMuted} />
            </View>
            <Text style={[styles.rowText, styles.parentText]}>Parent folder</Text>
          </Pressable>
        ) : null}
        {entries.map((entry) => (
          <Pressable
            key={entry.path}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => void load(browseRoot, entry.path)}
            onPressIn={() => hapticTap("light")}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel={`Open ${entry.name}`}
          >
            <View style={styles.rowIcon}>
              <Icon name="folder" size={16} color={THEME.colors.textSecondary} />
            </View>
            <Text style={styles.rowText} numberOfLines={1}>
              {entry.name}
            </Text>
            <Icon name="chevron-right" size={14} color={THEME.colors.textMuted} />
          </Pressable>
        ))}
        {loading ? (
          <View style={styles.stateRow}>
            <ActivityIndicator size="small" color={THEME.colors.primary} />
            <Text style={styles.stateText}>Loading folders…</Text>
          </View>
        ) : null}
        {!loading && !error && entries.length === 0 ? (
          <Text style={styles.stateText}>No subfolders here.</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: THEME.spacing.md + bottomInset }]}>
        <Text style={styles.selection}>
          {currentAbsolute
            ? currentAbsolute
            : "Open a subfolder, or go up to choose another folder."}
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.selectButton,
            !canSelect && styles.selectButtonDisabled,
            pressed && canSelect && styles.selectButtonPressed,
          ]}
          onPress={() => {
            if (!canSelect || !currentAbsolute) return;
            hapticTap("medium");
            onSelect(currentAbsolute, currentLabel);
          }}
          disabled={!canSelect}
          accessibilityRole="button"
          accessibilityLabel={canSelect ? `Add ${currentLabel} as a project` : "Select a folder first"}
        >
          <Text style={[styles.selectButtonText, !canSelect && styles.selectButtonTextDisabled]}>
            Use this folder
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: {
    flex: 1,
    backgroundColor: THEME.colors.surface,
  },
  emptyState: {
    flex: 1,
    padding: THEME.spacing.lg,
    backgroundColor: THEME.colors.surface,
  },
  headerBand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.md,
    backgroundColor: THEME.colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.colors.border,
  },
  pathBody: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  pathTitle: {
    fontSize: 16,
    letterSpacing: 0.2,
    color: THEME.colors.text,
  },
  pathText: {
    fontSize: 12,
    color: THEME.colors.textMuted,
  },
  list: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  listContent: {
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: THEME.spacing.xs,
    borderRadius: 9,
  },
  rowIcon: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  parentText: {
    color: THEME.colors.textSecondary,
  },
  rowPressed: {
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  rowText: {
    flex: 1,
    fontSize: 15,
    color: THEME.colors.text,
  },
  stateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: THEME.spacing.xl,
  },
  stateText: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
    paddingHorizontal: THEME.spacing.sm,
    paddingVertical: THEME.spacing.sm,
  },
  error: {
    fontSize: 14,
    color: THEME.colors.error,
    paddingHorizontal: THEME.spacing.sm,
    paddingVertical: THEME.spacing.sm,
  },
  footer: {
    gap: THEME.spacing.sm,
    paddingHorizontal: THEME.spacing.md,
    paddingTop: THEME.spacing.md,
    backgroundColor: THEME.colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: THEME.colors.border,
  },
  selection: {
    fontSize: 12,
    lineHeight: 17,
    color: THEME.colors.textMuted,
  },
  selectButton: {
    height: 46,
    borderRadius: THEME.radii.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: THEME.colors.primary,
  },
  selectButtonDisabled: {
    backgroundColor: THEME.colors.surface,
  },
  selectButtonPressed: {
    opacity: 0.85,
  },
  selectButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: THEME.colors.background,
  },
  selectButtonTextDisabled: {
    color: THEME.colors.textMuted,
  },
});
