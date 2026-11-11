import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Pressable,
  TouchableOpacity,
} from "react-native";
import {
  isSessionRestoreSuperseded,
  useSessionStore,
} from "../stores/session-store";
import { useConnectionStore } from "../stores/connection-store";
import {
  catalogItemKey,
  useBackendCatalog,
  useBackendCatalogStore,
  type BackendCatalogEntry,
} from "../stores/backend-catalog-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { useWriterOpeningStore } from "../stores/writer-opening-store";
import { normalizeWorkspaceCwd } from "../stores/workspace-session-key";
import { ActivityRow, ChatMessageItem } from "./ChatMessageItem";
import { ActivityDot } from "../components/TypingDots";
import { ChatInput } from "./ChatInput";
import {
  ModelSwitcher,
  ProviderModelPickerModal,
  type ProviderModelSelection,
} from "./ModelSwitcher";
import { Icon } from "../components/Icon";
import { hapticTap } from "../components/PressableRow";
import { THEME } from "../styles/theme";
import type { StreamItem, ThoughtItem, ToolCallItem } from "../types/stream";
import type { BackendAgentEntry } from "../backend";

// A run of consecutive tool calls collapses into a single activity row that
// only reports the step count and what the latest step is doing, instead of
// stacking one bulky row per call.
type DisplayRow =
  | { type: "item"; key: string; item: StreamItem }
  | { type: "activity"; key: string; items: Array<ThoughtItem | ToolCallItem> }
  // Shown between sending and the first streamed step, so the turn never looks
  // like it was swallowed.
  | { type: "pending"; key: string };

function groupRows(items: StreamItem[]): DisplayRow[] {
  const rows: DisplayRow[] = [];
  let run: Array<ThoughtItem | ToolCallItem> = [];

  const flushRun = () => {
    if (run.length === 0) return;
    const last = run[run.length - 1]!;
    rows.push({ type: "activity", key: `activity-${last.id}`, items: run });
    run = [];
  };

  for (const item of items) {
    // Reasoning and tool calls are one continuous activity stream: the agent
    // thinks, acts, thinks again, and the transcript reads better as one row.
    if (item.kind === "thought" || item.kind === "tool_call") {
      run.push(item);
      continue;
    }
    flushRun();
    rows.push({ type: "item", key: item.id, item });
  }
  flushRun();
  return rows;
}

interface TimelineSnapshot {
  tail: StreamItem[];
  head: StreamItem[];
}

// Streaming providers can emit several timeline fragments inside one browser
// frame. Keep the canonical store lossless, but coalesce the visual transcript
// to at most one React update per frame so typing, scrolling, and drawer input
// stay responsive while a reply is arriving.
function useRenderTimeline(): TimelineSnapshot {
  const [timeline, setTimeline] = useState<TimelineSnapshot>(() => {
    const state = useSessionStore.getState();
    return { tail: state.tail, head: state.head };
  });

  useEffect(() => {
    let latest: TimelineSnapshot = timeline;
    let frame: number | null = null;

    const commit = () => {
      frame = null;
      const next = latest;
      setTimeline((current) =>
        current.tail === next.tail && current.head === next.head ? current : next,
      );
    };

    const schedule = () => {
      if (Platform.OS !== "web" || typeof window === "undefined") {
        commit();
        return;
      }
      if (frame === null) frame = window.requestAnimationFrame(commit);
    };

    const unsubscribe = useSessionStore.subscribe(
      (state) => ({ tail: state.tail, head: state.head }),
      (next) => {
        latest = next;
        schedule();
      },
      {
        equalityFn: (left, right) => left.tail === right.tail && left.head === right.head,
      },
    );

    const current = useSessionStore.getState();
    if (current.tail !== latest.tail || current.head !== latest.head) {
      latest = { tail: current.tail, head: current.head };
      schedule();
    }

    return () => {
      unsubscribe();
      if (frame !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(frame);
      }
    };
    // The subscription owns subsequent snapshots; it must be installed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return timeline;
}

const DisplayRowItem = memo(function DisplayRowItem({
  row,
  streaming,
}: {
  row: DisplayRow;
  streaming: boolean;
}) {
  if (row.type === "activity") {
    return <ActivityRow items={row.items} streaming={streaming} />;
  }
  if (row.type === "pending") {
    return (
      <View style={styles.pendingRow} accessible={false}>
        <ActivityDot running color="#c6c6ce" />
        <Text style={styles.pendingLabel}>Thinking</Text>
      </View>
    );
  }
  return <ChatMessageItem item={row.item} />;
});

function AgentTranscript() {
  const { tail, head } = useRenderTimeline();
  const isStreaming = useSessionStore((state) => state.isStreaming);

  // Committed history is stable for the whole duration of a streamed answer;
  // only regroup the tiny active head for each visual frame. The old path
  // copied and regrouped the entire transcript for every incoming fragment.
  const committedRows = useMemo(() => groupRows(tail), [tail]);
  const activeRows = useMemo(() => groupRows(head), [head]);
  const rows = useMemo(() => {
    const list: DisplayRow[] = [
      ...activeRows.slice().reverse(),
      ...committedRows.slice().reverse(),
    ];
    // Inverted list: index 0 is the newest row. Until the backend streams its
    // first step there is nothing to show, which reads as a dropped message.
    if (isStreaming && head.length === 0) {
      list.unshift({ type: "pending", key: "pending" });
    }
    return list;
  }, [activeRows, committedRows, isStreaming, head.length]);
  const renderItem = useCallback(
    // The list is inverted, so index 0 is the newest row. Only that row may
    // animate: older activity in the transcript is history, not progress.
    ({ item, index }: { item: DisplayRow; index: number }) => (
      <DisplayRowItem row={item} streaming={isStreaming && index === 0} />
    ),
    [isStreaming],
  );

  return (
    <FlatList
      style={styles.messageList}
      data={rows}
      keyExtractor={(row) => row.key}
      renderItem={renderItem}
      extraData={isStreaming}
      contentContainerStyle={styles.messageListContent}
      initialNumToRender={18}
      maxToRenderPerBatch={12}
      updateCellsBatchingPeriod={32}
      windowSize={7}
      removeClippedSubviews={Platform.OS !== "web"}
      inverted
    />
  );
}

interface CatalogSession {
  connectionId: string;
  agent: BackendAgentEntry["agent"];
}

function activeSessionTitle(
  sources: BackendCatalogEntry[],
  connectionId: string | null,
  activeId: string | null,
): string {
  if (!connectionId || !activeId) return "AI Assistant";
  const match = sources
    .find((source) => source.connectionId === connectionId)
    ?.sessions.find((entry) => entry.agent.id === activeId && !entry.agent.archivedAt);
  const title = match?.agent.title?.trim();
  return title || "AI Assistant";
}


export const AgentChatPanel = memo(function AgentChatPanel({
  showInput = true,
  avoidKeyboard = true,
  showHeader = true,
  onRequestClose,
  onSwitcherOpenChange,
  switcherControl,
}: {
  // On mobile the chat input is hoisted into the shared floating dock, so the
  // panel renders just the header + message list. Desktop keeps its own input.
  showInput?: boolean;
  // Whether to wrap in KeyboardAvoidingView. Off on mobile, where the dock (and
  // the root KeyboardAvoidingView) already handle keyboard avoidance.
  avoidKeyboard?: boolean;
  // Desktop renders the full title/status/model header. Mobile keeps model
  // selection inside the compact session picker opened from its title bar.
  showHeader?: boolean;
  // The session list floats inside this panel, so a page-level dock (the shared
  // composer) sits outside its bounds. These two let the host mirror the open
  // state and dim that dock with the same scrim.
  onSwitcherOpenChange?: (open: boolean) => void;
  switcherControl?: { current: (() => void) | null };
  // Mobile's agent pane passes its pane toggle here. It enables the compact
  // header and the header's right-side agent button, which switches back to the
  // document pane. Desktop keeps the full title/status/model header.
  onRequestClose?: () => void;
} = {}) {
  const opening = useWriterOpeningStore((state) => state.opening);
  const openingError = useWriterOpeningStore((state) => state.error);
  const agentId = useSessionStore((state) => state.agentId);
  const { entries, loading: sessionsLoading } = useBackendCatalog({ enabled: Boolean(agentId || openingError) });
  const isStreaming = useSessionStore((state) => state.isStreaming);
  const agentStatus = useSessionStore((state) => state.agentStatus);
  const cwd = useSessionStore((state) => state.cwd);
  const workspaceId = useSessionStore((state) => state.workspaceId);
  const provider = useSessionStore((state) => state.provider);
  const model = useSessionStore((state) => state.model);
  const client = useConnectionStore((state) => state.client);
  const connections = useConnectionStore((state) => state.connections);
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const isSwitchingConnection = useConnectionStore((state) => state.isSwitchingConnection);
  const connectionStatus = useConnectionStore((state) => state.connectionState.status);

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherBusy, setSwitcherBusy] = useState(false);
  const [switcherError, setSwitcherError] = useState<string | null>(null);
  const [newSessionPickerOpen, setNewSessionPickerOpen] = useState(false);
  const [newSessionBusy, setNewSessionBusy] = useState(false);
  const [newSessionError, setNewSessionError] = useState<string | null>(null);
  useEffect(() => {
    onSwitcherOpenChange?.(switcherOpen);
  }, [onSwitcherOpenChange, switcherOpen]);

  useEffect(() => {
    if (!switcherControl) return;
    switcherControl.current = () => setSwitcherOpen(false);
    return () => {
      switcherControl.current = null;
    };
  }, [switcherControl]);

  const operationInFlight = useRef(false);
  const operationGeneration = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operationGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    operationGeneration.current += 1;
    operationInFlight.current = false;
    setSwitcherBusy(false);
    setSwitcherError(null);
    setNewSessionBusy(false);
    setNewSessionError(null);
    setNewSessionPickerOpen(false);
  }, [client, activeConnectionId, cwd]);

  const deleteSession = useCallback(
    async (item: CatalogSession) => {
      const activeClient = useConnectionStore.getState().client;
      if (!activeClient) return;
      try {
        await activeClient.archiveAgent(item.agent.id);
        await useBackendCatalogStore
          .getState()
          .refresh(item.connectionId, { workspaces: false });
      } catch (error) {
        setSwitcherError(error instanceof Error ? error.message : "Could not delete this session.");
      }
    },
    [],
  );

  const confirmDelete = useCallback(
    (item: CatalogSession) => {
      const title = item.agent.title?.trim() || "Untitled writing session";
      Alert.alert(
        "Archive session",
        `"${title}" will be archived on the server and disappear from this list.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Archive", style: "destructive", onPress: () => void deleteSession(item) },
        ],
      );
    },
    [deleteSession],
  );

  const sessionSources = useMemo(
    () => entries.flatMap((source) => {
      if (source.connectionId !== activeConnectionId || !cwd) return [];
      const connection = connections.find((item) => item.id === source.connectionId);
      if (!connection) return [];
      return [{
        key: source.connectionId,
        source,
        status: connection.connectionState.status,
        data: source.sessions
          .filter(({ agent }) => !agent.archivedAt &&
            normalizeWorkspaceCwd(agent.cwd) === normalizeWorkspaceCwd(cwd))
          .map(({ agent }): CatalogSession => ({ connectionId: source.connectionId, agent })),
      }];
    }),
    [entries, connections, activeConnectionId, cwd],
  );
  const sessionTitle = activeSessionTitle(entries, activeConnectionId, agentId);

  async function switchToSession({ connectionId, agent }: CatalogSession) {
    const connection = useConnectionStore.getState();
    if (operationInFlight.current || useWriterOpeningStore.getState().opening || connection.isSwitchingConnection ||
      (connectionId === connection.activeConnectionId && agent.id === useSessionStore.getState().agentId)) return;
    operationInFlight.current = true;
    setSwitcherBusy(true);
    setSwitcherError(null);
    try {
      const opened = await useWriterOpeningStore.getState().open({
        connectionId, agentId: agent.id, cwd: agent.cwd, workspaceId: agent.workspaceId ?? null,
      });
      if (!mounted.current) return;
      if (opened) setSwitcherOpen(false);
      else setSwitcherError(useWriterOpeningStore.getState().error);
    } finally {
      operationInFlight.current = false;
      if (mounted.current) setSwitcherBusy(false);
    }
  }

  async function startNewSession(selection: ProviderModelSelection) {
    if (operationInFlight.current || useWriterOpeningStore.getState().opening || !cwd || !client || !activeConnectionId) return;
    const connection = useConnectionStore.getState();
    if (connection.isSwitchingConnection || connection.activeConnectionId !== activeConnectionId ||
      connection.client !== client) return;
    if (connection.connectionState.status !== "connected") {
      setNewSessionError("This backend is reconnecting. Try again in a moment.");
      return;
    }
    operationInFlight.current = true;
    const generation = ++operationGeneration.current;
    const isCurrent = () => mounted.current && generation === operationGeneration.current &&
      useConnectionStore.getState().activeConnectionId === activeConnectionId &&
      useConnectionStore.getState().client === client;
    setNewSessionError(null);
    setNewSessionBusy(true);
    try {
      const creation = useSessionStore.getState().createAgent(selection.provider, cwd, "", {
        model: selection.model ?? undefined,
        workspaceId: workspaceId ?? undefined,
      });
      const restoreGeneration = useSessionStore.getState()._restoreGeneration;
      await creation;
      if (!isCurrent() || useSessionStore.getState()._restoreGeneration !== restoreGeneration) return;
      usePreferencesStore.getState().setLastProvider(selection.provider);
      usePreferencesStore.getState().setLastModel(selection.model);
      setNewSessionPickerOpen(false);
      setSwitcherOpen(false);
      void useBackendCatalogStore.getState().refresh(activeConnectionId, { workspaces: false });
    } catch (err) {
      if (!isCurrent() || isSessionRestoreSuperseded(err)) return;
      setNewSessionError(
        err instanceof Error ? err.message : "Failed to create session",
      );
    } finally {
      if (generation === operationGeneration.current) {
        operationInFlight.current = false;
        if (mounted.current) setNewSessionBusy(false);
      }
    }
  }


  const Wrapper = avoidKeyboard ? KeyboardAvoidingView : View;
  const wrapperProps = avoidKeyboard
    ? { behavior: Platform.OS === "ios" ? ("padding" as const) : undefined }
    : {};

  return (
    <Wrapper style={styles.container} {...wrapperProps}>
      {showHeader ? (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity
              style={styles.headerSessionPicker}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel={`Choose session, current: ${sessionTitle}`}
              accessibilityState={{ expanded: switcherOpen }}
              onPress={() => {
                hapticTap("light");
                setSwitcherOpen((value) => !value);
              }}
            >
              <Text style={styles.headerTitle} numberOfLines={1}>{sessionTitle}</Text>
              <Icon
                name={switcherOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={THEME.colors.textSecondary}
              />
            </TouchableOpacity>
            {isStreaming && (
              <>
                <ActivityIndicator size="small" color={THEME.colors.primary} />
                <Text style={styles.streamingBadge}>Writing...</Text>
              </>
            )}
            {!isStreaming && agentStatus === "idle" && (
              <Text style={styles.idleBadge}>Ready</Text>
            )}
          </View>
          <ModelSwitcher />
        </View>
      ) : onRequestClose ? (
        <>
          <View style={styles.mobileHeader}>
            <View style={styles.mobileHeaderSide} />
            <TouchableOpacity
              style={styles.mobileHeaderCenter}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel={`Choose session, current: ${sessionTitle}`}
              accessibilityState={{ expanded: switcherOpen }}
              onPress={() => {
                hapticTap("light");
                setSwitcherOpen((v) => !v);
              }}
            >
              <Text style={styles.mobileHeaderTitle} numberOfLines={1}>
                {sessionTitle}
              </Text>
            </TouchableOpacity>
            {/* The caret sits on the right edge, the way the document page puts
                its pane switch there, instead of hugging the title. */}
            <TouchableOpacity
              style={[styles.mobileHeaderSide, styles.mobileHeaderAction]}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel={switcherOpen ? "Close session list" : "Open session list"}
              accessibilityState={{ expanded: switcherOpen }}
              onPress={() => {
                hapticTap("light");
                setSwitcherOpen((v) => !v);
              }}
              hitSlop={8}
            >
              <Icon
                name={switcherOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={THEME.colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      {(showHeader || onRequestClose) && switcherOpen ? (
        <Pressable
          style={styles.switcherBackdrop}
          onPress={() => setSwitcherOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close session list"
        />
      ) : null}
      {(showHeader || onRequestClose) && switcherOpen ? (
        <View style={styles.switcherPanel}>
          <View style={styles.switcherHeading}>
            <Text style={styles.switcherHeadingText}>Sessions</Text>
            <View style={styles.switcherHeadingRight}>
              {sessionsLoading || switcherBusy ? (
                <ActivityIndicator size="small" color={THEME.colors.textSecondary} />
              ) : null}
              <TouchableOpacity
                style={styles.switcherAdd}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel="Refresh sessions"
                onPress={() => {
                  hapticTap("light");
                  for (const section of sessionSources) {
                    if (section.status !== "connected") continue;
                    void useBackendCatalogStore
                      .getState()
                      .refresh(section.source.connectionId, { workspaces: false });
                  }
                }}
                disabled={sessionsLoading || sessionSources.every((section) => section.status !== "connected")}
                hitSlop={8}
              >
                <Icon name="refresh" size={15} color={THEME.colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.switcherAdd}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel="New session"
                onPress={() => {
                  hapticTap("light");
                  setSwitcherOpen(false);
                  setNewSessionError(null);
                  setNewSessionPickerOpen(true);
                }}
                disabled={
                  switcherBusy ||
                  newSessionBusy ||
                  opening ||
                  isSwitchingConnection ||
                  connectionStatus !== "connected" ||
                  !cwd
                }
                hitSlop={8}
              >
                <Icon name="plus" size={16} color={THEME.colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
          {switcherError ? <Text style={styles.switcherError}>{switcherError}</Text> : null}
          <ScrollView
            style={styles.switcherList}
            keyboardShouldPersistTaps="handled"
          >
            {sessionSources.length === 0 ? (
              <Text style={styles.switcherEmpty}>
                {sessionsLoading ? "Loading sessions…" : cwd ? "No sessions in this project." : "Select a project to see its sessions."}
              </Text>
            ) : null}
            {sessionSources.map((section) => (
              <View key={section.key}>
                {section.status !== "connected" ||
                section.source.sessionsError ||
                !section.source.sessionsLoaded ||
                section.data.length === 0 ? (
                  <View style={styles.switcherSource}>
                    {section.status !== "connected" ? (
                      <Text style={styles.switcherSourceStatus}>
                        {section.status === "connecting" ? "Reconnecting…" : "Offline"}
                      </Text>
                    ) : null}
                    {section.source.sessionsError ? (
                      <Text style={styles.switcherError}>{section.source.sessionsError}</Text>
                    ) : !section.source.sessionsLoaded ? (
                      <Text style={styles.switcherLoadingText}>Loading sessions…</Text>
                    ) : section.data.length === 0 ? (
                      <Text style={styles.switcherEmpty}>No sessions in this project.</Text>
                    ) : null}
                  </View>
                ) : null}
                {section.data.map((item) => {
                  const { connectionId, agent } = item;
                  const active = connectionId === activeConnectionId && agent.id === agentId;
                  const title = agent.title?.trim() || "Untitled writing session";
                  return (
                    <TouchableOpacity
                      key={catalogItemKey(connectionId, `session:${agent.id}`)}
                      style={[styles.switcherRow, active && styles.switcherRowActive]}
                      activeOpacity={0.6}
                      accessibilityRole="button"
                      accessibilityLabel={`${title}, ${section.source.label}, ${agent.cwd}`}
                      accessibilityState={{ selected: active }}
                      onPress={() => {
                        hapticTap("selection");
                        void switchToSession(item);
                      }}
                      disabled={switcherBusy || newSessionBusy || opening || isSwitchingConnection}
                    >
                      <View style={[
                        styles.switcherDot,
                        active ? styles.switcherDotActive : styles.switcherDotIdle,
                      ]} />
                      <View style={styles.switcherRowBody}>
                        <Text style={[styles.switcherTitle, active && styles.switcherTitleActive]} numberOfLines={1}>
                          {title}
                        </Text>
                      </View>
                      {active ? null : (
                        <TouchableOpacity
                          style={styles.switcherDelete}
                          activeOpacity={0.6}
                          accessibilityRole="button"
                          accessibilityLabel={`Archive ${title}`}
                          onPress={() => {
                            hapticTap("warning");
                            confirmDelete(item);
                          }}
                          hitSlop={8}
                        >
                          <Icon name="archive" size={15} color={THEME.colors.textMuted} />
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </ScrollView>
          {!showHeader ? (
            <View style={styles.switcherModelRow}>
              <Text style={styles.switcherModelLabel}>Model</Text>
              <ModelSwitcher />
            </View>
          ) : null}
        </View>
      ) : null}

      <ProviderModelPickerModal
        visible={newSessionPickerOpen}
        initialProvider={provider}
        initialModel={model}
        allowProviderChange
        title="New session"
        confirmLabel="Create"
        cwd={cwd}
        busy={newSessionBusy}
        error={newSessionError}
        onCancel={() => {
          if (newSessionBusy) return;
          setNewSessionError(null);
          setNewSessionPickerOpen(false);
        }}
        onConfirm={startNewSession}
      />

      <AgentTranscript />

      {showInput && <ChatInput />}
    </Wrapper>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: "relative",
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  header: {
    zIndex: 21,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: THEME.spacing.lg,
    paddingVertical: THEME.spacing.md,
    backgroundColor: THEME.colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.colors.border,
    gap: THEME.spacing.sm,
  },
  // A white tool surface over the muted transcript, matching the hierarchy of
  // the Files drawer without copying its exact content layout.
  mobileHeader: {
    height: 48,
    zIndex: 21,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: THEME.spacing.md,
    backgroundColor: THEME.colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.colors.border,
  },
  mobileHeaderSide: {
    width: 32,
    height: 32,
  },
  mobileHeaderCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // The right-hand session caret; sized like the left spacer so the title keeps
  // the screen's centre line.
  mobileHeaderAction: {
    alignItems: "center",
    justifyContent: "center",
  },
  mobileHeaderTitle: {
    fontSize: 17,
    fontWeight: "500",
    color: THEME.colors.text,
    maxWidth: 220,
  },
  // Session switcher drops a slim list under the header when expanded. Lives
  // directly under the title bar, so switching feels contiguous with the title.
  switcherBackdrop: {
    position: "absolute",
    top: 48,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 19,
    backgroundColor: "rgba(15,23,42,0.18)",
  },
  switcherPanel: {
    position: "absolute",
    top: 48,
    left: 0,
    right: 0,
    zIndex: 20,
    paddingHorizontal: THEME.spacing.lg,
    paddingTop: THEME.spacing.md,
    paddingBottom: THEME.spacing.sm,
    backgroundColor: THEME.colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e6e6ea",
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    shadowColor: "#18181b",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
    gap: 6,
  },
  switcherHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 24,
    paddingHorizontal: THEME.spacing.xs,
  },
  switcherHeadingRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
  },
  switcherAdd: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  switcherHeadingText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.08,
    textTransform: "uppercase",
    color: THEME.colors.textMuted,
  },
  switcherList: {
    maxHeight: 280,
    flexGrow: 0,
  },
  switcherSource: {
    paddingHorizontal: THEME.spacing.xs,
    paddingTop: THEME.spacing.md,
    paddingBottom: THEME.spacing.xs,
  },
  switcherSourceStatus: {
    fontSize: 13,
    color: THEME.colors.textMuted,
  },
  switcherError: {
    fontSize: 14,
    color: THEME.colors.error,
    paddingVertical: THEME.spacing.xs,
  },
  switcherRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.md,
    paddingVertical: 11,
    paddingHorizontal: THEME.spacing.md,
    borderRadius: 8,
  },
  switcherTitle: {
    fontSize: 15,
    color: THEME.colors.text,
  },
  switcherTitleActive: {
    fontWeight: "600",
  },
  switcherRowActive: {
    backgroundColor: THEME.colors.surface,
  },
  switcherRowBody: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  switcherDelete: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  switcherDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  switcherDotActive: {
    backgroundColor: THEME.colors.success,
  },
  switcherDotIdle: {
    backgroundColor: THEME.colors.border,
  },
  switcherLoadingText: {
    fontSize: 15,
    color: THEME.colors.textSecondary,
  },
  switcherEmpty: {
    fontSize: 15,
    color: THEME.colors.textMuted,
    paddingVertical: THEME.spacing.sm,
  },
  switcherModelRow: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: THEME.spacing.md,
    marginTop: THEME.spacing.sm,
    paddingTop: THEME.spacing.md,
    paddingHorizontal: THEME.spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(15, 23, 42, 0.07)",
  },
  switcherModelLabel: {
    fontSize: 14,
    color: THEME.colors.textMuted,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
    flexShrink: 1,
    minWidth: 0,
  },
  headerSessionPicker: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.xs,
    flexShrink: 1,
    minWidth: 0,
  },
  headerTitle: {
    flexShrink: 1,
    fontSize: 17,
    fontWeight: "600",
    color: THEME.colors.text,
  },
  streamingBadge: {
    fontSize: 14,
    color: THEME.colors.primary,
    fontWeight: "500",
    backgroundColor: THEME.colors.surface,
    paddingHorizontal: THEME.spacing.sm,
    paddingVertical: 3,
    borderRadius: THEME.radii.full,
  },
  idleBadge: {
    fontSize: 14,
    color: THEME.colors.textMuted,
    backgroundColor: THEME.colors.backgroundSecondary,
    paddingHorizontal: THEME.spacing.sm,
    paddingVertical: 3,
    borderRadius: THEME.radii.full,
  },
  messageList: {
    flex: 1,
  },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: THEME.spacing.sm,
    paddingHorizontal: THEME.spacing.xs,
    paddingVertical: 7,
  },
  pendingLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: THEME.colors.textMuted,
  },
  messageListContent: {
    paddingVertical: THEME.spacing.lg,
    paddingHorizontal: THEME.spacing.lg,
  },
});
