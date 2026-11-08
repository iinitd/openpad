import { EDITOR_DOC_CSS } from "./editor-doc-css";

// A shared HTML shell for read-only document preview. Both web (iframe) and
// native (WebView) render the exact same document, then talk to the React host
// over a tiny bridge for selection, scroll, TOC jumps, revision highlights and
// live asset replacement.
const BRIDGE_SCRIPT = `
(function () {
  var root = document.getElementById('kel-root');
  var flashWrap = document.getElementById('kel-flash');
  var lastRange = null;
  var marks = [];

  function post(message) {
    var payload = JSON.stringify(message);
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(payload);
    }
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, '*');
    }
  }

  // The document lives in an iframe on Web, so its touch events never reach
  // the React parent responder. Reserve inward swipes from the iframe edges for
  // the app drawers and cancel Safari's history-navigation default.
  (function installEdgeSwipeBridge() {
    if (window.ReactNativeWebView || !('ontouchstart' in window)) return;
    var edgeSize = 32;
    var side = null;
    var startX = 0;
    var startY = 0;
    var sent = false;
    var listening = false;
    function stop() {
      side = null;
      sent = false;
      if (listening) {
        document.removeEventListener('touchmove', move);
        listening = false;
      }
    }
    function move(event) {
      if (!side || event.touches.length !== 1) { stop(); return; }
      var touch = event.touches[0];
      var dx = touch.clientX - startX;
      var dy = touch.clientY - startY;
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx) * 1.2) { stop(); return; }
      var inward = side === 'left' ? dx > 0 : dx < 0;
      if (!inward || Math.abs(dx) <= 6 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
      if (event.cancelable) event.preventDefault();
      if (!sent && Math.abs(dx) >= 40) {
        sent = true;
        post({ type: 'edgeSwipe', edge: side });
      }
    }
    function start(event) {
      stop();
      if (event.touches.length !== 1) return;
      var touch = event.touches[0];
      side = touch.clientX <= edgeSize
        ? 'left'
        : touch.clientX >= window.innerWidth - edgeSize ? 'right' : null;
      if (!side) return;
      // Safari decides whether to navigate history at gesture start. Waiting
      // for touchmove is too late on iOS, so reserve this narrow edge zone now.
      if (event.cancelable) event.preventDefault();
      startX = touch.clientX;
      startY = touch.clientY;
      document.addEventListener('touchmove', move, { passive: false });
      listening = true;
    }
    document.documentElement.style.overscrollBehaviorX = 'none';
    document.addEventListener('touchstart', start, { passive: false });
    document.addEventListener('touchend', stop, { passive: true });
    document.addEventListener('touchcancel', stop, { passive: true });
  })();

  function clearOverlayMarks() {
    marks.forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    marks = [];
  }

  function drawSelection(range) {
    clearOverlayMarks();
    var rects = Array.prototype.slice.call(range.getClientRects());
    rects.forEach(function (rect) {
      if (rect.width < 1 || rect.height < 1) return;
      var el = document.createElement('span');
      el.className = 'kel-preview-selection';
      el.style.cssText =
        'position:absolute;pointer-events:none;z-index:2147483000;' +
        'left:' + (rect.left + window.scrollX) + 'px;' +
        'top:' + (rect.top + window.scrollY) + 'px;' +
        'width:' + rect.width + 'px;' +
        'height:' + rect.height + 'px;' +
        'background:rgba(250,204,21,.34);border-radius:3px;' +
        'box-shadow:0 0 0 1px rgba(234,179,8,.2) inset;';
      document.body.appendChild(el);
      marks.push(el);
    });
  }

  function clearSelection() {
    clearOverlayMarks();
    var sel = window.getSelection && window.getSelection();
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
    lastRange = null;
  }

  function collectBlockIds(range) {
    var blockIds = [];
    var blocks = document.querySelectorAll(
      'p[data-lark-block-id],h1[data-lark-block-id],h2[data-lark-block-id],h3[data-lark-block-id],h4[data-lark-block-id],h5[data-lark-block-id],h6[data-lark-block-id],li[data-lark-block-id],pre[data-lark-block-id],table[data-lark-block-id],blockquote[data-lark-block-id]'
    );
    for (var i = 0; i < blocks.length; i++) {
      try {
        if (!range.intersectsNode(blocks[i])) continue;
        var id = blocks[i].getAttribute('data-lark-block-id');
        if (id && blockIds.indexOf(id) < 0) blockIds.push(id);
      } catch (e) {}
    }
    return blockIds;
  }

  var selectionTimer = null;
  document.addEventListener('selectionchange', function () {
    if (selectionTimer) clearTimeout(selectionTimer);
    selectionTimer = setTimeout(function () {
      var sel = window.getSelection && window.getSelection();
      var text = sel ? String(sel.toString()) : '';
      var blockIds = [];
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        lastRange = sel.getRangeAt(0).cloneRange();
        drawSelection(lastRange);
        blockIds = collectBlockIds(lastRange);
      } else {
        clearOverlayMarks();
      }
      post({ type: 'selection', text: text, blockIds: blockIds });
    }, 150);
  });

  var scrollTimer = null;
  window.addEventListener('scroll', function () {
    if (scrollTimer) clearTimeout(scrollTimer);
    if (marks.length > 0 && lastRange) drawSelection(lastRange);
    scrollTimer = setTimeout(function () {
      post({ type: 'scroll', offset: window.scrollY || window.pageYOffset || 0 });
    }, 150);
  }, { passive: true });

  document.addEventListener('click', function (event) {
    var target = event.target;
    while (target && target !== document.body) {
      if (target.getAttribute && target.getAttribute('data-kel-src')) break;
      target = target.parentNode;
    }
    if (target && target.getAttribute && target.getAttribute('data-kel-src')) {
      event.preventDefault();
      clearSelection();
      var path = target.getAttribute('data-kel-src');
      var kind = target.getAttribute('data-kind') === 'whiteboard' ? 'whiteboard' : 'image';
      post({ type: 'imageRef', path: path, kind: kind });
      return;
    }

    var link = event.target && event.target.closest && event.target.closest('a[href]');
    if (link && /^https?:/i.test(link.href)) {
      event.preventDefault();
      if (window.ReactNativeWebView) {
        post({ type: 'external', url: link.href });
      } else {
        window.open(link.href, '_blank', 'noopener,noreferrer');
      }
    }
  });

  function setImageRef(path) {
    var all = document.querySelectorAll('.kel-media[data-kel-src]');
    all.forEach(function (el) {
      var on = !!path && el.getAttribute('data-kel-src') === path;
      el.classList.toggle('kel-ref-selected', on);
    });
  }

  function flash() {
    if (!flashWrap) return;
    flashWrap.classList.remove('kel-doc-flash');
    void flashWrap.offsetWidth;
    flashWrap.classList.add('kel-doc-flash');
    setTimeout(function () { flashWrap.classList.remove('kel-doc-flash'); }, 1300);
  }

  function restoreScroll(offset) {
    window.scrollTo(0, offset || 0);
    if (marks.length > 0 && lastRange) drawSelection(lastRange);
  }

  function scrollToHeading(index) {
    var hs = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    var target = hs[index];
    if (target && target.scrollIntoView) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function replaceAsset(path, html) {
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
  }

  function replacePlantUml(id, html) {
    if (!id) return false;
    var target = document.querySelector('[data-kel-plantuml-id="' + id.replace(/"/g, '\\"') + '"]');
    if (!target) return false;
    var parser = document.createElement('template');
    parser.innerHTML = html || '';
    var replacement = parser.content.firstElementChild;
    if (!replacement) return false;
    target.replaceWith(replacement);
    return true;
  }

  function markWorking() {
    var sel = window.getSelection && window.getSelection();
    try {
      var range = (!sel || sel.isCollapsed || sel.rangeCount === 0) ? lastRange : sel.getRangeAt(0);
      if (!range || range.collapsed) return;
      clearOverlayMarks();
      var mark = document.createElement('mark');
      mark.className = 'kel-ai-working';
      range.surroundContents(mark);
      lastRange = null;
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    } catch (e) {}
  }

  function clearWorking() {
    var marks = document.querySelectorAll('mark.kel-ai-working');
    marks.forEach(function (m) {
      var parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    });
    lastRange = null;
  }

  function markChangedBlocks(sigs) {
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
    var count = 0;
    for (var i = 0; i < kids.length; i++) {
      if (want[sigOf(kids[i])]) { kids[i].classList.add('kel-changed'); count++; }
      else kids[i].classList.remove('kel-changed');
    }
    post({ type: 'changedBlocks', count: count });
  }

  var changedCursor = -1;
  function jumpToChangedBlock(direction) {
    var marked = document.querySelectorAll('.kel-changed');
    if (!marked || marked.length === 0) return;
    var step = direction === 'prev' ? -1 : 1;
    changedCursor = ((changedCursor + step) % marked.length + marked.length) % marked.length;
    var target = marked[changedCursor];
    if (!target) return;
    target.classList.remove('kel-changed-pulse');
    void target.offsetWidth;
    target.classList.add('kel-changed-pulse');
    if (target.scrollIntoView) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(function () { target.classList.remove('kel-changed-pulse'); }, 1400);
  }

  window.__kelDocumentCommands = {
    clearSelection: clearSelection,
    setImageRef: setImageRef,
    flash: flash,
    restoreScroll: restoreScroll,
    scrollToHeading: scrollToHeading,
    replaceAsset: replaceAsset,
    replacePlantUml: replacePlantUml,
    markWorking: markWorking,
    clearWorking: clearWorking,
    markChangedBlocks: markChangedBlocks,
    jumpToChangedBlock: jumpToChangedBlock,
  };

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (!message || message.type !== 'kel-document-command') return;
    var command = window.__kelDocumentCommands[message.command];
    if (typeof command !== 'function') return;
    if (message.command === 'replaceAsset') command(message.path, message.html);
    else if (message.command === 'replacePlantUml') command(message.id, message.html);
    else if (message.command === 'setImageRef') command(message.path || '');
    else if (message.command === 'restoreScroll' || message.command === 'scrollToHeading') command(message.value);
    else if (message.command === 'markChangedBlocks') command(message.value || []);
    else if (message.command === 'jumpToChangedBlock') command(message.direction || 'next');
    else command();
  });

  post({ type: 'ready' });
})();
`;

export function buildSharedDocumentHtml(contentHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    html, body { margin: 0; padding: 0; background: #fafafa; -webkit-text-size-adjust: 100%; }
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
      box-sizing: border-box;
      outline: none;
    }
    .kel-empty-document {
      min-height: calc(100vh - 32px);
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      padding: 24px;
      color: #94a3b8;
      font-size: 14px;
      text-align: center;
    }
    ${EDITOR_DOC_CSS}
  </style>
</head>
<body>
  <div id="kel-flash">
    <div id="kel-root" class="tiptap">${contentHtml}</div>
  </div>
  <script>${BRIDGE_SCRIPT.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>`;
}
