import { Extension, Node, mergeAttributes } from "@tiptap/core";

// Keep the source Docx block ID on the ordinary ProseMirror nodes that make up
// a pulled Feishu working copy. This is display metadata, not editable text.
export const LarkBlockAttributes = Extension.create({
  name: "larkBlockAttributes",
  addGlobalAttributes() {
    return [{
      types: [
        "paragraph", "heading", "listItem", "blockquote", "codeBlock",
        "table", "tableRow", "tableHeader", "tableCell", "image",
      ],
      attributes: {
        larkBlockId: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute("data-lark-block-id"),
          renderHTML: (attributes: { larkBlockId?: string | null }) =>
            attributes.larkBlockId ? { "data-lark-block-id": attributes.larkBlockId } : {},
        },
        larkStyle: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute("style"),
          renderHTML: (attributes: { larkStyle?: string | null }) =>
            attributes.larkStyle ? { style: attributes.larkStyle } : {},
        },
        larkDocumentTitle: {
          default: false,
          parseHTML: (element: HTMLElement) => element.classList.contains("kel-document-title"),
          renderHTML: (attributes: { larkDocumentTitle?: boolean }) =>
            attributes.larkDocumentTitle ? { class: "kel-document-title" } : {},
        },
      },
    }];
  },
});

function structureNode(name: string, className: string) {
  return Node.create({
    name,
    group: "block",
    content: "block+",
    defining: true,
    addAttributes() {
      return {
        larkBlockId: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute("data-lark-block-id"),
          renderHTML: (attributes: { larkBlockId?: string | null }) =>
            attributes.larkBlockId ? { "data-lark-block-id": attributes.larkBlockId } : {},
        },
        style: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute("style"),
          renderHTML: (attributes: { style?: string | null }) =>
            attributes.style ? { style: attributes.style } : {},
        },
      };
    },
    parseHTML() { return [{ tag: `div.${className}` }]; },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { class: className }), 0];
    },
  });
}

export const LarkGrid = structureNode("larkGrid", "kel-grid");
export const LarkColumn = structureNode("larkColumn", "kel-column");
export const LarkFigure = structureNode("larkFigure", "kel-figure");

export const LarkEmbed = Node.create({
  name: "larkEmbed",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      larkBlockId: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-lark-block-id") },
      kind: { default: "reference", parseHTML: (el: HTMLElement) => el.classList.contains("kel-sheet") ? "sheet" : "reference" },
      title: { default: "Referenced Feishu document", parseHTML: (el: HTMLElement) => el.querySelector("strong")?.textContent || "Referenced Feishu document" },
      subtitle: { default: "", parseHTML: (el: HTMLElement) => el.querySelector("small")?.textContent || "" },
      token: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-sheet-token") || el.getAttribute("data-doc-id") },
    };
  },
  parseHTML() { return [{ tag: "div.kel-embed-card" }]; },
  renderHTML({ node }) {
    const attrs: Record<string, string> = { class: `kel-embed-card kel-${node.attrs.kind}` };
    if (node.attrs.larkBlockId) attrs["data-lark-block-id"] = node.attrs.larkBlockId;
    if (node.attrs.token) attrs[node.attrs.kind === "sheet" ? "data-sheet-token" : "data-doc-id"] = node.attrs.token;
    return ["div", attrs,
      ["span", { class: "kel-embed-icon" }, node.attrs.kind === "sheet" ? "▦" : "↗"],
      ["span", {}, ["strong", {}, node.attrs.title], ["small", {}, node.attrs.subtitle]],
    ];
  },
});
