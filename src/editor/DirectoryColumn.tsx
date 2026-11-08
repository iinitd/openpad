import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon } from "../components/Icon";
import { PressableRow } from "../components/PressableRow";
import { useConnectionStore } from "../stores/connection-store";
import { THEME } from "../styles/theme";

interface Entry {
  name: string;
  path: string;
  kind: "file" | "directory";
}

function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    const aHidden = a.name.startsWith(".");
    const bHidden = b.name.startsWith(".");
    if (aHidden !== bHidden) return aHidden ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The right-hand column of the two-pane file browser: the direct children of
 * one folder. Folders navigate deeper inside the column, files open and dismiss
 * the sheet. It reads through the backend rather than the file-tree store so it
 * can show any folder without expanding the tree on the left.
 */
export function DirectoryColumn({
  cwd,
  path,
  onNavigate,
  onOpenFile,
}: {
  cwd: string;
  path: string;
  onNavigate: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const client = useConnectionStore((state) => state.client);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !cwd) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    client
      .listDirectory(cwd, path)
      .then((directory) => {
        if (cancelled) return;
        setEntries(
          sortEntries(
            directory.entries.map((entry) => ({
              name: entry.name,
              path: entry.path,
              kind: entry.kind,
            })),
          ),
        );
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setEntries([]);
        setError(err instanceof Error ? err.message : "Could not read this folder.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, cwd, path]);

  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const title = path.split("/").filter(Boolean).pop() || path || "Files";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <PressableRow
          style={[styles.back, !parent && styles.backHidden]}
          onPress={() => onNavigate(parent)}
          disabled={!parent}
          haptic="light"
          accessibilityLabel="Up one folder"
        >
          <Icon name="chevron-right" size={15} color={THEME.colors.textSecondary} />
        </PressableRow>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {loading ? <ActivityIndicator size="small" color={THEME.colors.textMuted} /> : null}
      </View>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {entries.map((entry) => (
            <PressableRow
              key={entry.path}
              style={styles.row}
              onPress={() =>
                entry.kind === "directory" ? onNavigate(entry.path) : onOpenFile(entry.path)
              }
              haptic="selection"
            >
              <Icon
                name={entry.kind === "directory" ? "folder" : "file"}
                size={16}
                color={THEME.colors.textSecondary}
              />
              <Text style={styles.name} numberOfLines={1}>
                {entry.name}
              </Text>
              {entry.kind === "directory" ? (
                <Icon name="chevron-right" size={14} color={THEME.colors.textMuted} />
              ) : null}
            </PressableRow>
          ))}
          {!loading && entries.length === 0 && !error ? (
            <Text style={styles.empty}>Empty folder</Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minWidth: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: "#f0f0f2",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.xs,
    paddingHorizontal: THEME.spacing.sm,
    paddingVertical: THEME.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f0f0f2",
  },
  back: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "180deg" }],
  },
  backHidden: {
    opacity: 0,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: THEME.colors.text,
  },
  list: {
    paddingVertical: THEME.spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
    paddingHorizontal: THEME.spacing.sm,
    paddingVertical: 9,
  },
  name: {
    flex: 1,
    fontSize: 15,
    color: THEME.colors.text,
  },
  empty: {
    fontSize: 14,
    color: THEME.colors.textMuted,
    padding: THEME.spacing.md,
  },
  error: {
    fontSize: 14,
    color: THEME.colors.error,
    padding: THEME.spacing.md,
  },
});
