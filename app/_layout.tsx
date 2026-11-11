import { useEffect } from "react";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StyleSheet, Platform } from "react-native";
import { THEME } from "../src/styles/theme";

/**
 * Inject page-level CSS (web only) that pins the document to the viewport width
 * so nothing can produce a horizontal scrollbar on the page itself. Individual
 * scroll regions (the editor, chat list) opt back into their own vertical
 * scrolling; horizontal overflow is clipped everywhere at the root.
 */
function injectGlobalStyles() {
  if (Platform.OS !== "web") return;
  if (typeof document === "undefined") return;

  const id = "puff-global-styles";
  if (document.getElementById(id)) return;

  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    html, body, #root {
      margin: 0;
      width: 100%;
      height: 100%;
      max-width: 100%;
      overflow-x: hidden;
      overflow-y: hidden;
      overscroll-behavior: none;
      /* Match the app's main background so the safe-area / overscroll regions
         don't flash a different (default) colour than the content. */
      background-color: ${THEME.colors.background};
    }
    /* Keep every app-owned scroll region scrollable, but stop it from handing
       boundary motion to Safari's viewport (rubber-band / pull-to-refresh). */
    #root * {
      overscroll-behavior: none;
    }
    /* Expo/React-Native-Web mounts the app into a full-height flex root. */
    #root {
      width: 100%;
    }
    /* React-Native-Web <View>s default to flex-shrink:0, so a wide child can
       push the app container past the viewport and produce a page-level
       horizontal scrollbar. Clamp the two wrapper divs RNW/Expo Router mount
       directly under #root so nothing can scroll the page sideways. */
    #root > div {
      max-width: 100%;
      overflow-x: hidden;
    }
    /* iOS Safari auto-zooms the viewport when a focused text field has a
       font-size below 16px, which then makes the page wider than the screen
       and forces the user to pinch back to 100%. Forcing >=16px on focusable
       fields at mobile widths prevents the zoom entirely. (iOS ignores
       maximum-scale / user-scalable, so this is the only robust fix.) Desktop
       keeps its smaller, denser type. */
    @media screen and (max-width: 576px) {
      /* Keep iOS Safari from resolving focused inputs with a keyboard-open page pan.
         The visual viewport may shrink, but the app shell and header stay pinned to
         the layout viewport; the composer handles the keyboard inset itself. */
      html, body {
        position: fixed;
        inset: 0;
      }
      #root {
        position: absolute;
        inset: 0;
      }
      #kel-document-composer, #kel-agent-composer {
        transition: padding-bottom 260ms cubic-bezier(0.32, 0.72, 0, 1);
      }
      input, textarea, select, [contenteditable="true"], .tiptap, .ProseMirror {
        font-size: 16px !important;
      }
    }
    @media screen and (max-width: 576px) and (prefers-reduced-motion: reduce) {
      #kel-document-composer, #kel-agent-composer {
        transition-duration: 0.01ms;
      }
    }
  `;
  document.head.appendChild(style);
}

/**
 * iOS only gained reliable `overscroll-behavior` support relatively recently.
 * On older mobile Safari versions, cancel a vertical drag only when no nested
 * app scroll container can consume it. This preserves editor/file/chat
 * scrolling while preventing the document viewport from bouncing or refreshing.
 */
function installMobileOverscrollGuard(): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => {};
  if (typeof navigator === "undefined" || navigator.maxTouchPoints <= 0) return () => {};
  if (
    typeof CSS !== "undefined" &&
    CSS.supports("overscroll-behavior-y", "none")
  ) {
    // Modern Safari/Chrome can keep this path entirely off the main thread.
    // The non-passive JS fallback below is only for older touch browsers.
    return () => {};
  }

  let previousX = 0;
  let previousY = 0;
  let scrollAncestors: Array<{ element: HTMLElement; inverted: boolean }> = [];

  const isVerticallyInverted = (transform: string) => {
    if (transform.includes("scaleY(-1)")) return true;
    const matrix = transform.match(/^matrix\(([^)]+)\)$/);
    if (matrix) return Number(matrix[1]!.split(",")[3]) < 0;
    const matrix3d = transform.match(/^matrix3d\(([^)]+)\)$/);
    if (matrix3d) return Number(matrix3d[1]!.split(",")[5]) < 0;
    return false;
  };

  const findScrollAncestors = (target: EventTarget | null) => {
    const matches: Array<{ element: HTMLElement; inverted: boolean }> = [];
    let element = target instanceof Element ? target : null;
    while (element && element !== document.documentElement) {
      if (element instanceof HTMLElement) {
        const { overflowY, transform } = window.getComputedStyle(element);
        const scrollable =
          /^(auto|scroll|overlay)$/.test(overflowY) &&
          element.scrollHeight > element.clientHeight + 1;
        if (scrollable) {
          matches.push({ element, inverted: isVerticallyInverted(transform) });
        }
      }
      element = element.parentElement;
    }
    return matches;
  };

  const canScrollVertically = (fingerDeltaY: number) => {
    for (const { element, inverted } of scrollAncestors) {
      // React Native Web implements `FlatList inverted` (used by Agent Chat)
      // with scaleY(-1). Keep allowing that list to consume its gesture; CSS
      // overscroll containment prevents it chaining into Safari's viewport.
      if (inverted) {
        const maxScrollTop = element.scrollHeight - element.clientHeight;
        if (fingerDeltaY > 0 && element.scrollTop < maxScrollTop - 1) return true;
        if (fingerDeltaY < 0 && element.scrollTop > 1) return true;
        continue;
      }
      // Finger down reveals content above; finger up reveals content below.
      if (fingerDeltaY > 0 && element.scrollTop > 0) return true;
      if (
        fingerDeltaY < 0 &&
        element.scrollTop + element.clientHeight < element.scrollHeight - 1
      ) {
        return true;
      }
    }
    return false;
  };

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) return;
    previousX = event.touches[0]!.clientX;
    previousY = event.touches[0]!.clientY;
    // Computed-style reads are expensive on iOS. Resolve the scroll chain once
    // per gesture instead of walking and measuring the DOM on every move frame.
    scrollAncestors = findScrollAncestors(event.target);
  };

  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0]!;
    const deltaX = touch.clientX - previousX;
    const deltaY = touch.clientY - previousY;
    previousX = touch.clientX;
    previousY = touch.clientY;

    // Preserve horizontal gestures such as opening the files drawer.
    if (Math.abs(deltaX) > Math.abs(deltaY)) return;
    if (!canScrollVertically(deltaY) && event.cancelable) event.preventDefault();
  };

  const onTouchEnd = () => {
    scrollAncestors = [];
  };

  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onTouchEnd, { passive: true });
  document.addEventListener("touchcancel", onTouchEnd, { passive: true });
  return () => {
    document.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend", onTouchEnd);
    document.removeEventListener("touchcancel", onTouchEnd);
  };
}

export default function RootLayout() {
  useEffect(() => {
    injectGlobalStyles();
    return installMobileOverscrollGuard();
  }, []);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.container}>
        <StatusBar style="auto" />
        <Slot />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    maxWidth: "100%",
    overflow: "hidden",
  },
});
