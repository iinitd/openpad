import { createPluginContext } from "../../src/content/plugin-context";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  Platform,
  Keyboard,
  PanResponder,
  useWindowDimensions,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { THEME } from "../../src/styles/theme";
import { AgentChatPanel } from "../../src/agent/AgentChatPanel";
import { Icon } from "../../src/components/Icon";
import { PressableRow } from "../../src/components/PressableRow";
import { ContentPreview } from "../../src/content/ContentPreview";
import { DocumentCommentBar } from "../../src/editor/DocumentCommentBar";
import { FileTree, openWorkspaceDocument } from "../../src/editor/FileTree";
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
const MOBILE_DRAWER_SCREEN_RATIO = 0.85;
const MOBILE_DRAWER_MAX_WIDTH = 380;

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

// Left-edge right-swipe opens the Files drawer. On the document tab a drag also
// selects text, so we only claim swipes that begin within this many px of the
// left edge.
const SWIPE_EDGE_ZONE = 32;

// RN Web already maps translateX/opacity to CSS; these hints keep the drawer
// layers promoted so Safari can composite them without repainting the editor.
const WEB_DRAWER_SURFACE_STYLE = Platform.OS === "web"
  ? ({ willChange: "transform", backfaceVisibility: "hidden" } as unknown as ViewStyle)
  : undefined;
const WEB_DRAWER_BACKDROP_STYLE = Platform.OS === "web"
  ? ({ willChange: "opacity" } as unknown as ViewStyle)
  : undefined;
const NOOP_COMMENT_SEND = async () => {};

// Safari reserves inward swipes from the physical screen edges for browser
// history navigation. React's responder is chosen after the gesture starts, so
// reserve an edge gesture synchronously on touchstart, before Safari commits to
// back/forward navigation. The listener only cancels touches inside the narrow
// edge zone; normal scrolling elsewhere stays passive.
function installWebEdgeSwipeGuard(isDrawerMounted: () => boolean): () => void {
  if (
    Platform.OS !== "web" ||
    typeof document === "undefined" ||
    typeof navigator === "undefined" ||
    navigator.maxTouchPoints <= 0
  ) {
    return () => {};
  }

  let edge: "left" | null = null;
  let startX = 0;
  let startY = 0;
  let listeningForMove = false;

  const stopTracking = () => {
    edge = null;
    if (listeningForMove) {
      document.removeEventListener("touchmove", onTouchMove);
      listeningForMove = false;
    }
  };

  const onTouchMove = (event: TouchEvent) => {
    if (!edge || event.touches.length !== 1) {
      stopTracking();
      return;
    }
    const touch = event.touches[0]!;
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > Math.abs(deltaX) * 1.2) {
      // It was a vertical scroll that happened to begin near an edge.
      stopTracking();
      return;
    }
    const inward = deltaX > 0;
    if (
      inward &&
      Math.abs(deltaX) > 6 &&
      Math.abs(deltaX) > Math.abs(deltaY) * 1.2 &&
      event.cancelable
    ) {
      event.preventDefault();
    }
  };

  const onTouchStart = (event: TouchEvent) => {
    stopTracking();
    // Open drawers own edge taps and scrolling. Cancelling touchstart here
    // suppresses the click on disclosure arrows near the left screen edge.
    if (isDrawerMounted()) return;
    if (event.touches.length !== 1) return;
    const touch = event.touches[0]!;
    edge = touch.clientX <= SWIPE_EDGE_ZONE ? "left" : null;
    if (!edge) return;
    // iOS Safari can commit to history navigation before the first touchmove.
    // `touchstart` must therefore be non-passive and cancelled immediately.
    if (event.cancelable) event.preventDefault();
    startX = touch.clientX;
    startY = touch.clientY;
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    listeningForMove = true;
  };

  document.addEventListener("touchstart", onTouchStart, { passive: false });
  document.addEventListener("touchend", stopTracking, { passive: true });
  document.addEventListener("touchcancel", stopTracking, { passive: true });
  return () => {
    stopTracking();
    document.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("touchend", stopTracking);
    document.removeEventListener("touchcancel", stopTracking);
  };
}

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

// On narrow screens the panes don't fit side by side, so the document view
// takes the whole content area. The Agent chat is a middle-pane mode, not a
// right-anchored drawer: the document top bar's agent button swaps the pane in
// place and the same button (or the compact header's close control) swaps it
// back. Files remain a left-anchored drawer. Settings opens as a dedicated
// route, so the writing context is never lost.
//
// One bottom dock is shared by both modes. The document comment bar and the
// agent composer keep their own state; switching panes only changes which one
// is visible, and the dock itself never moves.
function MobileLayout({ screenWidth, topInset }: { screenWidth: number; topInset: number }) {
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();
  // The editor publishes its live selection + send handlers here so the dock
  // can render the comment bubble outside the editor and route sends back.
  const commentBridge = useEditorStore((s) => s.commentBridge);
  const activePluginId = useContentStore((state) => state.active.pluginId);

  // Files drawer slides in from the left. `filesOpen` is the intent; `filesMounted`
  // keeps the overlay rendered through the slide-out so it animates instead of
  // popping away. `slideX` translates the panel (never a fade).
  // We render the drawer as an absolutely-positioned overlay inside the mobile
  // container (not a Modal). On web, Modal remounts a sibling container into
  // the DOM which produces a visible stall at open/close; a plain Animated.View
  // keeps the DOM tree stable so the slide stays smooth.
  const drawerWidth = Math.min(
    screenWidth * MOBILE_DRAWER_SCREEN_RATIO,
    MOBILE_DRAWER_MAX_WIDTH,
  );
  const [filesOpen, setFilesOpen] = useState(false);
  const [filesMounted, setFilesMounted] = useState(false);
  const slideX = useRef(new Animated.Value(-drawerWidth)).current;
  // Two full-width pages — document and conversation — live side by side in a
  // pager. The header tabs and a horizontal swipe both slide between them, and
  // both stay mounted so a switch never reloads the document or the transcript.
  const [page, setPage] = useState(0);
  const pageX = useRef(new Animated.Value(0)).current;
  const pageRef = useRef(page);
  pageRef.current = page;

  const openFiles = useCallback(() => {
    setFilesMounted(true);
    setFilesOpen(true);
  }, []);
  const closeFiles = useCallback(() => {
    setFilesOpen(false);
  }, []);
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
    setFilesOpen(false);
    goToPage(1);
  }, [goToPage]);
  const closeAgent = useCallback(() => {
    Keyboard.dismiss();
    goToPage(0);
  }, [goToPage]);
  const showDocument = useCallback(() => {
    Keyboard.dismiss();
    setFilesOpen(false);
    goToPage(0);
  }, [goToPage]);

  useEffect(() => {
    if (filesOpen) {
      // iOS-style spring: snappy start, soft settle. No overshoot visible but it
      // feels alive rather than mechanical.
      Animated.spring(slideX, {
        toValue: 0,
        useNativeDriver: Platform.OS !== "web",
        stiffness: 260,
        damping: 28,
        mass: 0.9,
      }).start();
    } else if (filesMounted) {
      Animated.timing(slideX, {
        toValue: -drawerWidth,
        duration: 220,
        easing: Easing.bezier(0.32, 0.72, 0, 1),
        useNativeDriver: Platform.OS !== "web",
      }).start(({ finished }) => {
        if (finished) setFilesMounted(false);
      });
    }
  }, [drawerWidth, filesOpen, slideX]);

  // A horizontal drag moves the pager. Starting on the left edge belongs to the
  // files drawer while the document page is showing, so the page swipe leaves
  // that gesture alone.
  const shouldClaimPageSwipe = (_evt: unknown, g: { dx: number; dy: number; moveX: number }) => {
    if (filesMountedRef.current) return false;
    const horizontal = Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
    if (!horizontal) return false;
    const startX = g.moveX - g.dx;
    if (pageRef.current === 0 && g.dx > 0 && startX <= SWIPE_EDGE_ZONE) return false;
    return true;
  };

  // Backdrop dims in step with the slide (0 when off-screen → 1 when open).
  const backdropOpacity = slideX.interpolate({
    inputRange: [-drawerWidth, 0],
    outputRange: [0, 1],
  });

  const filesMountedRef = useRef(filesMounted);
  filesMountedRef.current = filesMounted;
  useEffect(() => installWebEdgeSwipeGuard(() => filesMountedRef.current), []);
  // Edge-swipe drives the slide value directly so the drawer tracks the finger
  // instead of snapping at release — iOS-style. Ref keeps us out of PanResponder
  // closure staleness.
  const drawerWidthRef = useRef(drawerWidth);
  drawerWidthRef.current = drawerWidth;
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragRef = useRef<number | null>(null);

  const flushDragPosition = () => {
    if (dragFrameRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    const pending = pendingDragRef.current;
    pendingDragRef.current = null;
    if (pending !== null) slideX.setValue(pending);
  };

  const setDragPosition = (value: number) => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      slideX.setValue(value);
      return;
    }
    pendingDragRef.current = value;
    if (dragFrameRef.current === null) {
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null;
        const pending = pendingDragRef.current;
        pendingDragRef.current = null;
        if (pending !== null) slideX.setValue(pending);
      });
    }
  };

  useEffect(() => () => {
    if (dragFrameRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(dragFrameRef.current);
    }
  }, []);

  const shouldClaimEdgeSwipe = (_evt: unknown, g: { dx: number; dy: number; moveX: number }) => {
    if (filesMountedRef.current) return false;
    // The left edge is only the drawer edge while the document page is showing;
    // on the chat page it pages back instead.
    if (pageRef.current !== 0) return false;
    const horizontal = Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6;
    if (!horizontal) return false;
    const startX = g.moveX - g.dx;
    return g.dx > 0 && startX <= SWIPE_EDGE_ZONE;
  };

  // One responder owns both edges: a rightward drag from the left edge opens the
  // files drawer, a leftward drag from the right edge opens the conversation.
  // Sharing it avoids a second transparent view stealing taps from the content.
  const activeSwipeRef = useRef<"files" | "page" | null>(null);
  const screenWidthRef = useRef(screenWidth);
  screenWidthRef.current = screenWidth;
  const dragPageStartRef = useRef(0);
  const goToPageRef = useRef(goToPage);
  goToPageRef.current = goToPage;

  const claimSwipe = (evt: unknown, g: { dx: number; dy: number; moveX: number }) => {
    if (shouldClaimEdgeSwipe(evt, g)) {
      activeSwipeRef.current = "files";
      return true;
    }
    if (shouldClaimPageSwipe(evt, g)) {
      activeSwipeRef.current = "page";
      return true;
    }
    return false;
  };

  const swipeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: claimSwipe,
      onMoveShouldSetPanResponderCapture: claimSwipe,
      onPanResponderGrant: () => {
        if (activeSwipeRef.current === "page") {
          dragPageStartRef.current = -pageRef.current * screenWidthRef.current;
          return;
        }
        setFilesMounted(true);
        slideX.setValue(-drawerWidthRef.current);
      },
      onPanResponderMove: (_evt, g) => {
        if (activeSwipeRef.current === "page") {
          const width = screenWidthRef.current;
          const next = Math.min(0, Math.max(-width, dragPageStartRef.current + g.dx));
          pageX.setValue(next);
          return;
        }
        const dw = drawerWidthRef.current;
        setDragPosition(Math.min(0, -dw + Math.max(0, g.dx)));
      },
      onPanResponderRelease: (_evt, g) => {
        if (activeSwipeRef.current === "page") {
          activeSwipeRef.current = null;
          const width = screenWidthRef.current;
          const from = pageRef.current;
          let next = from;
          if (g.dx <= -width * 0.22 || g.vx <= -0.45) next = Math.min(1, from + 1);
          else if (g.dx >= width * 0.22 || g.vx >= 0.45) next = Math.max(0, from - 1);
          goToPageRef.current(next);
          return;
        }
        activeSwipeRef.current = null;
        flushDragPosition();
        const dw = drawerWidthRef.current;
        const shouldOpen = g.dx >= dw * 0.3 || g.vx > 0.4;
        if (shouldOpen) {
          // Flip the intent; the open effect owns the single settle animation.
          setFilesOpen(true);
        } else {
          // Animate back closed from wherever we left off — can't rely on the
          // open-effect since filesOpen was never flipped to true.
          Animated.timing(slideX, {
            toValue: -dw,
            duration: 180,
            easing: Easing.bezier(0.32, 0.72, 0, 1),
            useNativeDriver: Platform.OS !== "web",
          }).start(({ finished }) => {
            if (finished) setFilesMounted(false);
          });
        }
      },
      onPanResponderTerminate: () => {
        if (activeSwipeRef.current === "page") {
          activeSwipeRef.current = null;
          goToPageRef.current(pageRef.current);
          return;
        }
        activeSwipeRef.current = null;
        flushDragPosition();
        Animated.timing(slideX, {
          toValue: -drawerWidthRef.current,
          duration: 160,
          useNativeDriver: Platform.OS !== "web",
        }).start(({ finished }) => {
          if (finished) setFilesMounted(false);
        });
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
      {...swipeResponder.panHandlers}
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
        <View style={styles.mobileTabAction} />
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
        <View
          style={[
            styles.page,
            { width: screenWidth, paddingBottom: keyboardOpen ? 0 : insets.bottom },
          ]}
        >
          <AgentChatPanel
            showInput
            avoidKeyboard
            showHeader={false}
            onRequestClose={closeAgent}
          />
        </View>
      </Animated.View>

      {/* Left-anchored Files drawer. Sits above the document header, which
          carries zIndex 30 of its own, so the drawer layer needs a higher one. */}
      {filesMounted ? (
        <View style={[StyleSheet.absoluteFill, styles.drawerLayer]} pointerEvents="box-none">
          <Animated.View
            style={[styles.drawerBackdrop, WEB_DRAWER_BACKDROP_STYLE, { opacity: backdropOpacity }]}
            pointerEvents={filesOpen ? "auto" : "none"}
          >
            <Pressable
              style={styles.drawerBackdropTouch}
              accessibilityRole="button"
              accessibilityLabel="Close files"
              onPressIn={closeFiles}
            />
          </Animated.View>
          <Animated.View
            style={[
              styles.drawer,
              WEB_DRAWER_SURFACE_STYLE,
              { width: drawerWidth, paddingTop: insets.top, transform: [{ translateX: slideX }] },
            ]}
          >
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Files</Text>
            </View>
            <FileTree
              showHeader={false}
              showSettingsFooter
              bottomInset={insets.bottom}
              onCloseDrawer={closeFiles}
              onFileOpened={showDocument}
            />
          </Animated.View>
        </View>
      ) : null}
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
    paddingHorizontal: THEME.spacing.xs,
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
  mobileTabSegments: {
    flex: 1,
    maxWidth: 240,
    alignSelf: "center",
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
  // Left-anchored file drawer. A full-screen dimmed backdrop sits underneath,
  // so the whole screen stays dimmed even while the panel slides in/out.
  drawerLayer: {
    zIndex: 100,
  },
  drawer: {
    maxWidth: MOBILE_DRAWER_MAX_WIDTH,
    height: "100%",
    backgroundColor: THEME.colors.background,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "#f0f0f2",
    shadowColor: "#18181b",
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 6,
  },
  drawerBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15,23,42,0.28)",
  },
  drawerBackdropTouch: {
    flex: 1,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingHorizontal: THEME.spacing.lg,
    paddingVertical: THEME.spacing.xs + 2,
    backgroundColor: THEME.colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.colors.border,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.01,
    color: THEME.colors.text,
  },
});
