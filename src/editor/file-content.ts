// Render document source into HTML for the TipTap editor.
//
// Puff documents are mixed-format: a file can be plain Markdown, Lark "docx-xml"
// (custom block tags like <title>/<callout>/<whiteboard>/<cite> plus HTML
// tables), or a blend of both. We therefore:
//   1. strip YAML frontmatter,
//   2. rewrite the Lark-specific custom tags into standard HTML elements that
//      TipTap's schema understands (otherwise TipTap silently drops unknown
//      nodes *and their contents*), then
//   3. run `marked` over the result. marked converts Markdown and passes raw
//      HTML through untouched, so mixed content survives.

import { marked } from "marked";
import { highlightCode } from "./code-highlight";

marked.setOptions({
  gfm: true,
  breaks: false,
});

// Remove a leading YAML frontmatter block (--- ... ---).
export function stripFrontmatter(src: string): string {
  const m = /^\uFEFF?---\n[\s\S]*?\n---\n?/.exec(src);
  return m ? src.slice(m[0].length) : src;
}

function attr(attrs: string, name: string): string {
  return new RegExp(String.raw`(?:^|\s)${name}="([^"]*)"`, "i").exec(attrs)?.[1] ?? "";
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function buildPlantUmlPlaceholder(id: string, source: string): string {
  return `<div class="kel-plantuml kel-media-loading" data-kel-plantuml-id="${escapeAttr(id)}" data-kel-plantuml-source="${escapeAttr(encodeURIComponent(source))}" data-kel-plantuml-state="loading">PlantUML preview</div>`;
}

function createMarkdownRenderer() {
  const renderer = new marked.Renderer();
  const defaultCode = renderer.code.bind(renderer);
  let plantUmlIndex = 0;

  renderer.code = (token) => {
    const lang = token.lang?.trim().toLowerCase();
    if (lang === "plantuml") {
      plantUmlIndex += 1;
      return `${buildPlantUmlPlaceholder(`plantuml-${plantUmlIndex}`, token.text)}\n`;
    }
    return defaultCode(token);
  };

  return renderer;
}

function blockIdAttr(attrs: string): string {
  const id = attr(attrs, "id");
  return id ? ` data-lark-block-id="${escapeAttr(id)}"` : "";
}

function styleAttrs(attrs: string): string {
  const styles: string[] = [];
  const background = attr(attrs, "background-color");
  const color = attr(attrs, "text-color");
  const vertical = attr(attrs, "vertical-align");
  const align = attr(attrs, "align");
  if (background) styles.push(`background-color:${background}`);
  if (color) styles.push(`color:${color}`);
  if (vertical) styles.push(`vertical-align:${vertical}`);
  if (align) styles.push(`text-align:${align}`);
  return styles.length ? ` style="${escapeAttr(styles.join(";"))}"` : "";
}

export function isLarkWorkingCopySource(src: string): boolean {
  return /(?:^|\n)destination:\s*https?:\/\/[^\n]+\/(?:wiki|docx)\//i.test(src)
    && /<(?:title|p|h[1-9]|li|table|callout)\b[^>]*\bid="[^"]+"/i.test(src);
}

// Rewrite Lark/docx-xml custom tags into standard HTML. Content is preserved by
// mapping each custom container onto the closest standard element.
export function normalizeLarkTags(input: string): string {
  let out = input;

  out = out.replace(
    /<(h[1-6]|p|li|blockquote|pre|table|tr|th|td)\b([^>]*)>/gi,
    (_full, tag: string, attrs: string) => {
      const spans = ["colspan", "rowspan"].map((name) => {
        const value = attr(attrs, name);
        return value ? ` ${name}="${escapeAttr(value)}"` : "";
      }).join("");
      return `<${tag}${blockIdAttr(attrs)}${styleAttrs(attrs)}${spans}>`;
    },
  );

  // <title ...>X</title> → the document's editorial title. Run this after the
  // standard-block pass so our generated class and data attributes survive.
  out = out.replace(
    /<title\b([^>]*)>/gi,
    (_full, attrs: string) => `<h1 class="kel-document-title"${blockIdAttr(attrs)}>`,
  ).replace(/<\/title>/gi, "</h1>");

  // <callout ...>...</callout> → a highlight block. Lark callouts carry their
  // own presentation in the source (the single source of truth): a
  // `background-color`, a `border-color`, and a leading `emoji`. We render a
  // `<div class="kel-callout">` that reproduces that tint via CSS variables and
  // shows the emoji as a leading marker. On web the Callout TipTap node keeps
  // the div (class/style/data-emoji preserved); on native the raw HTML + shared
  // CSS render it directly. Real Markdown `>` quotes still become <blockquote>,
  // so callouts read distinctly from ordinary quotes.
  out = out.replace(
    /<callout\b([^>]*)>([\s\S]*?)<\/callout>/gi,
    (_full, attrs: string, body: string) => {
      const bg = attr(attrs, "background-color");
      const border = attr(attrs, "border-color");
      const emoji = attr(attrs, "emoji");
      const styleParts: string[] = [];
      if (bg) styleParts.push(`--kel-callout-bg:${bg}`);
      if (border) styleParts.push(`--kel-callout-border:${border}`);
      const style = styleParts.length ? ` style="${styleParts.join(";")}"` : "";
      const emojiAttr = emoji ? ` data-emoji="${emoji.replace(/"/g, "&quot;")}"` : "";
      // Blank line inside the div so marked treats the inner block markup /
      // paragraphs as their own content rather than one opaque HTML blob.
      return `<div class="kel-callout"${blockIdAttr(attrs)}${emojiAttr}${style}>\n\n${body}\n\n</div>`;
    },
  );

  // <whiteboard ...>…</whiteboard> or <whiteboard ... />. The document is
  // self-describing: a board records where its rendered asset lives via a
  // `src="<workspace-relative-path>"` attribute (e.g.
  // `src="diagrams/wb-x/preview.jpg"`). Three shapes, in order:
  //   1. Has src="path": emit a `kel-file:` marker; resolve-doc-images.ts reads
  //      that exact path over the daemon and inlines it as a data URI.
  //   2. Inline SVG body (`<whiteboard><svg>…</svg></whiteboard>`): render the
  //      SVG directly — it's self-contained and needs no fetch.
  //   3. Neither: a text placeholder, so a board with no recorded asset still
  //      degrades visibly instead of vanishing.
  const whiteboardOpen = (attrs: string): string => {
    const src = attr(attrs, "src");
    if (src) return `<div class="kel-figure kel-whiteboard"${blockIdAttr(attrs)}><img src="kel-file:${src}" alt="whiteboard" /></div>`;
    return "";
  };
  // Self-closing / empty: src form or a bare placeholder.
  out = out.replace(/<whiteboard\b([^>]*?)\/>/gi, (_full, attrs: string) => {
    return whiteboardOpen(attrs) || "<p><em>🖼️ [whiteboard]</em></p>";
  });
  out = out.replace(
    /<whiteboard\b([^>]*)>([\s\S]*?)<\/whiteboard>/gi,
    (_full, attrs: string, body: string) => {
      const marker = whiteboardOpen(attrs);
      if (marker) return marker;
      // Inline SVG board: keep the <svg> and wrap it with the board badge so
      // it renders locally (no fetch needed). resolve-doc-images.ts only
      // touches kel-file markers, so this passes through untouched.
      const svg = /<svg[\s\S]*?<\/svg>/i.exec(body)?.[0];
      if (svg) {
        return `<span class="kel-media" data-kind="whiteboard" data-format="board">${svg}</span>`;
      }
      return "<p><em>🖼️ [whiteboard]</em></p>";
    },
  );

  // <cite ... title="X" ...>...</cite> → a small reference line.
  out = out.replace(
    /<cite\b([^>]*)>[\s\S]*?<\/cite>/gi,
    (_full, attrs: string) => {
      const title = attr(attrs, "title") || "reference";
      const docId = attr(attrs, "doc-id");
      return `<div class="kel-embed-card kel-reference"${blockIdAttr(attrs)}${docId ? ` data-doc-id="${escapeAttr(docId)}"` : ""}><span class="kel-embed-icon">↗</span><span><strong>${title}</strong><small>飞书引用文档</small></span></div>`;
    },
  );
  out = out.replace(/<cite\b([^>]*)\/>/gi, (_full, attrs: string) => {
    const title = attr(attrs, "title") || "reference";
    const docId = attr(attrs, "doc-id");
    return `<div class="kel-embed-card kel-reference"${blockIdAttr(attrs)}${docId ? ` data-doc-id="${escapeAttr(docId)}"` : ""}><span class="kel-embed-icon">↗</span><span><strong>${title}</strong><small>飞书引用文档</small></span></div>`;
  });

  out = out.replace(
    /<grid\b([^>]*)>/gi,
    (_full, attrs: string) => `<div class="kel-grid"${blockIdAttr(attrs)}>`,
  ).replace(/<\/grid>/gi, "</div>");
  out = out.replace(/<column\b([^>]*)>/gi, (_full, attrs: string) => {
    const ratio = Number(attr(attrs, "width-ratio"));
    const style = Number.isFinite(ratio) && ratio > 0 ? ` style="--kel-column-ratio:${ratio}"` : "";
    return `<div class="kel-column"${blockIdAttr(attrs)}${style}>`;
  }).replace(/<\/column>/gi, "</div>");

  const sheetCard = (attrs: string) => {
    const token = attr(attrs, "token");
    const sheetId = attr(attrs, "sheet-id");
    return `<div class="kel-embed-card kel-sheet"${blockIdAttr(attrs)}${token ? ` data-sheet-token="${escapeAttr(token)}"` : ""}${sheetId ? ` data-sheet-id="${escapeAttr(sheetId)}"` : ""}><span class="kel-embed-icon">▦</span><span><strong>飞书电子表格</strong><small>${escapeAttr(sheetId || "嵌入对象")}</small></span></div>`;
  };
  out = out.replace(/<sheet\b([^>]*?)\/>/gi, (_full, attrs: string) => sheetCard(attrs));
  out = out.replace(/<sheet\b([^>]*)>[\s\S]*?<\/sheet>/gi, (_full, attrs: string) => sheetCard(attrs));

  // <img> handling. The document is the single source of truth for where an
  // asset lives: a renderable image records its own workspace-relative path in
  // `local-src` (e.g. `local-src="assets/doc-media/foo.jpg"`), while `src` may
  // still hold the upstream Feishu file token so the doc can be pushed back
  // precisely. We emit a `kel-file:<path>` marker that resolve-doc-images.ts
  // reads over the daemon. Resolution order:
  //   1. `local-src` present → use it (the recorded local path).
  //   2. no local-src, but `src` is a real URL / data URI / path → leave the
  //      tag untouched so the browser loads it directly.
  //   3. `src` is a bare token (no slash, no extension) → the doc failed to
  //      record a path, so degrade to a text placeholder instead of guessing a
  //      storage convention.
  // width/height attrs are dropped from the marker so a huge intrinsic size
  // can't cause horizontal overflow; the resolver re-adds a safe size.
  const looksLikePath = (s: string): boolean =>
    /^(https?:|data:)/i.test(s) || s.includes("/") || /\.[a-z0-9]{2,4}$/i.test(s);
  out = out.replace(/<img\b([^>]*?)\/?>(?:<\/img>)?/gi, (full, attrs: string) => {
    const src = attr(attrs, "src");
    // Already a kel-file marker (produced by the whiteboard rule above, or a
    // re-run over already-normalized html): leave untouched.
    if (/^kel-file:/i.test(src)) return full;
    const decode = (s: string) =>
      s
        .replace(/&#xA;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, " ")
        .trim();
    const caption = decode(attr(attrs, "caption"));
    const name = decode(attr(attrs, "name"));
    const label = (caption || name || "image").replace(/"/g, "&quot;");
    // 1. Explicitly recorded local path wins.
    const localSrc = attr(attrs, "local-src");
    const id = blockIdAttr(attrs);
    if (localSrc) return `<div class="kel-figure"${id}><img src="kel-file:${localSrc}" alt="${label}" />${caption ? `<p class="kel-figure-caption">${caption}</p>` : ""}</div>`;
    // 2. A real URL / data URI / path in src → render directly.
    if (src && /^(https?:|data:)/i.test(src)) return full;
    if (src && looksLikePath(src)) return `<div class="kel-figure"${id}><img src="kel-file:${src}" alt="${label}" />${caption ? `<p class="kel-figure-caption">${caption}</p>` : ""}</div>`;
    // 3. Bare token or empty → not self-describing; placeholder.
    return `<p><em>🖼️ [${label}]</em></p>`;
  });

  // Custom heading/paragraph attributes (id, seq, seq-level, seq-marker,
  // text-color, background-color, vertical-align, emoji, border-color, width)
  // are harmless to browsers but TipTap drops unknown attributes anyway, so we
  // leave them — the important part is the tag NAME is standard HTML.

  return out;
}

const MARKDOWN_EXTS = new Set([".md", ".markdown", ".mdx"]);
const HTML_EXTS = new Set([".html", ".htm"]);

function extname(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

function wrapTablesForPreview(html: string): string {
  // Shared HTML preview does not have TipTap's runtime table node view, so
  // every rendered table must be wrapped here. The outer clip prevents the
  // table's intrinsic width from contributing to page-level overflow, while
  // the inner wrapper remains the only horizontal scroller.
  return html.replace(
    /<table\b[\s\S]*?<\/table>/gi,
    (table) => `<div class="kel-table-clip"><div class="tableWrapper">${table}</div></div>`,
  );
}

// Core pipeline: normalize custom tags then let marked handle Markdown + inline
// raw HTML. Used for both file loading and AI-produced revisions.
export function markdownToHtml(src: string): string {
  const body = stripFrontmatter(src);
  const normalized = normalizeLarkTags(body);
  // A lark pull working copy is already block XML/HTML. Sending it through a
  // Markdown parser strips custom data attributes and can split nested media.
  // Keep the normalized HTML verbatim; mixed prose Markdown still uses marked.
  if (isLarkWorkingCopySource(src)) return wrapTablesForPreview(normalized);
  const html = marked.parse(normalized, {
    async: false,
    renderer: createMarkdownRenderer(),
  });
  return wrapTablesForPreview(typeof html === "string" ? html : String(html));
}

// Source files get a code view: preserved whitespace and a monospace block,
// rather than being poured through Markdown where indentation collapses.
const CODE_EXTS = new Set([
  ".json",
  ".jsonc",
  ".json5",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".env",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".swift",
  ".kt",
  ".java",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".sql",
  ".css",
  ".scss",
  ".less",
  ".lua",
  ".graphql",
  ".xml",
  ".log",
]);

const MAX_CODE_PREVIEW = 200_000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function prettyJson(raw: string): string | null {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return null;
  }
}

function codeFileToHtml(path: string, raw: string): string {
  const ext = extname(path);
  const formatted = ext === ".json" ? prettyJson(raw) ?? raw : raw;
  const body =
    formatted.length > MAX_CODE_PREVIEW
      ? `${formatted.slice(0, MAX_CODE_PREVIEW)}\n\n… truncated, ${formatted.length - MAX_CODE_PREVIEW} more characters`
      : formatted;
  return `<pre><code>${highlightCode(body.replace(/\s+$/, ""), ext)}</code></pre>`;
}

// Convert a workspace file's raw text into HTML suitable for the editor.
export function fileContentToHtml(path: string, raw: string): string {
  const ext = extname(path);
  // Even pure-HTML files may contain Lark custom tags, so normalize first.
  if (HTML_EXTS.has(ext)) return wrapTablesForPreview(normalizeLarkTags(raw));
  if (CODE_EXTS.has(ext)) return codeFileToHtml(path, raw);
  if (MARKDOWN_EXTS.has(ext)) return markdownToHtml(raw);
  // Unknown extension: still try the mixed pipeline; it degrades to plain
  // paragraphs for tag-free text.
  return markdownToHtml(raw);
}

export interface DocumentHeading {
  level: number; // 1–6
  text: string;
  // Ordinal among all headings in document order. Matches the order of
  // `querySelectorAll('h1,…,h6')` in the rendered DOM, so the TOC can scroll to
  // the Nth heading element by this index on both web and native.
  index: number;
}

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

// Extract the heading outline from rendered document HTML for the TOC. Works on
// both platforms (plain string/regex — no DOM), and the ordering matches the
// browser's document order so an index maps to the same heading element when we
// scroll to it.
export function extractHeadings(html: string): DocumentHeading[] {
  const headings: DocumentHeading[] = [];
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = re.exec(html)) !== null) {
    const level = parseInt(m[1]!, 10);
    const text = m[2]!
      .replace(/<[^>]+>/g, "") // drop inline markup inside the heading
      .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (e) => HTML_ENTITIES[e] ?? e)
      .replace(/\s+/g, " ")
      .trim();
    headings.push({ level, text: text || "Untitled", index });
    index += 1;
  }
  return headings;
}
