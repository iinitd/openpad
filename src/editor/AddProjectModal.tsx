import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { BackendDirectoryEntry } from "../backend";
import { useConnectionStore } from "../stores/connection-store";
import { Icon } from "../components/Icon";
import { THEME } from "../styles/theme";

interface AddProjectModalProps {
  visible: boolean;
  sourceLabel: string;
  connectionId: string | null;
  /** Browsing starts here; the user can walk upward from it. */
  rootCwd: string | null;
  onClose: () => void;
  onSelect: (cwd: string, label: string) => void;
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

export function AddProjectModal({
  visible,
  sourceLabel,
  connectionId,
  rootCwd,
  onClose,
  onSelect,
}: AddProjectModalProps) {
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
      setEntries(directory.entries
        .filter((entry) => entry.kind === "directory")
        .sort((a, b) => a.name.localeCompare(b.name)));
    } catch (cause) {
      if (current !== generation.current) return;
      setError(cause instanceof Error ? cause.message : "Could not read this folder.");
      setEntries([]);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    if (!visible) return;
    setBrowseRoot(rootCwd);
    setPath("");
    setEntries([]);
    setError(null);
    if (rootCwd) void load(rootCwd, "");
  }, [visible, connectionId, rootCwd, load]);

  useEffect(() => {
    if (visible) return;
    generation.current += 1;
  }, [visible]);

  const currentLabel = path ? basename(path) : browseRoot ? basename(browseRoot) : "";
  const currentAbsolute = browseRoot ? joinAbsolute(browseRoot, path) : null;
  const canGoUp = Boolean(browseRoot) && (path.length > 0 || parentAbsolute(browseRoot!) !== null);
  const canSelect = Boolean(browseRoot) && !loading && !error &&
    (path.length > 0 || browseRoot !== rootCwd);

  function goUp() {
    if (!browseRoot || loading) return;
    if (path) {
      void load(browseRoot, parentPath(path));
      return;
    }
    const parent = parentAbsolute(browseRoot);
    if (parent) void load(parent, "");
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close add project dialog" />
        <View style={styles.card}>
          <View style={styles.header}>
            <Pressable
              onPress={goUp}
              disabled={!canGoUp || loading}
              hitSlop={6}
              style={({ pressed }) => [
                styles.upButton,
                (!canGoUp || loading) && styles.upButtonDisabled,
                pressed && canGoUp && styles.upButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Go to parent folder"
              accessibilityState={{ disabled: !canGoUp }}
            >
              <Icon name="chevron-up" size={18} color={THEME.colors.textSecondary} />
            </Pressable>
            <View style={styles.headerText}>
              <Text style={styles.title}>Add project</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{sourceLabel}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Icon name="close" size={18} color={THEME.colors.textSecondary} />
            </Pressable>
          </View>

          {browseRoot ? (
            <>
              <Text style={styles.rootPath} numberOfLines={1}>{browseRoot}</Text>
              <View style={styles.breadcrumb}>
                <Text style={styles.breadcrumbText} numberOfLines={1}>
                  {`/${path ? path : ""}`}
                </Text>
              </View>

              <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
                {canGoUp ? (
                  <Pressable
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                    onPress={goUp}
                    disabled={loading}
                    accessibilityRole="button"
                    accessibilityLabel="Go to parent folder"
                  >
                    <Icon name="chevron-up" size={16} color={THEME.colors.textSecondary} />
                    <Text style={styles.rowText}>…</Text>
                  </Pressable>
                ) : null}
                {entries.map((entry) => (
                  <Pressable
                    key={entry.path}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                    onPress={() => void load(browseRoot, entry.path)}
                    disabled={loading}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${entry.name}`}
                  >
                    <Icon name="folder" size={16} color={THEME.colors.textSecondary} />
                    <Text style={styles.rowText} numberOfLines={1}>{entry.name}</Text>
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

              <View style={styles.footer}>
                <Text style={styles.selection} numberOfLines={1}>
                  {path || (browseRoot && browseRoot !== rootCwd)
                    ? `Select: ${currentLabel}`
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
            </>
          ) : (
            <Text style={styles.stateText}>
              Open a project on this connection first, then add folders inside it.
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.32)",
    alignItems: "center",
    justifyContent: "center",
    padding: THEME.spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "82%",
    borderRadius: THEME.radii.lg,
    backgroundColor: THEME.colors.background,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    padding: THEME.spacing.lg,
    gap: THEME.spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: THEME.spacing.md,
  },
  upButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -2,
  },
  upButtonDisabled: {
    opacity: 0.3,
  },
  upButtonPressed: {
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: THEME.colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
  },
  rootPath: {
    fontSize: 14,
    color: THEME.colors.textMuted,
    fontFamily: THEME.fonts.mono,
  },
  breadcrumb: {
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: THEME.radii.md,
    backgroundColor: THEME.colors.backgroundSecondary,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.sm,
  },
  breadcrumbText: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
    fontFamily: THEME.fonts.mono,
  },
  list: {
    maxHeight: 340,
  },
  listContent: {
    gap: 2,
    paddingVertical: THEME.spacing.xs,
  },
  row: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.sm,
    borderRadius: THEME.radii.md,
  },
  rowPressed: {
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    color: THEME.colors.text,
  },
  stateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
    padding: THEME.spacing.md,
  },
  stateText: {
    fontSize: 15,
    color: THEME.colors.textSecondary,
    padding: THEME.spacing.md,
  },
  error: {
    fontSize: 15,
    color: THEME.colors.error,
    padding: THEME.spacing.md,
  },
  footer: {
    gap: THEME.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
    paddingTop: THEME.spacing.md,
  },
  selection: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
  },
  selectButton: {
    borderRadius: THEME.radii.md,
    backgroundColor: THEME.colors.primary,
    paddingVertical: THEME.spacing.md,
    alignItems: "center",
  },
  selectButtonDisabled: {
    opacity: 0.45,
  },
  selectButtonPressed: {
    opacity: 0.85,
  },
  selectButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  selectButtonTextDisabled: {
    color: "#fff",
  },
});
