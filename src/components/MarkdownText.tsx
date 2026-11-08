import { useMemo, type ReactNode } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { marked, type Token, type Tokens } from "marked";
import { THEME } from "../styles/theme";

/**
 * Renders an assistant reply as markdown inside a chat bubble. Agents answer in
 * headings, lists, tables and fenced code; a plain Text block flattens all of
 * that into one grey paragraph.
 *
 * `marked` only tokenises here — every block is drawn with React Native views,
 * because a WebView per bubble would be far too heavy for a scrolling
 * transcript. Unknown or inline-only constructs fall back to their raw text.
 */

function renderInline(
  tokens: Token[] | undefined,
  depth = 0,
): ReactNode[] {
  if (!tokens || depth > 8) return [];
  return tokens.map((token, index) => {
    const key = `${token.type}-${index}`;
    switch (token.type) {
      case "text": {
        const text = token as Tokens.Text;
        return text.tokens ? (
          <Text key={key}>{renderInline(text.tokens, depth + 1)}</Text>
        ) : (
          <Text key={key}>{text.text}</Text>
        );
      }
      case "strong":
        return (
          <Text key={key} style={styles.strong}>
            {renderInline((token as Tokens.Strong).tokens, depth + 1)}
          </Text>
        );
      case "em":
        return (
          <Text key={key} style={styles.em}>
            {renderInline((token as Tokens.Em).tokens, depth + 1)}
          </Text>
        );
      case "del":
        return (
          <Text key={key} style={styles.del}>
            {renderInline((token as Tokens.Del).tokens, depth + 1)}
          </Text>
        );
      case "codespan":
        return (
          <Text key={key} style={styles.codeSpan}>
            {(token as Tokens.Codespan).text}
          </Text>
        );
      case "br":
        return "\n";
      case "escape":
        return <Text key={key}>{(token as Tokens.Escape).text}</Text>;
      case "link": {
        const link = token as Tokens.Link;
        const label = renderInline(link.tokens, depth + 1);
        return (
          <Text
            key={key}
            style={styles.link}
            onPress={() => {
              if (link.href) void Linking.openURL(link.href).catch(() => {});
            }}
          >
            {label.length > 0 ? label : link.href}
          </Text>
        );
      }
      case "image": {
        const image = token as Tokens.Image;
        // Images would need their own layout pass; the alt text still tells
        // the reader something is there.
        return (
          <Text key={key} style={styles.muted}>
            {image.text ? `[${image.text}]` : "[image]"}
          </Text>
        );
      }
      default: {
        const raw = (token as { raw?: string }).raw;
        return raw ? <Text key={key}>{raw}</Text> : null;
      }
    }
  });
}

function renderInlineOrText(token: Tokens.Text | Tokens.Paragraph): ReactNode[] {
  const nodes = renderInline(token.tokens);
  return nodes.length > 0 ? nodes : [token.text];
}

function inlinePlain(tokens: Token[] | undefined): string {
  if (!tokens) return "";
  return tokens
    .map((token) => {
      if (token.type === "text") {
        const text = token as Tokens.Text;
        return text.tokens ? inlinePlain(text.tokens) : text.text;
      }
      const value = (token as { text?: string }).text;
      return value ?? (token as { raw?: string }).raw ?? "";
    })
    .join("");
}

function renderBlocks(tokens: Token[]): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${token.type}-${index}`;
    switch (token.type) {
      case "space":
        return null;
      case "heading": {
        const heading = token as Tokens.Heading;
        const size =
          heading.depth === 1
            ? styles.h1
            : heading.depth === 2
              ? styles.h2
              : styles.h3;
        return (
          <Text key={key} selectable style={[styles.blockText, size, styles.heading]}>
            {renderInline(heading.tokens)}
          </Text>
        );
      }
      case "paragraph": {
        const paragraph = token as Tokens.Paragraph;
        return (
          <Text key={key} selectable style={styles.blockText}>
            {renderInline(paragraph.tokens)}
          </Text>
        );
      }
      case "text": {
        const text = token as Tokens.Text;
        return (
          <Text key={key} selectable style={styles.blockText}>
            {text.tokens ? renderInline(text.tokens) : text.text}
          </Text>
        );
      }
      case "code": {
        const code = token as Tokens.Code;
        return (
          <View key={key} style={styles.codeBlock}>
            {code.lang ? (
              <Text style={styles.codeLang}>{code.lang}</Text>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text selectable style={styles.codeText}>
                {code.text}
              </Text>
            </ScrollView>
          </View>
        );
      }
      case "blockquote": {
        const quote = token as Tokens.Blockquote;
        return (
          <View key={key} style={styles.quote}>
            {renderBlocks(quote.tokens)}
          </View>
        );
      }
      case "list": {
        const list = token as Tokens.List;
        return (
          <View key={key}>
            {list.items.map((item, itemIndex) => (
              <View key={itemIndex} style={styles.listItem}>
                <Text style={styles.listMarker}>
                  {item.task
                    ? item.checked
                      ? "☑"
                      : "☐"
                    : list.ordered
                      ? `${(list.start || 1) + itemIndex}.`
                      : "•"}
                </Text>
                <View style={styles.listBody}>
                  {item.tokens.length > 0 &&
                  (item.tokens[0]!.type === "text" ||
                    item.tokens[0]!.type === "paragraph") ? (
                    <Text selectable style={styles.blockText}>
                      {renderInlineOrText(
                        item.tokens[0] as Tokens.Text | Tokens.Paragraph,
                      )}
                    </Text>
                  ) : null}
                  {renderBlocks(
                    item.tokens.filter(
                      (entry) => entry.type !== "text" && entry.type !== "paragraph",
                    ),
                  )}
                </View>
              </View>
            ))}
          </View>
        );
      }
      case "table": {
        const table = token as Tokens.Table;
        return (
          <View key={key} style={styles.table}>
            <View style={[styles.tableRow, styles.tableHead]}>
              {table.header.map((cell, cellIndex) => (
                <Text
                  key={cellIndex}
                  style={[
                    styles.tableCell,
                    styles.strong,
                    { textAlign: table.align[cellIndex] ?? "left" },
                  ]}
                >
                  {inlinePlain(cell.tokens) || cell.text}
                </Text>
              ))}
            </View>
            {table.rows.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.tableRow}>
                {row.map((cell, cellIndex) => (
                  <Text
                    key={cellIndex}
                    selectable
                    style={[
                      styles.tableCell,
                      { textAlign: table.align[cellIndex] ?? "left" },
                    ]}
                  >
                    {inlinePlain(cell.tokens) || cell.text}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        );
      }
      case "hr":
        return <View key={key} style={styles.hr} />;
      case "html": {
        const html = token as Tokens.HTML;
        // Raw HTML has no native equivalent; show the text it wraps, if any.
        const plain = html.text.replace(/<[^>]*>/g, "").trim();
        return plain ? (
          <Text key={key} style={[styles.blockText, styles.muted]}>
            {plain}
          </Text>
        ) : null;
      }
      default: {
        const raw = (token as { raw?: string }).raw;
        return raw ? (
          <Text key={key} selectable style={styles.blockText}>
            {raw}
          </Text>
        ) : null;
      }
    }
  });
}

export function MarkdownText({ text }: { text: string }) {
  const blocks = useMemo(() => renderBlocks(marked.lexer(text)), [text]);
  return (
    <View style={styles.root}>
      {blocks.length > 0 ? blocks : <Text style={styles.blockText}>{text}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  // Spacing lives between blocks, so a one-paragraph bubble has no stray
  // margin above or below its text.
  root: {
    gap: 8,
  },
  blockText: {
    fontSize: 16,
    lineHeight: 24,
    color: THEME.colors.text,
  },
  strong: {
    fontWeight: "600",
  },
  em: {
    fontStyle: "italic",
  },
  del: {
    textDecorationLine: "line-through",
  },
  muted: {
    color: THEME.colors.textSecondary,
  },
  link: {
    color: THEME.colors.accent,
    textDecorationLine: "underline",
  },
  codeSpan: {
    fontFamily: THEME.fonts.mono,
    fontSize: 14,
    color: THEME.colors.primaryLight,
    backgroundColor: "#f4f4f6",
  },
  heading: {
    fontWeight: "600",
    marginTop: 2,
  },
  h1: { fontSize: 19, lineHeight: 26 },
  h2: { fontSize: 17, lineHeight: 24 },
  h3: { fontSize: 16, lineHeight: 23 },
  codeBlock: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#f4f4f6",
  },
  codeLang: {
    marginBottom: 4,
    fontSize: 11,
    color: THEME.colors.textMuted,
  },
  codeText: {
    fontFamily: THEME.fonts.mono,
    fontSize: 13,
    lineHeight: 19,
    color: THEME.colors.primaryLight,
  },
  quote: {
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: "#ececef",
  },
  listItem: {
    flexDirection: "row",
    gap: 6,
  },
  listMarker: {
    minWidth: 14,
    fontSize: 16,
    lineHeight: 24,
    color: THEME.colors.textSecondary,
  },
  listBody: {
    flex: 1,
  },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
    borderRadius: 6,
    overflow: "hidden",
  },
  tableRow: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: THEME.colors.border,
  },
  tableHead: {
    borderTopWidth: 0,
    backgroundColor: "#f8f8f9",
  },
  tableCell: {
    flex: 1,
    paddingHorizontal: 6,
    paddingVertical: 5,
    fontSize: 13,
    lineHeight: 18,
    color: THEME.colors.text,
  },
  hr: {
    marginVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: THEME.colors.border,
  },
});
