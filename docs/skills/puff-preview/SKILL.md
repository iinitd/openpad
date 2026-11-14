---
name: puff-preview
description: Author a `preview/` subtree that renders inside Clacko's Web Preview. Use when creating or editing a Paseo project's visual preview (dashboards, canvases, mini apps) that reads data or assets from files in the project.
---

# puff-preview

The Web Preview surface in this app is an iframe/WebView that renders a single
project's **`preview/index.html`**, with every referenced asset inlined as a
data URL by the loader. Follow these rules to make a preview that actually
displays and that an agent can safely iterate on.

## File layout

Place preview files **inside the Paseo project root** (the slug directory the
user picked), not at the workspace root:

```
<cwd>/projects/<slug>/
├─ preview/
│  ├─ index.html          ← required entry
│  ├─ styles.css
│  ├─ app.js
│  └─ ...                 ← any sub-tree is walked
├─ assets/                ← OK: preview can reference ../assets/foo.png
├─ data/                  ← OK: preview can fetch("../data/items.json")
└─ anything else inside the slug
```

The loader will:

1. Walk every file under `preview/` (max 400 files, 24 MB).
2. Starting from `index.html`, follow references in `<link>`, `<script>`,
   `<img|source|video|audio|iframe>`, CSS `url(...)` and `@import` and pull in
   referenced files from **anywhere inside the project root**.
3. Clamp relative resolution at the project root — `../../something` outside
   the slug is dropped silently.

JS is **not** statically parsed. Any file a script needs at runtime must
either be reachable via one of the HTML/CSS references above, or be fetched
from a path that resolves inside the project root (see "Runtime fetch" below).

## `index.html` requirements

- Must exist at `preview/index.html` and be valid HTML text (not a template
  placeholder).
- Give it a `<title>` — the toolbar label uses it.
- Keep `<meta name="viewport" content="width=device-width, initial-scale=1">`;
  the frame is narrow on phones.
- Prefer a single stylesheet + single script; both will be inlined.

## Referencing assets

Relative paths behave like a normal browser URL resolution, but with the
project root as the virtual site root.

```html
<!-- From preview/index.html -->
<link rel="stylesheet" href="styles.css">            <!-- preview/styles.css   -->
<script src="app.js"></script>                       <!-- preview/app.js       -->
<img src="../assets/logo.png">                       <!-- <slug>/assets/logo.png -->
<img src="/data/avatar.png">                         <!-- <slug>/data/avatar.png -->
```

Avoid:

- `//cdn.example.com/...` or `https://...` — these are **not** proxied; they
  hit the host network from the iframe, which may be blocked by the sandbox.
- `../../somewhere-outside-slug` — resolves to `null`, reference is left
  untouched in the HTML and will 404 inside the iframe.

## Runtime fetch (JSON, incremental data)

The loader injects a `fetch` shim. When your script calls
`fetch(somePath, init)`, the shim rewrites the request to the inlined data
URL if `somePath` matches a snapshot file by either:

- its project-root-relative path (e.g. `"data/items.json"`,
  `"preview/manifest.json"`), or
- its `preview/`-relative path (e.g. `"items.json"` from inside preview).

So both of these work from `preview/app.js`:

```js
const items = await (await fetch("./items.json")).json();   // preview/items.json
const chart = await (await fetch("../data/chart.json")).json(); // slug/data/chart.json
```

If the file is not in the snapshot (either not referenced by HTML/CSS and not
preloaded into the fetch map), the shim falls through to the real network
`fetch`, which will usually fail from inside the sandboxed iframe. To
guarantee a file is available at runtime, **reference it from HTML/CSS** too
(e.g. a `<link rel="preload" href="../data/chart.json" as="fetch">`), so the
loader pulls it in.

## Persistent state

Use `window.kelPreviewState.get(key)` / `.set(key, value)` for anything you
want to survive navigation and refresh. The state is scoped by `(cwd,
rootPath)`, so each project gets its own namespace. Values must be
JSON-serializable; the API resolves to `null` on a miss and `false` if set
fails.

```js
const todos = (await kelPreviewState.get("todos")) ?? [];
await kelPreviewState.set("todos", nextTodos);
```

## Selections and comments

The preview exposes selected text to the host so the user can comment or
instruct an agent. You don't need to wire anything up — selection highlighting
and the comment bar are automatic. Keep text selectable (don't blanket-apply
`user-select: none`), and prefer semantic HTML so selections map cleanly onto
meaningful ranges.

## Sandbox and sizing

- The iframe runs with `allow-scripts allow-forms allow-modals allow-popups
  allow-popups-to-escape-sandbox allow-downloads`. No `allow-same-origin` —
  so `document.cookie`, `localStorage`, and cross-origin reads are blocked;
  that is intentional. Use `kelPreviewState` instead of `localStorage`.
- The frame is mobile-first. Design for ~360 CSS px minimum, use flex/grid,
  avoid fixed widths.
- **No page-level horizontal scrollbar.** The page/body must never scroll
  horizontally — it looks broken in the narrow frame. Enforce it and let any
  genuinely wide content scroll *locally* instead:
  - Set `html, body { max-width: 100%; overflow-x: hidden; }`.
  - Let long unbreakable strings (URLs, IDs) wrap: `overflow-wrap: anywhere`
    on text containers (`p, li, td, a, …`).
  - For content that truly can't shrink (wide tables, code blocks, charts),
    wrap it in a block container with `overflow-x: auto` so the scroll is
    confined to that box, not the whole page. For tables, `display: block;
    overflow-x: auto` on the table itself works.
  - Avoid fixed pixel widths wider than ~360px and `white-space: nowrap` on
    long runs; those are the usual culprits that push the page sideways.

## Fast iteration loop

1. Create `preview/index.html` with a stub.
2. Open the preview from the app; the toolbar title should match
   `<title>`.
3. Edit any file inside the slug. The user triggers refresh from the
   sidebar / file-tap action, which calls the preview's `refresh()`. The
   fingerprint comparison skips re-render when nothing changed.
4. For a totally new preview surface, write a fresh `preview/` subtree —
   don't try to adapt an existing website layout; the single-file inlining
   means fewer, flatter files render fastest.

## When NOT to use this skill

- Editing files outside `<slug>/`. The preview will not see them.
- Building something that needs cross-origin APIs — the sandbox will block
  them. Use the agent to prefetch and bake the data into
  `<slug>/data/*.json` instead.
- Building a UI that must directly manipulate workspace files. Preview is
  read-only; routing edits should go through the chat agent.
