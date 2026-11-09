import { memo, useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useFilesStore, type FileNode } from "../stores/files-store";
import { useEditorStore } from "../stores/editor-store";
import { useSessionStore } from "../stores/session-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { THEME } from "../styles/theme";
import { useRouter } from "expo-router";
import { useContentStore } from "../content/content-store";
import { Icon } from "../components/Icon";
import { PressableRow } from "../components/PressableRow";
import { WorkspacePane } from "./WorkspacePane";
import { openWorkspaceDocument } from "./open-document";
import { SidebarPreviewSlots } from "./SidebarPreviewSlots";
import { startVisibilityAwarePoller } from "../utils/visibility-poller";

// Re-export so legacy callers (editor-web/native refresh, agent banners) keep
// working. The real implementation lives in open-document.ts.
export { openWorkspaceDocument };

const FILE_TREE_REFRESH_MS = 2000;

// Extensions we can meaningfully load into the text editor.
const OPENABLE = new Set([
  ".md",
  ".markdown",
  ".mdx",
  ".txt",
  ".text",
  ".html",
  ".htm",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".log",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".css",
  ".sh",
]);

export function isOpenableFile(name: string): boolean {
  return OPENABLE.has(extname(name));
}

function extname(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

interface RowProps {
  node: FileNode;
  depth: number;
  activePath: string | null;
  onOpenFile: (node: FileNode) => void;
  onSelectFolder?: (path: string) => void;
  selectedFolder?: string | null;
}

const TreeRow = memo(function TreeRow({
  node,
  depth,
  activePath,
  onOpenFile,
  onSelectFolder,
  selectedFolder,
}: RowProps) {
  const toggleDirectory = useFilesStore((state) => state.toggleDirectory);
  const isDir = node.kind === "directory";
  const openable = !isDir && OPENABLE.has(extname(node.name));
  const isActive = activePath === node.path;
  const isSelectedFolder = isDir && selectedFolder === node.path;

  return (
    <>
      <PressableRow
        style={[styles.row, isActive && styles.rowActive, isSelectedFolder && styles.rowSelected]}
        onPress={() =>
          isDir
            ? onSelectFolder
              ? onSelectFolder(node.path)
              : toggleDirectory(node.path)
            : openable && onOpenFile(node)
        }
        disabled={!isDir && !openable}
        haptic="selection"
      >
        <View style={[styles.rowInner, { paddingLeft: depth * 14 + THEME.spacing.md }]}>
          <View style={styles.rowDisclosure}>
            {isDir ? (
              node.loading ? (
                <ActivityIndicator size="small" color={THEME.colors.textMuted} />
              ) : (
                <Icon
                  name={node.expanded ? "chevron-down" : "chevron-right"}
                  size={16}
                  color={THEME.colors.textSecondary}
                />
              )
            ) : null}
          </View>
          <View style={styles.rowIcon}>
            <Icon
              name={isDir ? "folder" : "file"}
              size={16}
              color={
                isDir
                  ? THEME.colors.textSecondary
                  : openable
                    ? THEME.colors.textMuted
                    : "rgba(148,163,184,0.5)"
              }
            />
          </View>
          <Text
            style={[
              styles.name,
              isDir && styles.nameDir,
              !isDir && !openable && styles.nameDisabled,
              isActive && styles.nameActive,
            ]}
            numberOfLines={1}
          >
            {node.name}
          </Text>
        </View>
      </PressableRow>
      {isDir && node.expanded && node.children
        ? node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              onOpenFile={onOpenFile}
              onSelectFolder={onSelectFolder}
              selectedFolder={selectedFolder}
            />
          ))
        : null}
    </>
  );
});

export const FileTree = memo(function FileTree({
  onFileOpened,
  showHeader = true,
  showSettingsFooter = false,
  onOpenSettings,
  addProjectOpen = false,
  onAddProjectOpenChange,
  onCloseDrawer,
  bottomInset = 0,
  mode,
  onSelectFolder,
  selectedFolder,
}: {
  onFileOpened?: () => void;
  // Pin the sidebar to one pane (the mobile drawers each show a single one) and
  // hide the tab strip; without it the tree keeps its own Files/Projects tabs.
  mode?: "files" | "projects";
  // The mobile overlay supplies its own header, so it hides the built-in one.
  showHeader?: boolean;
  // Mobile app sidebar pins a Settings entry at the bottom; the desktop pane
  // uses the gear in the header instead.
  showSettingsFooter?: boolean;
  // The mobile sheet opens settings in place instead of pushing a route.
  onOpenSettings?: () => void;
  // Likewise for the add-project browser: the host draws its header.
  addProjectOpen?: boolean;
  onAddProjectOpenChange?: (open: boolean) => void;
  // Mobile sidebar passes a callback so Settings tap closes the drawer first.
  onCloseDrawer?: () => void;
  // Honor the safe-area bottom inset for the pinned footer.
  bottomInset?: number;
  // When set, tapping a folder selects it instead of expanding it in place —
  // the two-column browser uses this to drive its right-hand pane.
  onSelectFolder?: (path: string) => void;
  selectedFolder?: string | null;
} = {}) {
  const cwd = useFilesStore((state) => state.cwd);
  const root = useFilesStore((state) => state.root);
  const rootLoading = useFilesStore((state) => state.rootLoading);
  const error = useFilesStore((state) => state.error);
  const expandToFile = useFilesStore((s) => s.expandToFile);
  const refreshVisibleDirectories = useFilesStore((s) => s.refreshVisibleDirectories);
  const rootReady = root.length > 0;
  const documentPath = useEditorStore((state) => state.documentPath);
  // The in-flight revise target is scoped per-workspace, so the sidebar's
  // "AI editing" row only shows the agent whose cwd matches the current one.
  // When the user switches away, that workspace's row vanishes; coming back
  // restores it intact (as long as the agent is still running).
  const reviseTarget = useEditorStore((s) =>
    cwd ? s.reviseTargetsByCwd[cwd] ?? null : null,
  );
  const isStreaming = useSessionStore((s) => s.isStreaming);
  const activeContent = useContentStore((state) => state.active);
  const [openError, setOpenError] = useState<string | null>(null);
  const router = useRouter();

  const agentEditingPath =
    isStreaming &&
    reviseTarget?.documentPath &&
    reviseTarget.documentPath !== documentPath
      ? reviseTarget.documentPath
      : null;
  const agentEditingTitle = reviseTarget?.documentTitle ?? null;
  const agentEditingCwd = reviseTarget?.cwd ?? null;

  // Keep the selected tab across drawer remounts, projects and app restarts.
  const storedTab = usePreferencesStore((state) => state.sidebarTab);
  const setTab = usePreferencesStore((state) => state.setSidebarTab);
  const tab = mode ?? storedTab;

  // Reveal the currently-open document by expanding its ancestor directories,
  // so the tree opens focused on the active file rather than fully collapsed.
  // Re-runs whenever the open file changes or the root finishes loading.
  useEffect(() => {
    if (!documentPath || !rootReady) return;
    expandToFile(documentPath);
  }, [documentPath, rootReady, expandToFile]);

  // Keep the visible parts of the tree fresh so external file renames appear
  // without requiring the user to collapse/reopen directories or reconnect.
  useEffect(() => {
    if (!cwd || tab !== "files") return;
    return startVisibilityAwarePoller(
      refreshVisibleDirectories,
      FILE_TREE_REFRESH_MS,
    );
  }, [cwd, refreshVisibleDirectories, tab]);

  const handleOpenFile = useCallback(async (node: FileNode) => {
    if (!cwd) return;
    setOpenError(null);
    try {
      await openWorkspaceDocument(cwd, node.path);
      onFileOpened?.();
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : "Failed to open file");
    }
  }, [cwd, onFileOpened]);

  return (
    <View style={styles.container}>
      {showHeader ? (
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {cwd ? cwd.split("/").filter(Boolean).slice(-1)[0] || cwd : "Files"}
          </Text>
          {rootLoading ? (
            <ActivityIndicator size="small" color={THEME.colors.primary} />
          ) : (
            <TouchableOpacity
              onPress={() => router.push("/writer/settings")}
              hitSlop={8}
              accessibilityLabel="Settings"
            >
              <Icon name="settings" size={18} color={THEME.colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      ) : null}

      {mode ? null : (
      <View style={styles.tabBar}>
        <TouchableOpacity
          onPress={() => setTab("files")}
          style={[styles.tab, tab === "files" && styles.tabActive]}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabLabel, tab === "files" && styles.tabLabelActive]}>
            Files
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setTab("projects")}
          style={[styles.tab, tab === "projects" && styles.tabActive]}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabLabel, tab === "projects" && styles.tabLabelActive]}>
            Projects
          </Text>
        </TouchableOpacity>
      </View>
      )}

      {tab === "projects" ? (
        <WorkspacePane
          bottomInset={bottomInset}
          onSwitched={onFileOpened}
          addProjectOpen={addProjectOpen}
          onAddProjectOpenChange={onAddProjectOpenChange}
        />
      ) : (
        <ScrollView style={styles.tree} contentContainerStyle={styles.treeContent}>
          {agentEditingPath ? (
            <PressableRow
              style={styles.agentEditingRow}
              onPress={async () => {
                if (!agentEditingCwd) return;
                setOpenError(null);
                try {
                  await openWorkspaceDocument(agentEditingCwd, agentEditingPath);
                  onFileOpened?.();
                } catch (err) {
                  setOpenError(err instanceof Error ? err.message : "Failed to open file");
                }
              }}
              haptic="light"
              accessibilityLabel={`Open ${agentEditingTitle ?? "the document being edited by the agent"}`}
            >
              <View style={styles.agentEditingInner}>
                <ActivityIndicator size="small" color={THEME.colors.primary} style={styles.plannerSpinner} />
                <View style={styles.agentEditingBody}>
                  <Text style={styles.agentEditingLabel} numberOfLines={1}>
                    AI editing
                  </Text>
                  <Text style={styles.agentEditingTitle} numberOfLines={1}>
                    {agentEditingTitle ?? agentEditingPath}
                  </Text>
                </View>
              </View>
            </PressableRow>
          ) : null}
          <SidebarPreviewSlots onOpened={onFileOpened} />
          <Text style={styles.sectionLabel}>Project files</Text>
          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : root.length === 0 && !rootLoading ? (
            <Text style={styles.empty}>No files in this workspace.</Text>
          ) : (
            root.map((node) => (
              <TreeRow
                key={node.path}
                node={node}
                depth={0}
                activePath={activeContent.path}
                onOpenFile={handleOpenFile}
                onSelectFolder={onSelectFolder}
                selectedFolder={selectedFolder}
              />
            ))
          )}
          {openError ? <Text style={styles.error}>{openError}</Text> : null}
        </ScrollView>
      )}
      {showSettingsFooter ? (
        <PressableRow
          style={[styles.settingsFooter, { paddingBottom: THEME.spacing.md + bottomInset }]}
          onPress={() => {
            if (onOpenSettings) {
              onOpenSettings();
              return;
            }
            onCloseDrawer?.();
            router.push("/writer/settings");
          }}
          haptic="light"
          accessibilityLabel="Settings"
        >
          <View style={styles.settingsFooterInner}>
            <Icon name="settings" size={17} color={THEME.colors.textSecondary} />
            <Text style={styles.settingsFooterLabel}>Settings</Text>
          </View>
        </PressableRow>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: THEME.spacing.lg,
    paddingVertical: THEME.spacing.md,
    gap: THEME.spacing.sm,
    backgroundColor: THEME.colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.colors.border,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: THEME.colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  // Sibling-tab strip under the sidebar header. Keeps the tabs flush with the
  // tree below so switching tabs feels like filtering, not navigating away.
  tabBar: {
    flexDirection: "row",
    marginHorizontal: THEME.spacing.md,
    marginVertical: THEME.spacing.xs,
    padding: 2,
    gap: 2,
    borderRadius: 9,
    backgroundColor: THEME.colors.surface,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: 5,
    borderRadius: 7,
  },
  tabActive: {
    backgroundColor: THEME.colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: THEME.colors.textSecondary,
  },
  tabLabelActive: {
    color: THEME.colors.text,
  },
  tree: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  treeContent: {
    paddingTop: THEME.spacing.xs,
    paddingBottom: THEME.spacing.lg,
    paddingHorizontal: THEME.spacing.sm,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.09,
    textTransform: "uppercase",
    color: THEME.colors.textMuted,
    paddingHorizontal: THEME.spacing.md,
    paddingTop: THEME.spacing.sm,
    paddingBottom: THEME.spacing.xs,
  },
  row: {
    borderRadius: 9,
    marginVertical: 1,
    borderWidth: 1,
    borderColor: "transparent",
  },
  agentEditingRow: {
    marginHorizontal: 4,
    marginBottom: THEME.spacing.sm,
    borderRadius: 10,
    backgroundColor: THEME.colors.surface,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  agentEditingInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: 10,
  },
  agentEditingBody: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  agentEditingLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: THEME.colors.textSecondary,
  },
  agentEditingTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: THEME.colors.text,
  },
  // Shared spinner sizing for the agent-editing row (plugin slots have their
  // own copy to avoid cross-file style coupling).
  plannerSpinner: {
    width: 16,
    transform: [{ scale: 0.72 }],
  },
  rowSelected: {
    backgroundColor: THEME.colors.accentSoft,
  },
  rowActive: {
    backgroundColor: "rgba(255, 255, 255, 0.62)",
    borderColor: "rgba(148, 163, 184, 0.28)",
  },
  rowInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingRight: THEME.spacing.md,
    minHeight: 36,
    paddingVertical: 3,
  },
  rowDisclosure: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  rowIcon: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    fontSize: 15,
    color: THEME.colors.textSecondary,
    flexShrink: 1,
  },
  nameDir: {
    fontWeight: "500",
    color: THEME.colors.text,
  },
  nameDisabled: {
    color: THEME.colors.textMuted,
  },
  nameActive: {
    color: THEME.colors.text,
    fontWeight: "600",
  },
  error: {
    fontSize: 15,
    color: THEME.colors.error,
    padding: THEME.spacing.lg,
  },
  empty: {
    fontSize: 16,
    color: THEME.colors.textMuted,
    padding: THEME.spacing.lg,
  },
  settingsFooter: {
    paddingHorizontal: THEME.spacing.lg,
    paddingVertical: THEME.spacing.md,
    backgroundColor: THEME.colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: THEME.colors.border,
  },
  settingsFooterInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
  },
  settingsFooterLabel: {
    fontSize: 15,
    color: THEME.colors.text,
    fontWeight: "500",
  },
});
