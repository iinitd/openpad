import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Animated,
  Easing,
  Platform,
  Pressable,
} from "react-native";
import { catalogItemKey, useBackendCatalog, useBackendCatalogStore, type BackendCatalogEntry } from "../stores/backend-catalog-store";
import { useConnectionStore } from "../stores/connection-store";
import { useSessionStore } from "../stores/session-store";
import { useWriterOpeningStore } from "../stores/writer-opening-store";
import { getBackendPreferences, toggleBackendWorkspacePin, usePreferencesStore } from "../stores/preferences-store";
import { normalizeWorkspaceCwd } from "../stores/workspace-session-key";
import { groupDirectoryProjects, type DirectoryProject } from "./directory-projects";
import { AddProjectPane } from "./AddProjectPane";
import { PressableRow } from "../components/PressableRow";
import { Icon } from "../components/Icon";
import { THEME } from "../styles/theme";

function directoryLabel(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() || cwd;
}

// Projects group sessions by cwd within each connection. The agent pane
// owns individual session selection; backend workspace IDs remain routing data.
export function WorkspacePane({
  bottomInset = 0,
  onSwitched,
  addProjectOpen = false,
  onAddProjectOpenChange,
  showConnections = false,
  onAddConnection,
}: {
  bottomInset?: number;
  onSwitched?: () => void;
  // The mobile sheet shows the backend connections under the projects, so one
  // scroll covers "which project" and "which server".
  showConnections?: boolean;
  onAddConnection?: () => void;
  // Adding a folder is a screen of the projects sheet, not a dialog on top of
  // it, so the host owns the title and the back affordance.
  addProjectOpen?: boolean;
  onAddProjectOpenChange?: (open: boolean) => void;
} = {}) {
  const opening = useWriterOpeningStore((state) => state.opening);
  const openingError = useWriterOpeningStore((state) => state.error);
  const agentId = useSessionStore((state) => state.agentId);
  const { entries, loading } = useBackendCatalog({ enabled: Boolean(agentId || openingError) });
  const connections = useConnectionStore((state) => state.connections);
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const isSwitchingConnection = useConnectionStore((state) => state.isSwitchingConnection);
  const currentCwd = useSessionStore((state) => state.cwd);
  const activeCwd = normalizeWorkspaceCwd(currentCwd ?? "");
  // Also subscribe to inactive preference snapshots so pins update immediately.
  const preferences = usePreferencesStore();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addSource, setAddSource] = useState<BackendCatalogEntry | null>(null);
  const [addRoot, setAddRoot] = useState<string | null>(null);
  const operationInFlight = useRef(false);
  const operationGeneration = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const sources = useMemo(() => entries.map((source) => {
    const contextKey = connections.find((connection) => connection.id === source.connectionId)?.contextKey;
    const recents = getBackendPreferences(contextKey ?? null).recentWorkspaces;
    const workspaces = groupDirectoryProjects(source.workspaces, source.sessions);
    workspaces.sort((a, b) => {
      const pinnedA = Boolean(recents.find((entry) => normalizeWorkspaceCwd(entry.cwd) === a.cwd)?.pinnedAt);
      const pinnedB = Boolean(recents.find((entry) => normalizeWorkspaceCwd(entry.cwd) === b.cwd)?.pinnedAt);
      return Number(pinnedB) - Number(pinnedA) || directoryLabel(a.cwd).localeCompare(directoryLabel(b.cwd)) || a.cwd.localeCompare(b.cwd);
    });
    return { source, contextKey, workspaces };
  }), [entries, connections, preferences.recentWorkspaces, preferences.preferencesByBackend, preferences.activeBackendKey]);

  async function switchTo(source: BackendCatalogEntry, ws: DirectoryProject) {
    const key = catalogItemKey(source.connectionId, ws.cwd);
    const sameConnection = source.connectionId === activeConnectionId;
    if (operationInFlight.current || opening || isSwitchingConnection) return;
    if (sameConnection && ws.cwd === activeCwd) {
      // Re-selecting the current project is a no-op for navigation, but on a
      // drawer layout it should still dismiss the sidebar.
      onSwitched?.();
      return;
    }
    operationInFlight.current = true;
    const generation = ++operationGeneration.current;
    setBusyKey(key);
    setError(null);
    try {
      const opened = await useWriterOpeningStore.getState().open({
        connectionId: source.connectionId, cwd: ws.cwd, workspaceId: ws.id, label: ws.label,
      });
      if (!mounted.current || generation !== operationGeneration.current) return;
      if (opened) onSwitched?.();
      else setError(useWriterOpeningStore.getState().error);
    } finally {
      if (generation === operationGeneration.current) {
        operationInFlight.current = false;
        if (mounted.current) setBusyKey(null);
      }
    }
  }

  async function openFolder(source: BackendCatalogEntry, folder: string, label: string) {
    const key = catalogItemKey(source.connectionId, folder);
    if (operationInFlight.current || opening || isSwitchingConnection) return;
    operationInFlight.current = true;
    const generation = ++operationGeneration.current;
    setBusyKey(key);
    setError(null);
    try {
      const opened = await useWriterOpeningStore.getState().open({
        connectionId: source.connectionId, cwd: folder, workspaceId: null, label,
      });
      if (!mounted.current || generation !== operationGeneration.current) return;
      if (opened) {
        onSwitched?.();
        // A new directory only enters the catalog after it has a session.
        await useBackendCatalogStore.getState().refresh(source.connectionId, { workspaces: true });
      } else {
        setError(useWriterOpeningStore.getState().error);
      }
    } finally {
      if (generation === operationGeneration.current) {
        operationInFlight.current = false;
        if (mounted.current) setBusyKey(null);
      }
    }
  }

  async function openConnection(source: BackendCatalogEntry) {
    if (operationInFlight.current || opening || isSwitchingConnection) return;
    operationInFlight.current = true;
    setError(null);
    try {
      const opened = await useWriterOpeningStore.getState().open({
        connectionId: source.connectionId,
      });
      if (opened) onSwitched?.();
      else setError(useWriterOpeningStore.getState().error);
    } finally {
      operationInFlight.current = false;
    }
  }

  function addRootFor(source: BackendCatalogEntry): string | null {
    if (source.connectionId === activeConnectionId && currentCwd) return currentCwd;
    const workspace = source.workspaces.find((entry) => entry.workspaceDirectory || entry.projectRootPath);
    if (workspace) return workspace.workspaceDirectory || workspace.projectRootPath;
    return source.sessions.find((entry) => !entry.agent.archivedAt)?.agent.cwd ?? null;
  }

  function openAddProject(source: BackendCatalogEntry) {
    if (operationInFlight.current || opening || isSwitchingConnection) return;
    setError(null);
    setAddSource(source);
    setAddRoot(addRootFor(source));
    onAddProjectOpenChange?.(true);
  }

  // Leaving the screen (back, or the sheet closing) drops the browser state.
  useEffect(() => {
    if (!addProjectOpen) setAddSource(null);
  }, [addProjectOpen]);

  function renderRow(source: BackendCatalogEntry, contextKey: string | undefined, ws: DirectoryProject) {
    const key = catalogItemKey(source.connectionId, ws.cwd);
    const active = source.connectionId === activeConnectionId && ws.cwd === activeCwd;
    const recent = getBackendPreferences(contextKey ?? null).recentWorkspaces.find((entry) => normalizeWorkspaceCwd(entry.cwd) === ws.cwd);
    const pinned = Boolean(recent?.pinnedAt);
    return (
      <View key={key}>
        <PressableRow
          style={[styles.row, active && styles.rowActive]}
          onPress={() => void switchTo(source, ws)}
          haptic="selection"
          disabled={Boolean(busyKey) || opening || isSwitchingConnection}
        >
          <View style={styles.rowInner}>
            <View style={styles.rowIcon}>
              <Icon
                name="grid"
                size={16}
                color={active ? THEME.colors.text : THEME.colors.textSecondary}
              />
            </View>
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, active && styles.rowTitleActive]} numberOfLines={1} ellipsizeMode="head">
                {directoryLabel(ws.cwd)}
              </Text>
              {ws.label !== directoryLabel(ws.cwd) ? <Text style={styles.rowAlias} numberOfLines={1}>{ws.label}</Text> : null}
            </View>
            {busyKey === key ? <ActivityIndicator size="small" color={THEME.colors.primary} /> : contextKey ? (
              <Pressable
                onPress={(event) => {
                  event.stopPropagation?.();
                  toggleBackendWorkspacePin(contextKey, { id: ws.id, label: ws.label, cwd: ws.cwd });
                }}
                hitSlop={8}
                style={({ pressed }) => [styles.pinButton, pressed && styles.pinButtonPressed]}
                accessibilityLabel={pinned ? "Unpin project" : "Pin project"}
              >
                <Icon
                  name={pinned ? "star-filled" : "star"}
                  size={14}
                  color={pinned ? THEME.colors.textSecondary : "rgba(161,161,170,0.55)"}
                />
              </Pressable>
            ) : null}
          </View>
        </PressableRow>
      </View>
    );
  }

  if (addProjectOpen && addSource) {
    return (
      <AddProjectPane
        sourceLabel={addSource.label}
        connectionId={addSource.connectionId}
        rootCwd={addRoot}
        bottomInset={bottomInset}
        onSelect={(folder, label) => {
          const source = addSource;
          setAddSource(null);
          onAddProjectOpenChange?.(false);
          if (source) void openFolder(source, folder, label);
        }}
      />
    );
  }

  return (
    <>
    <ScrollView style={styles.container}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset + THEME.spacing.md }]}>
      {loading && entries.length === 0 ? (
        <View style={styles.loadingRow}><ActivityIndicator size="small" color={THEME.colors.primary} /><Text style={styles.loadingText}>Loading projects…</Text></View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {sources.map(({ source, contextKey, workspaces }) => {
        const collapsed = Boolean(preferences.collapsedProjectSources[source.connectionId]);
        const live = connections.find((connection) => connection.id === source.connectionId);
        const connected = live?.connectionState.status === "connected";
        const connecting = live?.connectionState.status === "connecting";
        const onThisConnection = source.connectionId === activeConnectionId;
        const addDisabled = Boolean(busyKey) || opening || isSwitchingConnection || !connected;
        const statusLabel = connected ? "Connected" : connecting ? "Connecting…" : "Offline";
        return (
          <View key={source.connectionId} style={styles.sourceBlock}>
            {/* The connection is the parent of its projects: one header, with
                its state, and the projects nested underneath. */}
            <View style={styles.sourceRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.sourceHeader,
                  pressed && styles.sourceHeaderPressed,
                ]}
                onPress={() => preferences.toggleProjectSource(source.connectionId)}
                accessibilityRole="button"
                accessibilityLabel={`${collapsed ? "Expand" : "Collapse"} ${source.label}`}
                accessibilityState={{ expanded: !collapsed }}
              >
                <Icon
                  name={collapsed ? "chevron-right" : "chevron-down"}
                  size={14}
                  color={THEME.colors.textMuted}
                />
                <Text style={styles.sourceLabel} numberOfLines={1}>
                  {source.label}
                </Text>
                <View style={styles.sourceSpacer} />
                <View
                  style={[
                    styles.sourceDot,
                    connected
                      ? styles.sourceDotOn
                      : connecting
                        ? styles.sourceDotPending
                        : styles.sourceDotOff,
                  ]}
                />
                <Text style={styles.sourceStatus}>{statusLabel}</Text>
              </Pressable>
              {!connected && !connecting ? (
                <PressableRow
                  style={styles.sourceAction}
                  haptic="light"
                  scale={false}
                  onPress={() => void openConnection(source)}
                  accessibilityRole="button"
                  accessibilityLabel={`Reconnect ${source.label}`}
                >
                  <Text style={styles.sourceActionText}>Reconnect</Text>
                </PressableRow>
              ) : connected && !onThisConnection ? (
                <PressableRow
                  style={styles.sourceAction}
                  haptic="light"
                  scale={false}
                  onPress={() => void openConnection(source)}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to ${source.label}`}
                >
                  <Text style={styles.sourceActionText}>Switch</Text>
                </PressableRow>
              ) : null}
            </View>

            {!collapsed ? (
              <View style={styles.sourceChildren}>
                {!source.workspacesLoaded ? (
                  <Text style={styles.loadingText}>Loading projects…</Text>
                ) : null}
                {source.workspacesError ? (
                  <>
                    <Text style={styles.error}>Projects: {source.workspacesError}</Text>
                    <PressableRow
                      onPress={() =>
                        void useBackendCatalogStore
                          .getState()
                          .refresh(source.connectionId, { workspaces: true })
                      }
                    >
                      <Text style={styles.loadingText}>Retry</Text>
                    </PressableRow>
                  </>
                ) : null}
                {source.workspacesLoaded && !source.workspacesError ? (
                  <PressableRow
                    style={[styles.addRow, addDisabled && styles.addRowDisabled]}
                    onPress={() => openAddProject(source)}
                    haptic="selection"
                    // Without this PressableRow wraps its children in an
                    // Animated.View, which loses the row direction.
                    scale={false}
                    pressedStyle={styles.addRowPressed}
                    disabled={addDisabled}
                    accessibilityRole="button"
                    accessibilityLabel={`Add a project to ${source.label}`}
                  >
                    <Icon name="plus" size={16} color={THEME.colors.text} />
                    <Text style={styles.addRowText}>New working directory</Text>
                  </PressableRow>
                ) : null}
                {workspaces.map((ws) => renderRow(source, contextKey, ws))}
                {source.workspacesLoaded && !source.workspacesError && workspaces.length === 0 ? (
                  <Text style={styles.empty}>No projects yet.</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
      {!loading && entries.length === 0 ? <Text style={styles.empty}>No backend connections available.</Text> : null}

      {showConnections ? (
        <PressableRow
          style={styles.addConnectionRow}
          haptic="light"
          scale={false}
          pressedStyle={styles.addConnectionPressed}
          onPress={() => onAddConnection?.()}
          accessibilityRole="button"
          accessibilityLabel="Add connection"
        >
          <Icon name="plus" size={16} color={THEME.colors.text} />
          <Text style={styles.addConnectionText}>Add connection</Text>
        </PressableRow>
      ) : null}
    </ScrollView>

    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingTop: THEME.spacing.xs,
    paddingHorizontal: THEME.spacing.sm,
    gap: THEME.spacing.md,
  },
  sourceBlock: {
    gap: THEME.spacing.sm,
  },
  // Same geometry as a file row: a narrow icon column, and the open item gets
  // an outline rather than a filled block.
  row: {
    borderRadius: 9,
    marginVertical: 1,
    borderWidth: 1,
    borderColor: "transparent",
  },
  rowActive: {
    backgroundColor: "rgba(255, 255, 255, 0.62)",
    borderColor: "rgba(148, 163, 184, 0.28)",
  },
  rowInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: THEME.spacing.md,
    minHeight: 36,
    paddingVertical: 3,
  },
  rowIcon: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  rowTitle: {
    fontSize: 15,
    color: THEME.colors.textSecondary,
  },
  rowTitleActive: {
    fontWeight: "600",
    color: THEME.colors.text,
  },
  rowAlias: {
    fontSize: 13,
    color: THEME.colors.textMuted,
  },
  pinButton: {
    padding: 4,
    borderRadius: 6,
  },
  pinButtonPressed: {
    opacity: 0.6,
  },
  // A white button rather than another list row: this is the one action on the
  // screen, and the border + shadow make it read as something to press.
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 40,
    marginTop: 2,
    marginBottom: THEME.spacing.xs,
    paddingHorizontal: THEME.spacing.md,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.surface,
  },
  addRowPressed: {
    backgroundColor: "#ececef",
  },
  addRowDisabled: {
    opacity: 0.45,
  },
  addRowText: {
    // The fill already marks this as a button; the label need not shout.
    fontSize: 15,
    fontWeight: "500",
    color: THEME.colors.text,
  },
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
  },
  sourceHeader: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: THEME.spacing.xs,
    borderRadius: 8,
  },
  sourceHeaderPressed: {
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  sourceSpacer: {
    flex: 1,
  },
  // Hierarchy through size and tone, not weight: the connection reads as a
  // heading because it is larger and darker than the project names below it.
  sourceLabel: {
    flexShrink: 1,
    fontSize: 16,
    letterSpacing: 0.2,
    color: THEME.colors.text,
  },
  sourceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sourceDotOn: { backgroundColor: THEME.colors.success },
  sourceDotPending: { backgroundColor: THEME.colors.warning },
  sourceDotOff: { backgroundColor: THEME.colors.textMuted },
  sourceStatus: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
  },
  sourceAction: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  sourceActionText: {
    fontSize: 12,
    fontWeight: "600",
    color: THEME.colors.textSecondary,
  },
  sourceChildren: {
    gap: 2,
    paddingLeft: THEME.spacing.md,
    marginLeft: 3,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: THEME.colors.border,
  },
  addConnectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 40,
    marginTop: THEME.spacing.md,
    marginHorizontal: THEME.spacing.xs,
    paddingHorizontal: THEME.spacing.md,
    borderRadius: 9,
    backgroundColor: THEME.colors.surface,
  },
  addConnectionPressed: {
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  addConnectionText: {
    fontSize: 15,
    fontWeight: "500",
    color: THEME.colors.text,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
    padding: THEME.spacing.md,
  },
  loadingText: {
    fontSize: 15,
    color: THEME.colors.textSecondary,
  },
  error: {
    fontSize: 15,
    color: THEME.colors.error,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.sm,
  },
  empty: {
    fontSize: 15,
    color: THEME.colors.textMuted,
    padding: THEME.spacing.md,
  },
});
