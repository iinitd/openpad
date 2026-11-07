import type { BackendAttachment } from "../backend";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { DocumentCommentBar } from "./DocumentCommentBar";
import { DocumentToc } from "./DocumentToc";
import { ReviseBanner } from "./ReviseBanner";
import { extractHeadings, type DocumentHeading } from "./file-content";
import { Icon } from "../components/Icon";
import { EDITOR_DOC_CSS } from "./editor-doc-css";
import { useWatchOpenFile } from "./use-watch-open-file";
import { useEditorStore } from "../stores/editor-store";
import { useAnnotationStore } from "../stores/annotation-store";
import { useSessionStore } from "../stores/session-store";
import { useFilesStore } from "../stores/files-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { THEME } from "../styles/theme";
import { openWorkspaceDocument } from "./open-document";
import type { DocumentAssetPatch } from "./resolve-doc-images";

// The bridge script that runs *inside* the WebView document. It reports text
// selections and (in edit mode) content changes back to React Native, and
// exposes a couple of helpers RN calls via injectJavaScript:
//   __kelSetEditable(bool)   toggle contentEditable (preview vs edit)
//   __kelFlash()             play the "just edited on disk" highlight
//   __kelRestoreScroll(px)   restore a saved scroll offset
// Messages posted to RN are JSON: {type:'selection'|'content'|'scroll'|'ready'}.
const BRIDGE_SCRIPT = `
(function () {
  var post = function (msg) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  };
  var root = document.getElementById('kel-root');
  var flashWrap = document.getElementById('kel-flash');
  var lastRange = null;

  // Report selection changes (debounced to the settle of a drag).
  var selTimer = null;
  document.addEventListener('selectionchange', function () {
    if (selTimer) clearTimeout(selTimer);
    selTimer = setTimeout(function () {
      var sel = window.getSelection();
      var text = sel ? String(sel.toString()) : '';
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        lastRange = sel.getRangeAt(0).cloneRange();
      }
      var blockIds = [];
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        var range = sel.getRangeAt(0);
        var blocks = document.querySelectorAll('p[data-lark-block-id],h1[data-lark-block-id],h2[data-lark-block-id],h3[data-lark-block-id],h4[data-lark-block-id],h5[data-lark-block-id],h6[data-lark-block-id],li[data-lark-block-id],pre[data-lark-block-id]');
        for (var i = 0; i < blocks.length; i++) {
          try {
            if (range.intersectsNode(blocks[i])) {
              var id = blocks[i].getAttribute('data-lark-block-id');
              if (id && blockIds.indexOf(id) < 0) blockIds.push(id);
            }
          } catch (e) {}
        }
      }
      post({ type: 'selection', text: text, blockIds: blockIds });
    }, 150);
  });

  // In edit mode, stream content changes back so the store stays in sync.
  var contentTimer = null;
  if (root) {
    root.addEventListener('input', function () {
      if (contentTimer) clearTimeout(contentTimer);
      contentTimer = setTimeout(function () {
        post({ type: 'content', html: root.innerHTML });
      }, 250);
    });
  }

  // Persist scroll position (throttled).
  var scrollTimer = null;
  window.addEventListener('scroll', function () {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
      post({ type: 'scroll', offset: window.scrollY || window.pageYOffset || 0 });
    }, 150);
  }, { passive: true });

  // Tapping a resolved image / whiteboard (in preview mode) selects it as the
  // AI-comment reference. The rendered media carries data-kel-src (the
  // document-declared workspace path) and data-kind; report both to RN. In edit
  // mode a tap edits the node, so we skip.
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute('data-kel-src')) break;
      el = el.parentNode;
    }
    if (!el || !el.getAttribute || !el.getAttribute('data-kel-src')) return;
    if (root && root.getAttribute('contenteditable') === 'true') return;
    e.preventDefault();
    var path = el.getAttribute('data-kel-src');
    var kind = el.getAttribute('data-kind') === 'whiteboard' ? 'whiteboard' : 'image';
    var sel = window.getSelection && window.getSelection();
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
    post({ type: 'imageRef', path: path, kind: kind });
  });

  // Toggle the selection ring on the referenced asset (matched by data-kel-src),
  // or clear it when RN passes an empty path.
  window.__kelSetImageRef = function (path) {
    var all = document.querySelectorAll('.kel-media[data-kel-src]');
    all.forEach(function (el) {
      if (path && el.getAttribute('data-kel-src') === path) {
        el.classList.add('kel-ref-selected');
      } else {
        el.classList.remove('kel-ref-selected');
      }
    });
  };

  window.__kelSetEditable = function (on) {
    if (root) root.setAttribute('contenteditable', on ? 'true' : 'false');
  };
  window.__kelFlash = function () {
    if (!flashWrap) return;
    flashWrap.classList.remove('kel-doc-flash');
    // force reflow so re-adding the class restarts the animation
    void flashWrap.offsetWidth;
    flashWrap.classList.add('kel-doc-flash');
    setTimeout(function () { flashWrap.classList.remove('kel-doc-flash'); }, 1300);
  };
  window.__kelRestoreScroll = function (px) {
    window.scrollTo(0, px || 0);
  };
  // Smooth-scroll to the Nth heading element (document order), for the TOC.
  window.__kelScrollToHeading = function (index) {
    var hs = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    var target = hs[index];
    if (target && target.scrollIntoView) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  window.__kelReplaceAsset = function (path, html) {
    if (!path) return false;
    var targets = document.querySelectorAll('.kel-media-loading[data-kel-src], img[src^="kel-file:"]');
    var replaced = false;
    targets.forEach(function (target) {
      var elPath = target.getAttribute('data-kel-src');
      if (!elPath && target.tagName === 'IMG') {
        var src = target.getAttribute('src') || '';
        if (src.indexOf('kel-file:') === 0) elPath = src.slice('kel-file:'.length);
      }
      if (elPath !== path) return;
      if (target.tagName === 'IMG') {
        target.outerHTML = html;
        replaced = true;
        return;
      }
      var parser = document.createElement('template');
      parser.innerHTML = html || '';
      var replacement = parser.content.firstElementChild;
      if (!replacement) return;
      target.replaceWith(replacement);
      replaced = true;
    });
    return replaced;
  };
  // Wrap the current selection in a pulsing "revising" mark, matching web.
  window.__kelMarkWorking = function () {
    var sel = window.getSelection();
    if (!sel) return;
    try {
      var range = (!sel.isCollapsed && sel.rangeCount > 0)
        ? sel.getRangeAt(0)
        : lastRange;
      if (!range || range.collapsed) return;
      var mark = document.createElement('mark');
      mark.className = 'kel-ai-working';
      range.surroundContents(mark);
      lastRange = null;
      sel.removeAllRanges();
    } catch (e) { /* selection spanned multiple blocks; skip the visual */ }
  };
  window.__kelClearWorking = function () {
    var marks = document.querySelectorAll('mark.kel-ai-working');
    marks.forEach(function (m) {
      var parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    });
    lastRange = null;
  };
  // EXPERIMENTAL — paragraph-level "what did the AI change" tint. RN passes the
  // signatures (tag + stripped text) of the new/modified top-level blocks (see
  // block-diff.ts); we tag the #kel-root children whose own signature matches.
  // Signature matching (not index) is used because the rendered DOM doesn't line
  // up 1:1 with the raw diff HTML. Called after a revision reloads the document.
  window.__kelMarkChangedBlocks = function (sigs) {
    if (!root) return;
    var want = {};
    (sigs || []).forEach(function (s) { want[s] = true; });
    var sigOf = function (el) {
      var tag = (el.tagName || 'text').toLowerCase();
      var text = (el.textContent || '')
        .replace(/\\u00a0/g, ' ')
        .replace(/\\s+/g, '')
        .toLowerCase();
      return tag + '\\u0000' + text;
    };
    var kids = root.children;
    for (var i = 0; i < kids.length; i++) {
      if (want[sigOf(kids[i])]) kids[i].classList.add('kel-changed');
      else kids[i].classList.remove('kel-changed');
    }
  };

  post({ type: 'ready' });
  true;
})();
`;

// Build the full HTML document served to the WebView. `contentHtml` is the same
// HTML the web editor renders; wrapping it in `.tiptap` makes the shared
// EDITOR_DOC_CSS apply identically on both platforms.
function buildDocumentHtml(contentHtml: string, editable: boolean): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    html, body { margin: 0; padding: 0; background: #ffffff; -webkit-text-size-adjust: 100%; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      color: #0f172a;
      overflow-x: hidden;
      word-wrap: break-word;
    }
    #kel-root {
      padding: 16px;
      min-height: 100vh;
      outline: none;
    }
    ${EDITOR_DOC_CSS}
  </style>
</head>
<body>
  <div id="kel-flash">
    <div id="kel-root" class="tiptap" contenteditable="${editable ? "true" : "false"}">${contentHtml}</div>
  </div>
</body>
</html>`;
}

export function EditorNative({
  hideInlineCommentBar,
  onRequestFiles,
  active = true,
}: {
  hideInlineCommentBar?: boolean;
  onRequestFiles?: () => void;
  active?: boolean;
}) {
  const webviewRef = useRef<WebView>(null);
  const polishAnnotation = useAnnotationStore((s) => s.polishAnnotation);
  const sendComment = useAnnotationStore((s) => s.sendComment);
  const sendImageComment = useAnnotationStore((s) => s.sendImageComment);

  const externalContentVersion = useEditorStore((s) => s.externalContentVersion);
  const documentTitle = useEditorStore((s) => s.documentTitle);
  const documentPath = useEditorStore((s) => s.documentPath);
  const mode = useEditorStore((s) => s.mode);
  const editable = useEditorStore((s) => s.editable);
  const setMode = useEditorStore((s) => s.setMode);
  const setContent = useEditorStore((s) => s.setContent);
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    const cwd = useFilesStore.getState().cwd;
    if (!cwd || !documentPath || refreshing) return;
    setRefreshing(true);
    try { await openWorkspaceDocument(cwd, documentPath); } finally { setRefreshing(false); }
  }, [documentPath, refreshing]);

  // Table-of-contents drawer under the title. Re-derived when the document is
  // opened/reloaded; collapsed on every swap so it never lingers across files.
  const [tocOpen, setTocOpen] = useState(false);
  const [headings, setHeadings] = useState<DocumentHeading[]>([]);
  useEffect(() => {
    setHeadings(extractHeadings(useEditorStore.getState().content));
    setTocOpen(false);
  }, [externalContentVersion]);

  const isStreaming = useSessionStore((s) => s.isStreaming);
  const [revising, setRevising] = useState(false);

  const [selectionText, setSelectionText] = useState<string | null>(null);
  const [selectionBlockIds, setSelectionBlockIds] = useState<string[]>([]);
  // A tapped image / whiteboard selected as the comment reference (mutually
  // exclusive with a text selection).
  const [imageRef, setImageRef] = useState<{
    path: string;
    kind: "image" | "whiteboard";
    label: string;
  } | null>(null);
  const readyRef = useRef(false);
  // On mobile all panes stay mounted (display toggled). Hiding the WebView can
  // collapse its DOM selection and post an empty "selection" message; we must
  // not treat that as the user deselecting, or the highlighted-passage
  // reference (and revise context) would vanish on a tab switch. Read the live
  // flag through a ref from the message callback.
  const activeRef = useRef(active);
  activeRef.current = active;

  // The WebView reloads whenever the source HTML string changes. We key the
  // document off externalContentVersion so opening/reloading a file rebuilds it,
  // but *edits typed inside the WebView* (which only update content via the
  // bridge, without bumping the version) don't trigger a reload that would blow
  // away the cursor. `mode` is intentionally NOT in the source — flipping
  // edit/preview is done via injectJavaScript so it doesn't reload.
  const initialEditable = useEditorStore.getState().mode === "edit";
  const html = useMemo(
    () => buildDocumentHtml(useEditorStore.getState().content, initialEditable),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [externalContentVersion],
  );

  const flashKey = useWatchOpenFile();
  const pendingNativePatchesRef = useRef<DocumentAssetPatch[]>([]);

  // Play the flash animation when the file changed on disk.
  useEffect(() => {
    if (flashKey === 0 || !readyRef.current) return;
    webviewRef.current?.injectJavaScript("window.__kelFlash && window.__kelFlash(); true;");
  }, [flashKey]);

  // Toggle contentEditable without reloading when the user flips preview/edit.
  useEffect(() => {
    if (!readyRef.current) return;
    webviewRef.current?.injectJavaScript(
      `window.__kelSetEditable && window.__kelSetEditable(${mode === "edit" && editable}); true;`,
    );
  }, [mode, editable]);

  // Clear the "revising" pulse once the turn ends.
  useEffect(() => {
    if (!isStreaming && revising) {
      setRevising(false);
      webviewRef.current?.injectJavaScript(
        "window.__kelClearWorking && window.__kelClearWorking(); true;",
      );
    }
  }, [isStreaming, revising]);

  const restoreScroll = useCallback(() => {
    const cwd = useFilesStore.getState().cwd;
    if (!cwd || !documentPath) return;
    const saved = usePreferencesStore.getState().getDocumentScroll(cwd, documentPath);
    if (saved > 0) {
      webviewRef.current?.injectJavaScript(
        `window.__kelRestoreScroll && window.__kelRestoreScroll(${saved}); true;`,
      );
    }
  }, [documentPath]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: {
        type?: string;
        text?: string;
        html?: string;
        offset?: number;
        path?: string;
        kind?: string;
        blockIds?: string[];
      };
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case "ready": {
          readyRef.current = true;
          // Sync editable flag + scroll on (re)load.
          webviewRef.current?.injectJavaScript(
            `window.__kelSetEditable && window.__kelSetEditable(${
              useEditorStore.getState().mode === "edit" && useEditorStore.getState().editable
            }); true;`,
          );
          // EXPERIMENTAL — re-apply the "what did the AI change" tint after a
          // revision reload rebuilds the WebView document.
          const changed = useEditorStore.getState().changedBlockSigs;
          if (changed.length > 0) {
            webviewRef.current?.injectJavaScript(
              `window.__kelMarkChangedBlocks && window.__kelMarkChangedBlocks(${JSON.stringify(
                changed,
              )}); true;`,
            );
          }
          if (pendingNativePatchesRef.current.length > 0) {
            const pending = pendingNativePatchesRef.current;
            pendingNativePatchesRef.current = [];
            for (const patch of pending) {
              webviewRef.current?.injectJavaScript(
                `window.__kelReplaceAsset && window.__kelReplaceAsset(${JSON.stringify(
                  patch.path,
                )}, ${JSON.stringify(patch.html)}); true;`,
              );
            }
          }
          restoreScroll();
          break;
        }
        case "selection": {
          const text = (msg.text ?? "").trim();
          // Ignore an empty selection reported while this pane is hidden — the
          // browser drops the selection when the WebView is display:none, and
          // we don't want a tab switch to clear the active highlight/comment.
          if (text.length === 0 && !activeRef.current) break;
          // A blank tap collapses the DOM selection, but the product behavior is
          // to keep the last explicit highlight until the user reselects text
          // or dismisses it with the chip's clear affordance.
          if (text.length === 0) break;
          // A real text selection supersedes any image reference.
          setImageRef(null);
          setSelectionText(text);
          setSelectionBlockIds(Array.isArray(msg.blockIds) ? msg.blockIds.filter((id): id is string => typeof id === "string") : []);
          break;
        }
        case "imageRef": {
          const path = (msg.path ?? "").trim();
          if (!path) break;
          const kind = msg.kind === "whiteboard" ? "whiteboard" : "image";
          const label = path.split("/").pop() || kind;
          // Choosing an asset supersedes any text selection.
          setSelectionText(null);
          setImageRef({ path, kind, label });
          break;
        }
        case "content": {
          if (typeof msg.html === "string") setContent(msg.html);
          break;
        }
        case "scroll": {
          const cwd = useFilesStore.getState().cwd;
          if (cwd && documentPath && typeof msg.offset === "number") {
            usePreferencesStore.getState().setDocumentScroll(cwd, documentPath, msg.offset);
          }
          break;
        }
      }
    },
    [documentPath, restoreScroll, setContent],
  );

  // Send from the persistent comment bar. With a live selection we pulse it and
  // route through polishAnnotation (so the passage + comment reach the agent);
  // with no selection it's a document-scoped comment. On native we don't track
  // ProseMirror offsets, so the annotation carries only the highlighted text.
  const handleBarSend = useCallback(
    async (barComment: string, attachments?: BackendAttachment[]) => {
      // An image / whiteboard reference takes priority: route it as an asset
      // comment (the document records the path; the agent opens the file).
      if (imageRef) {
        const ref = imageRef;
        setImageRef(null);
        setRevising(true);
        await sendImageComment({ path: ref.path, kind: ref.kind }, barComment.trim(), attachments);
        return;
      }
      const sel = selectionText;
      if (sel && sel.trim().length > 0) {
        // Pulse the selected span so the wait is legible in the document.
        webviewRef.current?.injectJavaScript(
          "window.__kelMarkWorking && window.__kelMarkWorking(); true;",
        );
        setRevising(true);
        setSelectionText(null);
        setSelectionBlockIds([]);
        await polishAnnotation({
          id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          from: 0,
          to: 0,
          highlightedText: sel,
          blockIds: selectionBlockIds,
          comment: barComment.trim(),
          status: "pending",
        }, attachments);
        return;
      }
      await sendComment(barComment.trim(), null, attachments);
    },
    [imageRef, selectionText, selectionBlockIds, polishAnnotation, sendComment, sendImageComment],
  );

  const handleClearSelection = useCallback(() => {
    setSelectionText(null);
    setSelectionBlockIds([]);
    setImageRef(null);
    webviewRef.current?.injectJavaScript(
      "var s=window.getSelection&&window.getSelection(); s&&s.removeAllRanges&&s.removeAllRanges(); window.__kelSetImageRef&&window.__kelSetImageRef(''); true;",
    );
  }, []);

  // Scroll the WebView to the Nth heading and collapse the TOC.
  const handleTocSelect = useCallback((index: number) => {
    setTocOpen(false);
    webviewRef.current?.injectJavaScript(
      `window.__kelScrollToHeading && window.__kelScrollToHeading(${index}); true;`,
    );
  }, []);

  // Reflect the referenced asset's selection ring inside the WebView.
  useEffect(() => {
    if (!readyRef.current) return;
    webviewRef.current?.injectJavaScript(
      `window.__kelSetImageRef && window.__kelSetImageRef(${JSON.stringify(
        imageRef?.path ?? "",
      )}); true;`,
    );
  }, [imageRef]);

  const changedBlockSigs = useEditorStore((s) => s.changedBlockSigs);
  useEffect(() => {
    if (!readyRef.current) return;
    webviewRef.current?.injectJavaScript(
      `window.__kelMarkChangedBlocks && window.__kelMarkChangedBlocks(${JSON.stringify(
        changedBlockSigs,
      )}); true;`,
    );
  }, [changedBlockSigs]);

  // When the inline bar is suppressed (narrow layout), publish the selection +
  // handlers to the store so the shared floating dock renders the bubble and
  // routes sends back here.
  const setCommentBridge = useEditorStore((s) => s.setCommentBridge);
  const setApplyNativeAssetPatch = useEditorStore((s) => s.setApplyNativeAssetPatch);
  const applyNativeAssetPatch = useCallback((patch: DocumentAssetPatch) => {
    if (!readyRef.current) {
      pendingNativePatchesRef.current.push(patch);
      return;
    }
    webviewRef.current?.injectJavaScript(
      `window.__kelReplaceAsset && window.__kelReplaceAsset(${JSON.stringify(
        patch.path,
      )}, ${JSON.stringify(patch.html)}); true;`,
    );
  }, []);
  useEffect(() => {
    if (!hideInlineCommentBar) return;
    setCommentBridge({
      selectionText,
      imageRef: imageRef
        ? { path: imageRef.path, kind: imageRef.kind, label: imageRef.label }
        : null,
      onSend: handleBarSend,
      onClearSelection: selectionText || imageRef ? handleClearSelection : undefined,
    });
  }, [
    hideInlineCommentBar,
    selectionText,
    imageRef,
    handleBarSend,
    handleClearSelection,
    setCommentBridge,
  ]);
  useEffect(() => {
    setApplyNativeAssetPatch(applyNativeAssetPatch);
    return () => setApplyNativeAssetPatch(null);
  }, [applyNativeAssetPatch, setApplyNativeAssetPatch]);
  useEffect(() => {
    return () => {
      if (hideInlineCommentBar) setCommentBridge(null);
    };
  }, [hideInlineCommentBar, setCommentBridge]);

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        {onRequestFiles ? (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={onRequestFiles}
            accessibilityLabel="Open files"
          >
            <Icon name="folder" size={20} color={THEME.colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
        <View style={styles.topBarSpacer} />
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => void handleRefresh()}
          disabled={refreshing}
          accessibilityLabel="Refresh document preview"
        >
          <Icon name="refresh" size={19} color={refreshing ? THEME.colors.textMuted : THEME.colors.textSecondary} />
        </TouchableOpacity>
        {editable ? <TouchableOpacity
          style={[styles.iconButton, mode === "edit" && styles.iconButtonActive]}
          onPress={() => setMode(mode === "edit" ? "preview" : "edit")}
          accessibilityLabel={mode === "edit" ? "Stop editing" : "Edit document"}
        >
          <Icon
            name={mode === "edit" ? "check" : "edit"}
            size={20}
            color={mode === "edit" ? THEME.colors.primary : THEME.colors.textSecondary}
          />
        </TouchableOpacity> : null}
      </View>

      {documentTitle ? (
        <DocumentToc
          title={documentTitle}
          headings={headings}
          open={tocOpen}
          onToggle={() => setTocOpen((o) => !o)}
          onSelect={handleTocSelect}
        />
      ) : null}

      {/* Persistent, tappable "AI is revising…" banner for both a highlighted
          passage and a whole-document revise; lets the user jump back to the
          file under revision if they've opened a different one. */}
      <ReviseBanner />

      <WebView
        ref={webviewRef}
        style={styles.webview}
        originWhitelist={["*"]}
        source={{ html }}
        injectedJavaScript={BRIDGE_SCRIPT}
        onMessage={handleMessage}
        // Injected content is trusted (built locally); keep JS on for the bridge.
        javaScriptEnabled
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction
      />

      {hideInlineCommentBar ? null : (
        <DocumentCommentBar
          selectionText={selectionText}
          imageRef={imageRef ? { label: imageRef.label, kind: imageRef.kind } : null}
          onSend={handleBarSend}
          onClearSelection={selectionText || imageRef ? handleClearSelection : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  webview: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
    backgroundColor: THEME.colors.background,
  },
  topBarSpacer: {
    flex: 1,
  },
  // Icon-only affordances, matching the web editor's larger tappable glyphs.
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: THEME.spacing.xs,
    borderRadius: THEME.radii.md,
  },
  iconButtonActive: {
    backgroundColor: THEME.colors.surface,
  },
});
