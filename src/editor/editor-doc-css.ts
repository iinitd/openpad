// The document rendering CSS shared by the web editor (injected into <head>)
// and the native editor (embedded inside the WebView document). Keeping a
// single source means a highlighted passage looks identical on both platforms.
export const EDITOR_DOC_CSS = `
  .annotation-highlight {
    background-color: #fef08a;
    border-bottom: 2px solid #eab308;
    border-radius: 2px;
    padding: 1px 0;
    cursor: pointer;
  }
  .annotation-highlight:hover {
    background-color: #fde047;
  }
  .tiptap {
    outline: none;
    box-sizing: border-box;
    width: 100%;
    max-width: 820px;
    margin: 0 auto;
    color: #18181b;
  }
  .tiptap[contenteditable="false"] { cursor: default; }
  .tiptap p,
  .tiptap li,
  .tiptap blockquote,
  .tiptap h1,
  .tiptap h2,
  .tiptap h3,
  .tiptap h4,
  .tiptap h5,
  .tiptap h6,
  .tiptap .kel-callout,
  .tiptap .kel-embed-card,
  .tiptap .kel-figure-caption {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .tiptap p { margin: 0.7em 0; line-height: 1.65; }
  .tiptap h1 { font-size: 1.85em; font-weight: 720; letter-spacing: -0.022em; line-height: 1.3; margin-top: 1.1em; margin-bottom: 0.6em; }
  .tiptap h1.kel-document-title { font-size: 2.1em; margin-top: 0; margin-bottom: 0.9em; }
  .tiptap h2 { font-size: 1.4em; font-weight: 660; letter-spacing: -0.018em; line-height: 1.35; margin-top: 1.6em; margin-bottom: 0.5em; }
  .tiptap h3 { font-size: 1.18em; font-weight: 640; letter-spacing: -0.012em; margin-top: 1.3em; margin-bottom: 0.4em; }
  .tiptap h4, .tiptap h5, .tiptap h6 { font-size: 1.04em; font-weight: 640; margin-top: 1.1em; margin-bottom: 0.3em; }
  .tiptap ul, .tiptap ol { padding-left: 1.4em; margin-bottom: 0.6em; }
  .tiptap li { margin: 0.25em 0; }
  .tiptap blockquote { border-left: 2px solid #e9e9ec; padding-left: 1.1em; color: #52525b; margin: 1em 0; }
  /* Lark callout → highlight block. Tint + accent come from the document's own
     background-color / border-color (exposed as CSS variables in
     file-content.ts), falling back to a neutral grey. The emoji is drawn as a
     leading marker via data-emoji so the body text stays clean. */
  .tiptap .kel-callout {
    position: relative;
    background-color: var(--kel-callout-bg, #f8fafc);
    border: 1px solid var(--kel-callout-border, #e2e8f0);
    border-left-width: 4px;
    border-radius: 8px;
    padding: 12px 14px 12px 16px;
    margin: 0.75em 0;
  }
  .tiptap .kel-callout[data-emoji] { padding-left: 44px; }
  .tiptap .kel-callout[data-emoji]::before {
    content: attr(data-emoji);
    position: absolute;
    left: 14px;
    top: 12px;
    font-size: 18px;
    line-height: 1.4;
  }
  .tiptap .kel-callout > :first-child { margin-top: 0; }
  .tiptap .kel-callout > :last-child { margin-bottom: 0; }
  .tiptap .kel-grid {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin: 0.9em 0;
    min-width: 0;
  }
  .tiptap .kel-column { flex: var(--kel-column-ratio, 1) 1 0; min-width: 0; }
  .tiptap .kel-figure { margin: 1em 0; text-align: center; }
  .tiptap .kel-figure > .kel-media, .tiptap .kel-figure > img { max-width: 100%; }
  .tiptap .kel-figure .kel-figure-caption { margin-top: 7px; color: #8f959e; font-size: 12px; line-height: 1.45; }
  .tiptap .kel-embed-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    margin: 0.75em 0;
    border: 1px solid #dee0e3;
    border-radius: 8px;
    background: #fafbfc;
    color: #4e5969;
  }
  .tiptap .kel-embed-card .kel-embed-icon { font-size: 22px; color: #00a870; }
  .tiptap .kel-reference .kel-embed-icon { color: #3370ff; }
  .tiptap .kel-embed-card strong, .tiptap .kel-embed-card small { display: block; }
  .tiptap .kel-embed-card small { margin-top: 2px; color: #8f959e; font-size: 12px; }
  .tiptap code {
    background-color: #f4f4f5;
    border-radius: 6px;
    padding: 2px 6px;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    font-size: 0.88em;
    white-space: break-spaces;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .tiptap mark { background-color: #fef08a; border-radius: 2px; padding: 1px 0; }
  .tiptap a {
    color: #5b5bd6;
    text-decoration: underline;
    text-decoration-color: rgba(91, 91, 214, 0.35);
    text-underline-offset: 2px;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .tiptap hr {
    border: none;
    height: 1px;
    background: #efeff1;
    margin: 2em 0;
  }
  .tiptap img { max-width: 100%; height: auto; }
  /* A resolved Lark image / whiteboard, wrapped so a corner badge can label
     the format (png/jpg/svg) and distinguish a real picture from an exported
     whiteboard. The badge text comes from data-format; whiteboards also get a
     distinct tint via data-kind. */
  .tiptap .kel-media {
    position: relative;
    display: inline-block;
    max-width: 100%;
    line-height: 0;
  }
  .tiptap .kel-media img { display: block; }
  /* Lightweight placeholder shown while a real asset is still being read +
     inlined (see resolve-doc-images.ts). Reserves visible space and names the
     kind so a long document renders its text instantly and stays responsive
     instead of blocking on 14MB of base64; the real image replaces it on the
     next content reload. */
  .tiptap .kel-media-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 120px;
    min-height: 88px;
    padding: 12px 16px;
    line-height: 1.4;
    color: #94a3b8;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background: #f1f5f9;
    border: 1px dashed #cbd5e1;
    border-radius: 8px;
  }
  .tiptap .kel-media-loading::after { content: none; }
  .tiptap .kel-plantuml {
    display: block;
    margin: 1em 0;
    overflow: auto hidden;
  }
  .tiptap .kel-plantuml.kel-media-loading {
    min-width: 0;
    min-height: 120px;
    text-transform: none;
    letter-spacing: 0;
  }
  .tiptap .kel-plantuml svg {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 0 auto;
  }
  .tiptap .kel-plantuml-error {
    padding: 14px 16px;
    color: #991b1b;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  /* In preview (read-only) mode an embedded asset can be tapped to become the
     AI-comment reference, so hint that it's interactive. */
  .tiptap[contenteditable="false"] .kel-media { cursor: pointer; }
  /* The currently-referenced asset gets a slate ring so the user sees what the
     comment bar is pointing at. */
  .tiptap .kel-media.kel-ref-selected {
    outline: 3px solid #64748b;
    outline-offset: 2px;
    border-radius: 4px;
  }
  .tiptap .kel-media::after {
    content: attr(data-format);
    position: absolute;
    top: 6px;
    right: 6px;
    font-size: 10px;
    line-height: 1;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: #fff;
    background: rgba(15, 23, 42, 0.72);
    padding: 3px 6px;
    border-radius: 4px;
    pointer-events: none;
  }
  .tiptap .kel-media[data-kind="whiteboard"]::after {
    background: rgba(37, 99, 235, 0.82);
  }
  /* Tables may be wider than the prose column, but they must scroll inside
     their own wrapper rather than widening the whole page. This keeps wide
     markdown tables readable without crushing every column to fit. On web
     TipTap wraps tables in div.tableWrapper via its node view; on native
     file-content.ts adds the same wrapper. */
  .tiptap .kel-table-clip {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    overflow-x: hidden;
  }
  .tiptap .tableWrapper {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    max-width: 100%;
    margin: 0.75em 0;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
  }
  .tiptap table {
    border-collapse: collapse;
    /* Fit the prose column. If column count makes auto layout impossible to
       fit, the wrapper's overflow-x kicks in. We no longer use max-content
       because it forces single-line cells and bypasses cell max-width. */
    width: 100%;
    max-width: 100%;
    table-layout: auto;
    margin: 0;
  }
  .tiptap th, .tiptap td {
    border: none;
    border-bottom: 1px solid #efeff1;
    padding: 10px 12px;
    vertical-align: top;
    text-align: left;
    overflow-wrap: anywhere;
    word-break: normal;
    white-space: normal;
    /* Lower the min so narrow screens don't force each column to 6em. */
    min-width: 3em;
    /* Hard cap per cell so a long paragraph can't inflate its column. */
    max-width: 28em;
  }
  .tiptap th {
    background-color: transparent;
    font-size: 0.78em;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #71717a;
    border-bottom-color: #e4e4e7;
  }
  .tiptap tr:last-child td { border-bottom: none; }
  @media (max-width: 680px) {
    .tiptap .kel-grid { gap: 8px; }
    .tiptap h1.kel-document-title { font-size: 1.65em; }
  }
  .tiptap pre {
    background-color: #fafafa;
    color: #18181b;
    border: 1px solid #ececef;
    border-radius: 12px;
    padding: 14px 16px;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    font-size: 0.88em;
    line-height: 1.55;
    overflow-x: hidden;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    margin-bottom: 0.5em;
  }
  .tiptap pre code {
    background: transparent;
    color: inherit;
    padding: 0;
    white-space: inherit;
  }
  .kel-ai-pending { background-color: #e2e8f0; border-bottom: 2px dashed #94a3b8; }
  @keyframes kel-ai-pulse {
    0%   { background-color: #e2e8f0; box-shadow: 0 0 0 0 rgba(100,116,139,0.45); }
    50%  { background-color: #cbd5e1; box-shadow: 0 0 6px 2px rgba(100,116,139,0.3); }
    100% { background-color: #e2e8f0; box-shadow: 0 0 0 0 rgba(100,116,139,0.45); }
  }
  /* A commented span the AI is actively revising: gentle pulse + a small
     "revising" chip, so the user sees exactly where work is happening while
     the turn runs, instead of staring at a static document. */
  .tiptap mark.kel-ai-working {
    background-color: #e2e8f0;
    border-bottom: 2px dashed #94a3b8;
    border-radius: 3px;
    animation: kel-ai-pulse 1.4s ease-in-out infinite;
    position: relative;
  }
  .tiptap mark.kel-ai-working::after {
    content: none;
  }
  /* Only the first fragment of a multi-block highlight carries the chip, so a
     single highlight shows one "revising…" banner instead of one per line. */
  .tiptap mark.kel-ai-working-lead::after {
    content: "✦ revising…";
    position: absolute;
    top: -1.35em;
    left: 0;
    font-size: 10px;
    line-height: 1;
    white-space: nowrap;
    background: #1f2937;
    color: #fff;
    padding: 3px 6px;
    border-radius: 4px;
    font-weight: 600;
    pointer-events: none;
  }
  @keyframes kel-doc-flash {
    0% { background-color: rgba(100,116,139,0.16); }
    100% { background-color: transparent; }
  }
  .kel-doc-flash .tiptap {
    animation: kel-doc-flash 1.2s ease-out;
  }
  /* EXPERIMENTAL — paragraph-level "the AI changed this" tint. After the agent
     revises the open file, the blocks that are new-or-modified relative to the
     pre-revise document get this class so the user can see, at a glance, where
     the revision landed. A soft green resting tint with a left accent (drawn as
     an inset box-shadow so it never shifts the text) reads as "updated" without
     the loud yellow of a user highlight; a brief fade-in draws the eye when it
     first appears. Display-only: it just stays until the next revision. */
  .tiptap .kel-changed {
    background-color: #ecfdf5;
    box-shadow: inset 3px 0 0 0 #34d399;
    border-radius: 3px;
    animation: kel-changed-in 0.6s ease-out;
  }
  @keyframes kel-changed-in {
    0% { background-color: #bbf7d0; }
    100% { background-color: #ecfdf5; }
  }
  /* Pulse applied by the "jump to next diff" cursor so the landed-on block
     flashes briefly on scroll-in. */
  .tiptap .kel-changed-pulse,
  .kel-changed-pulse {
    animation: kel-changed-pulse 1.2s ease-out;
  }
  @keyframes kel-changed-pulse {
    0% { background-color: #86efac; }
    60% { background-color: #bbf7d0; }
    100% { background-color: #ecfdf5; }
  }
`;
