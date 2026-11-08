import { createPluginContext } from "../../src/content/plugin-context";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  Modal,
  StyleSheet,
  Animated,
  Easing,
  Platform,
  Keyboard,
  PanResponder,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { THEME } from "../../src/styles/theme";
import { AgentChatPanel } from "../../src/agent/AgentChatPanel";
import { ChatInput } from "../../src/agent/ChatInput";
import { Icon } from "../../src/components/Icon";
import { PressableRow } from "../../src/components/PressableRow";
import { ContentPreview } from "../../src/content/ContentPreview";
import { DocumentCommentBar } from "../../src/editor/DocumentCommentBar";
import { FileTree, openWorkspaceDocument } from "../../src/editor/FileTree";
import { DirectoryColumn } from "../../src/editor/DirectoryColumn";
import { useConnectionStore } from "../../src/stores/connection-store";
import { useSessionStore } from "../../src/stores/session-store";
import { useWriterOpeningStore } from "../../src/stores/writer-opening-store";
import { normalizeWorkspaceCwd } from "../../src/stores/workspace-session-key";
import { useEditorStore } from "../../src/stores/editor-store";
import { useFilesStore } from "../../src/stores/files-store";
import { usePreferencesStore } from "../../src/stores/preferences-store";
import { useKeyboardInset } from "../../src/hooks/use-keyboard-inset";
import { useRouter } from "expo-router";
import { useContentStore } from "../../src/content/content-store";
import { useWebPreviewStore } from "../../src/web-preview/web-preview-store";
import { useWatchWebPreview } from "../../src/web-preview/use-watch-web-preview";
import { getPlugin, listPreviewPlugins } from "../../src/plugins";
import { discoverPluginInstances } from "../../src/plugins/plugin-instance-cache";
import { measureStartupTrace, noteStartupTrace } from "../../src/utils/startup-trace";

const COMPACT_BREAKPOINT = 576;
const PHONE_PORTRAIT_MAX_SHORT_SIDE = 700;

// A phone in portrait should keep the mobile shell even when its reported
// viewport is wider than the desktop breakpoint (foldables, desktop-site mode,
// or an embedded web view). iPadOS uses a Macintosh user agent, so tablets are
// only caught by the phone-sized short-side check.
function isPhonePortraitWeb(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  const portrait = window.innerHeight >= window.innerWidth;
  if (!portrait) return false;
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone|iPod/i.test(userAgent)) return true;
  if (/Android/i.test(userAgent) && /Mobile/i.test(userAgent)) return true;
  const touch = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
  const shortSide = Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0);
  return touch && shortSide > 0 && shortSide <= PHONE_PORTRAIT_MAX_SHORT_SIDE;
}



const NOOP_COMMENT_SEND = async () => {};


export default function WriterSessionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = useConnectionStore((state) => state.client);
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const opening = useWriterOpeningStore((state) => state.opening);
  const openingError = useWriterOpeningStore((state) => state.error);
  const openingTarget = useWriterOpeningStore((state) => state.target);
  const connectionStatus = useConnectionStore((state) => state.connectionState.status);
  const isSwitchingConnection = useConnectionStore((state) => state.isSwitchingConnection);
  const agentId = useSessionStore((state) => state.agentId);
  const agentStatus = useSessionStore((state) => state.agentStatus);
  const cwd = useSessionStore((state) => state.cwd);
  const projectCwd = normalizeWorkspaceCwd(cwd ?? "");
  const workspaceId = useSessionStore((state) => state.workspaceId);
  const restoreGeneration = useSessionStore((state) => state._restoreGeneration);
  const preferencesHydrated = usePreferencesStore((state) => state.hasHydrated);
  const loadRoot = useFilesStore((state) => state.loadRoot);
  const resetFiles = useFilesStore((state) => state.reset);
  const previousConnectionStatus = useRef(connectionStatus);
  useWatchWebPreview(cwd);

  useEffect(() => {
    // Shared opening spans connection reset through restored session metadata.
    // A failed attempt stays visible until Retry or another explicit selection.
    if (isSwitchingConnection || opening) return;
    if (!client) {
      if (!openingError) router.replace("/");
      return;
    }
    if (agentId || agentStatus === "initializing" || !preferencesHydrated || connectionStatus !== "connected") return;
    if (openingError && openingTarget?.connectionId === activeConnectionId) return;
    void useWriterOpeningStore.getState().open();
  }, [client, activeConnectionId, agentId, agentStatus, connectionStatus, preferencesHydrated,
    isSwitchingConnection, opening, openingError, openingTarget, router]);

  useEffect(() => {
    const previous = previousConnectionStatus.current;
    previousConnectionStatus.current = connectionStatus;
    if (
      previous !== "connected" &&
      connectionStatus === "connected" &&
      client &&
      agentId
    ) {
      // The SDK reconnects the transport in place, but events emitted while the
      // socket was offline are not replayed automatically. Rebase from a fresh
      // timeline window without unmounting the Writer shell.
      void useSessionStore.getState().catchUpAgent();
    }
  }, [agentId, client, connectionStatus]);

  // Load the workspace file tree for the session's working directory.
  useEffect(() => {
    if (cwd) {
      noteStartupTrace("writer/session mounted", { cwd, workspaceId });
      void measureStartupTrace("workspace.loadRoot", () => loadRoot(cwd), { cwd });
    }
    return () => resetFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectCwd]);

  // Once the root listing and persisted preferences arrive, restore the last
  // file for this workspace first. Only then fall back through plugin preview
  // → root README → empty state. Runs once per workspace load.
  const root = useFilesStore((s) => s.root);
  const rootLoading = useFilesStore((s) => s.rootLoading);
  const filesCwd = useFilesStore((s) => s.cwd);
  const autoOpenAttemptRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    autoOpenAttemptRef.current = null;
    useContentStore.getState().reset();
    useWebPreviewStore.getState().reset();
    useEditorStore.getState().resetDocument();
  }, [client, projectCwd]);
  useEffect(() => {
    if (!cwd || !client || !preferencesHydrated) return;
    if (normalizeWorkspaceCwd(filesCwd ?? "") !== projectCwd || rootLoading) return;
    const attemptKey = projectCwd;
    if (autoOpenAttemptRef.current === attemptKey) return;
    autoOpenAttemptRef.current = attemptKey;
    let cancelled = false;
    let settled = false;
    const isCurrent = () => {
      const state = useSessionStore.getState();
      return (
        !cancelled &&
        useConnectionStore.getState().client === client &&
        normalizeWorkspaceCwd(state.cwd ?? "") === projectCwd &&
        state._restoreGeneration === restoreGeneration
      );
    };

    const readme = root.find(
      (n) => n.kind === "file" && /^readme(\.|$)/i.test(n.name),
    );

    void (async () => {
      try {
        const pluginContext = createPluginContext(client, cwd, workspaceId, isCurrent);
        const rememberedFile = usePreferencesStore.getState().lastDocumentByCwd[cwd];
        if (rememberedFile) {
          noteStartupTrace("workspace auto-open: remembered file", {
            path: rememberedFile,
          });
          try {
            const opened = await measureStartupTrace(
              "workspace.openRememberedDocument",
              () => openWorkspaceDocument(cwd, rememberedFile, { isCurrent }),
              { path: rememberedFile },
            );
            if (!isCurrent()) return;
            if (opened) return;
          } catch {
            // The file may have been renamed or deleted since the last visit.
            // Continue through plugin previews, README and the empty state.
          }
        }

        const previewPlugins = listPreviewPlugins().filter(
          (plugin) => plugin.scope !== "file" && plugin.listInstances && plugin.open,
        );
        // Each plugin owns discovery. Probe all preview-capable plugins fresh and
        // in parallel; a persisted "none" result must not hide a preview that was
        // generated after the previous visit.
        const candidates = await Promise.all(
          previewPlugins.map(async (plugin) => {
            if (!plugin.listInstances) return { plugin, instances: [] };
            const instances = await discoverPluginInstances(plugin, pluginContext);
            return { plugin, instances };
          }),
        );
        if (!isCurrent()) return;

        const workspaceKey = workspaceId ?? cwd;
        for (const { plugin, instances } of candidates) {
          if (!plugin.open || instances.length === 0) continue;
          const rememberedInstance =
            useContentStore.getState().rememberedInstance(workspaceKey, plugin.id) ??
            rememberedFile;
          const instance =
            instances.find((candidate) => candidate.key === rememberedInstance) ?? instances[0]!;
          noteStartupTrace("workspace auto-open: plugin preview", {
            pluginId: plugin.id,
            instanceKey: instance.key,
          });
          try {
            const opened = await measureStartupTrace(
              `workspace.openPreviewPlugin.${plugin.id}`,
              async () => plugin.open!(pluginContext, instance.target),
              { instanceKey: instance.key },
            );
            if (!isCurrent()) return;
            if (opened === false) {
              useContentStore.getState().reset();
              continue;
            }
            return;
          } catch {
            // A candidate can disappear between discovery and open. Continue to
            // the next plugin, then README, rather than locking on the fallback.
            if (isCurrent()) useContentStore.getState().reset();
          }
        }

        if (readme) {
          noteStartupTrace("workspace auto-open: readme fallback", { path: readme.path });
          try {
            const opened = await measureStartupTrace(
              "workspace.openReadmeFallback",
              () => openWorkspaceDocument(cwd, readme.path, { isCurrent }),
              { path: readme.path },
            );
            if (!isCurrent()) return;
            if (opened) return;
          } catch {
            // Unreadable README falls through to the final empty state.
          }
        }
        if (isCurrent()) {
          useContentStore.getState().reset();
          useEditorStore.getState().showEmptyDocument();
        }
      } finally {
        settled = true;
      }
    })();
    return () => {
      cancelled = true;
      // If a dependency changed before the attempt settled (including React
      // Strict Mode's setup/cleanup probe), let the next effect retry. A
      // completed attempt stays deduplicated for this workspace identity.
      if (!settled && autoOpenAttemptRef.current === attemptKey) {
        autoOpenAttemptRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectCwd, client, filesCwd, root, rootLoading, preferencesHydrated, restoreGeneration]);

  const { width: screenWidth } = useWindowDimensions();
  const isCompact = screenWidth < COMPACT_BREAKPOINT || isPhonePortraitWeb();
  const switchingProjectSession = Boolean(openingTarget?.agentId &&
    openingTarget.connectionId === activeConnectionId && projectCwd &&
    normalizeWorkspaceCwd(openingTarget.cwd ?? "") === projectCwd);
  const showOpeningStatus = Boolean(openingError || (opening && !switchingProjectSession));

  return (
    <View style={styles.writerContainer}>
      {showOpeningStatus ? (
        <View style={[styles.openingStatus, isCompact ? { paddingTop: insets.top + THEME.spacing.sm } : null]}>
          {opening ? <ActivityIndicator size="small" color={THEME.colors.primary} /> : null}
          <Text style={[styles.openingText, openingError ? styles.openingError : null]} accessibilityRole={openingError ? "alert" : undefined}>
            {opening ? "Opening project…" : openingError}
          </Text>
          {openingError && !opening ? (
            <Pressable onPress={() => void useWriterOpeningStore.getState().retry()} accessibilityRole="button">
              <Text style={styles.openingAction}>Retry</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.push("/writer/settings")} accessibilityRole="button">
            <Text style={styles.openingAction}>Connections</Text>
          </Pressable>
        </View>
      ) : null}
      {isCompact ? <MobileLayout screenWidth={screenWidth} topInset={showOpeningStatus ? 0 : insets.top} /> : (
        <View style={styles.splitContainer}>
          <View style={styles.filesPane}><FileTree /></View>
          <View style={styles.editorPane}><ContentPreview /></View>
          <View style={styles.divider} />
          <View style={styles.chatPane}><AgentChatPanel /></View>
        </View>
      )}
    </View>
  );
}

// On narrow screens the panes don't fit side by side, so the document and the
// conversation become two full-width pages in a pager: the header tabs and a
// horizontal swipe move between them, and both stay mounted.
//
// Files and Projects present as native page sheets over the current page, which
// keeps horizontal gestures dedicated to paging. Settings lives in the projects
// sheet footer.
//
// Each page owns its composer: the document keeps the comment dock, the
// conversation keeps its own input.
function MobileLayout({ screenWidth, topInset }: { screenWidth: number; topInset: number }) {
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();
  // The editor publishes its live selection + send handlers here so the dock
  // can render the comment bubble outside the editor and route sends back.
  const commentBridge = useEditorStore((s) => s.commentBridge);
  const activePluginId = useContentStore((state) => state.active.pluginId);

  // Files and Projects both present as native page sheets: the document stays
  // visible, scaled back behind the card, and iOS owns the slide, the rounded
  // corners and the swipe-to-dismiss.
  const [filesOpen, setFilesOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  // Folder currently expanded into the right-hand column of the files sheet.
  const [filesFolder, setFilesFolder] = useState<string | null>(null);
  const filesCwd = useFilesStore((state) => state.cwd);

  // Two full-width pages — document and conversation — live side by side in a
  // pager. The header tabs and a horizontal swipe both slide between them, and
  // both stay mounted so a switch never reloads the document or the transcript.
  const [page, setPage] = useState(0);
  const pageX = useRef(new Animated.Value(0)).current;
  const pageRef = useRef(page);
  pageRef.current = page;

  const openFiles = useCallback(() => {
    Keyboard.dismiss();
    setFilesFolder(null);
    setFilesOpen(true);
  }, []);
  const closeFiles = useCallback(() => setFilesOpen(false), []);
  const openProjects = useCallback(() => {
    Keyboard.dismiss();
    setProjectsOpen(true);
  }, []);
  const closeProjects = useCallback(() => setProjectsOpen(false), []);

  const goToPage = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(1, next));
    setPage(clamped);
    Animated.timing(pageX, {
      toValue: -clamped * screenWidth,
      duration: 240,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [pageX, screenWidth]);

  const openAgent = useCallback(() => {
    Keyboard.dismiss();
    goToPage(1);
  }, [goToPage]);
  const closeAgent = useCallback(() => {
    Keyboard.dismiss();
    goToPage(0);
  }, [goToPage]);
  const showDocument = useCallback(() => {
    Keyboard.dismiss();
    goToPage(0);
  }, [goToPage]);

  const filesOpenRef = useRef(filesOpen);
  filesOpenRef.current = filesOpen;
  const projectsOpenRef = useRef(projectsOpen);
  projectsOpenRef.current = projectsOpen;
  const screenWidthRef = useRef(screenWidth);
  screenWidthRef.current = screenWidth;
  const dragPageStartRef = useRef(0);
  const goToPageRef = useRef(goToPage);
  goToPageRef.current = goToPage;

  const shouldClaimPageSwipe = (_evt: unknown, g: { dx: number; dy: number }) => {
    if (filesOpenRef.current || projectsOpenRef.current) return false;
    return Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
  };

  const pageSwipeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: shouldClaimPageSwipe,
      onMoveShouldSetPanResponderCapture: shouldClaimPageSwipe,
      onPanResponderGrant: () => {
        pageX.stopAnimation();
        dragPageStartRef.current = -pageRef.current * screenWidthRef.current;
      },
      onPanResponderMove: (_evt, g) => {
        const width = screenWidthRef.current;
        pageX.setValue(Math.min(0, Math.max(-width, dragPageStartRef.current + g.dx)));
      },
      onPanResponderRelease: (_evt, g) => {
        const width = screenWidthRef.current;
        const from = pageRef.current;
        let next = from;
        if (g.dx <= -width * 0.22 || g.vx <= -0.45) next = Math.min(1, from + 1);
        else if (g.dx >= width * 0.22 || g.vx >= 0.45) next = Math.max(0, from - 1);
        goToPageRef.current(next);
      },
      onPanResponderTerminate: () => {
        goToPageRef.current(pageRef.current);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ).current;

  // The dock sits flush at the bottom of the screen as a flat bar (WeChat IM
  // style): a tinted surface band with a thin top divider, no outer rounding
  // or shadow. Only the input pill inside is rounded. The band's own padding
  // handles the safe-area bottom + keyboard lift, so the background color
  // extends all the way to the screen edge. When the keyboard is up it already
  // covers the home-indicator area — drop the safe-area bottom then, so there
  // is no empty gap between the input and the keyboard.
  const keyboardOpen = keyboardInset > 0;
  const dockPadBottom = keyboardOpen
    ? keyboardInset + THEME.spacing.xs
    : Math.max(insets.bottom, THEME.spacing.lg) + THEME.spacing.xs;

  // Plugin ids drive the composer selection: a file-scope plugin ("markdown",
  // "lark-working-copy") gets the comment bubble; the web-preview plugin
  // currently reuses the same embedded composer for the comment chat. The
  // generic layer deliberately looks up the active plugin by id rather than
  // keeping a plugin-shaped discriminator here.
  const activePlugin = getPlugin(activePluginId);
  const activeScope = activePlugin?.kind === "preview" ? activePlugin.scope : null;
  const showBubble = activeScope === "file";
  const showPreviewChat = activeScope === "project" || activeScope === "workspace";
  const hasInput = showBubble || showPreviewChat;

  return (
    <View
      style={[
        styles.mobileContainer,
        {
          paddingTop: topInset,
        },
      ]}
      {...pageSwipeResponder.panHandlers}
    >
      <View style={styles.mobileTabBar}>
        <PressableRow
          style={styles.mobileTabAction}
          onPress={openFiles}
          haptic="light"
          accessibilityLabel="Open files"
        >
          <Icon name="folder" size={20} color={THEME.colors.textSecondary} />
        </PressableRow>
        <View style={styles.mobileTabCenter}>
          <View style={styles.mobileTabSegments}>
            <PressableRow
              style={[styles.mobileTab, page === 0 && styles.mobileTabActive]}
              onPress={() => goToPage(0)}
              haptic="light"
              accessibilityLabel="Show document"
            >
              <Text style={[styles.mobileTabLabel, page === 0 && styles.mobileTabLabelActive]}>
                Document
              </Text>
            </PressableRow>
            <PressableRow
              style={[styles.mobileTab, page === 1 && styles.mobileTabActive]}
              onPress={() => goToPage(1)}
              haptic="light"
              accessibilityLabel="Show conversation"
            >
              <Text style={[styles.mobileTabLabel, page === 1 && styles.mobileTabLabelActive]}>
                Chat
              </Text>
            </PressableRow>
          </View>
        </View>
        <PressableRow
          style={styles.mobileTabAction}
          onPress={openProjects}
          haptic="light"
          accessibilityLabel="Open projects"
        >
          <Icon name="grid" size={19} color={THEME.colors.textSecondary} />
        </PressableRow>
      </View>

      <Animated.View
        style={[styles.pager, { width: screenWidth * 2, transform: [{ translateX: pageX }] }]}
      >
        <View style={[styles.page, { width: screenWidth }]}>
          <View style={styles.pageFill}>
            <ContentPreview
              hideHeader
              hideInlineCommentBar
              onRequestFiles={openFiles}
              onRequestAgent={openAgent}
              active
            />
          </View>
          {hasInput ? (
            <View
              nativeID="kel-document-composer"
              style={[
                styles.composerDock,
                { paddingBottom: dockPadBottom, paddingRight: THEME.spacing.xl },
              ]}
            >
              <DocumentCommentBar
                variant="embedded"
                selectionText={commentBridge?.selectionText ?? null}
                imageRef={commentBridge?.imageRef ?? null}
                onSend={commentBridge?.onSend ?? NOOP_COMMENT_SEND}
                onClearSelection={commentBridge?.onClearSelection}
                secondaryAction={commentBridge?.secondaryAction}
              />
            </View>
          ) : null}
        </View>
        <View style={[styles.page, { width: screenWidth }]}>
          <View style={styles.pageFill}>
            <AgentChatPanel
              showInput={false}
              avoidKeyboard={false}
              showHeader={false}
              onRequestClose={closeAgent}
            />
          </View>
          {/* Same dock and same embedded composer as the document page. */}
          <View
            nativeID="kel-agent-composer"
            style={[
              styles.composerDock,
              { paddingBottom: dockPadBottom, paddingRight: THEME.spacing.xl },
            ]}
          >
            <ChatInput variant="embedded" />
          </View>
        </View>
      </Animated.View>

      {/* Files as a native page sheet, matching the projects panel. */}
      <Modal
        visible={filesOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeFiles}
        onDismiss={closeFiles}
      >
        <View style={[styles.pageSheet, { paddingTop: insets.top }]}>
          <View style={styles.pageSheetHeader}>
            <Text style={styles.sheetTitle}>Files</Text>
            <PressableRow
              style={styles.pageSheetClose}
              onPress={closeFiles}
              haptic="light"
              accessibilityLabel="Close files"
            >
              <Icon name="close" size={18} color={THEME.colors.textSecondary} />
            </PressableRow>
          </View>
          <View style={styles.filesBody}>
            <View style={[styles.filesTreeColumn, filesFolder !== null && styles.filesTreeNarrow]}>
              <FileTree
                mode="files"
                showHeader={false}
                bottomInset={insets.bottom}
                onCloseDrawer={closeFiles}
                onSelectFolder={setFilesFolder}
                selectedFolder={filesFolder}
                onFileOpened={() => {
                  closeFiles();
                  showDocument();
                }}
              />
            </View>
            {filesFolder !== null && filesCwd ? (
              <View style={styles.filesFolderColumn}>
                <DirectoryColumn
                  cwd={filesCwd}
                  path={filesFolder}
                  onNavigate={setFilesFolder}
                  onOpenFile={(path) => {
                    void openWorkspaceDocument(filesCwd, path).then(() => {
                      closeFiles();
                      showDocument();
                    });
                  }}
                />
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Projects as a native page sheet: iOS slides it up over the document,
          scales the presenting screen back and owns the swipe-to-dismiss. */}
      <Modal
        visible={projectsOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeProjects}
        onDismiss={closeProjects}
      >
        <View style={[styles.pageSheet, { paddingTop: insets.top }]}>
          <View style={styles.pageSheetHeader}>
            <Text style={styles.sheetTitle}>Projects</Text>
            <PressableRow
              style={styles.pageSheetClose}
              onPress={closeProjects}
              haptic="light"
              accessibilityLabel="Close projects"
            >
              <Icon name="close" size={18} color={THEME.colors.textSecondary} />
            </PressableRow>
          </View>
          <FileTree
            mode="projects"
            showHeader={false}
            showSettingsFooter
            bottomInset={insets.bottom}
            onCloseDrawer={closeProjects}
            onFileOpened={() => {
              closeProjects();
              showDocument();
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  writerContainer: { flex: 1, backgroundColor: THEME.colors.background },
  openingStatus: {
    flexDirection: "row", alignItems: "center", gap: THEME.spacing.md,
    paddingHorizontal: THEME.spacing.lg, paddingVertical: THEME.spacing.sm,
    backgroundColor: THEME.colors.backgroundSecondary,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: THEME.colors.border,
  },
  openingText: { flex: 1, fontSize: 15, color: THEME.colors.textSecondary },
  openingError: { color: THEME.colors.error },
  openingAction: { fontSize: 15, color: THEME.colors.primary },
  splitContainer: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: THEME.colors.background,
    overflow: "hidden",
  },
  filesPane: {
    width: 240,
    borderRightWidth: 1,
    borderRightColor: THEME.colors.border,
  },
  editorPane: {
    flex: 3,
    minWidth: 0,
  },
  divider: {
    width: 1,
    backgroundColor: THEME.colors.border,
  },
  chatPane: {
    flex: 2,
    minWidth: 0,
  },
  mobileContainer: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  mobileTabBar: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    paddingHorizontal: 0,
    backgroundColor: THEME.colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f0f0f2",
    zIndex: 40,
  },
  mobileTabAction: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  mobileTabCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  mobileTabSegments: {
    width: 220,
    flexDirection: "row",
    gap: 2,
    padding: 2,
    borderRadius: 9,
    backgroundColor: THEME.colors.surface,
  },
  mobileTab: {
    flex: 1,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
  },
  mobileTabActive: {
    backgroundColor: THEME.colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
  },
  mobileTabLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: THEME.colors.textSecondary,
  },
  mobileTabLabelActive: {
    color: THEME.colors.text,
  },
  pager: {
    flex: 1,
    flexDirection: "row",
  },
  page: {
    minWidth: 0,
  },
  pageFill: {
    flex: 1,
    minHeight: 0,
  },
  // Flat IM-style composer bar flush with the screen bottom: a tinted surface
  // band with a thin top divider. The input pill inside is the only rounded
  // affordance. Horizontal padding keeps the pill inset from the edges; the
  // band's background extends to the screen edge so there's no "card" gap.
  composerDock: {
    backgroundColor: THEME.colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#f0f0f2",
    paddingHorizontal: THEME.spacing.xl,
    paddingTop: THEME.spacing.sm,
  },
  filesBody: {
    flex: 1,
    flexDirection: "row",
  },
  filesTreeColumn: {
    flex: 1,
    minWidth: 0,
  },
  // With the right column open the tree keeps just enough width for names.
  filesTreeNarrow: {
    flex: 0.9,
  },
  filesFolderColumn: {
    flex: 1.1,
    minWidth: 0,
  },
  pageSheet: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  pageSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: THEME.spacing.lg,
    paddingVertical: THEME.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f0f0f2",
  },
  pageSheetClose: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: THEME.radii.md,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.01,
    color: THEME.colors.text,
  },
});
