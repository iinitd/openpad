import { useMemo, type ReactNode } from "react";
import {
  ActionSheetIOS,
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { marked, type Token, type Tokens } from "marked";
import { THEME } from "../styles/theme";

/**
 * Renders an assistant reply as markdown inside a chat bubble. Agents answer in
 * headings, lists, tables and fenced code; a plain Text block flattens all of
 * that into one grey paragraph.
 *
 * `marked` only tokenises here — every block is drawn with React Native views,
 * because a WebView per bubble would be far too heavy for a scrolling
 * transcript.
 *
 * Selection is the platform's weak spot: iOS `<Text selectable>` copies a whole
 * block with no highlight or handles, and a selectable node holding styled runs
 * draws nothing at all on iOS 26. So a long press on any block offers the two
 * granularities people actually want — this block, or the whole reply — and
 * copies plain text.
 */

type CopyHandler = (blockText: string) => void;

function copyToClipboard(value: string) {
  if (!value) return;
  void Clipboard.setStringAsync(value);
  if (Platform.OS !== "web") {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

function openCopyMenu(blockText: string, replyText: string) {
  const copy = (value: string) => copyToClipboard(value);
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ["Copy this block", "Copy whole reply", "Cancel"], cancelButtonIndex: 2 },
      (index) => {
        if (index === 0) copy(blockText);
        else if (index === 1) copy(replyText);
      },
    );
    return;
  }
  if (Platform.OS === "web") {
    copy(blockText);
    return;
  }
  Alert.alert("Copy", undefined, [
    { text: "This block", onPress: () => copy(blockText) },
    { text: "Whole reply", onPress: () => copy(replyText) },
    { text: "Cancel", style: "cancel" },
  ]);
}

function renderInline(tokens: Token[] | undefined, depth = 0): ReactNode[] {
  if (!tokens || depth > 8) return [];
  return tokens.map((token, index) => {
    const key = `${token.type}-${index}`;
    switch (token.type) {
      case "text": {
        const text = token as Tokens.Text;
        // Plain runs stay strings: fewer nested Text nodes, which keeps the
        // transcript cheap to lay out.
        return text.tokens ? renderInline(text.tokens, depth + 1) : text.text;
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

function inlinePlain(tokens: Token[] | undefined): string {
  if (!tokens) return "";
  return tokens
    .map((token) => {
      if (token.type === "text") {
        const text = token as Tokens.Text;
        return text.tokens ? inlinePlain(text.tokens) : text.text;
      }
      if (token.type === "br") return "\n";
      const value = (token as { text?: string }).text;
      return value ?? (token as { raw?: string }).raw ?? "";
    })
    .join("");
}

/** The text a reader would get if they copied this block. */
function blockPlain(token: Token): string {
  switch (token.type) {
    case "space":
      return "";
    case "heading":
    case "paragraph":
    case "text": {
      const block = token as Tokens.Paragraph;
      return inlinePlain(block.tokens) || block.text || "";
    }
    case "code":
      return (token as Tokens.Code).text;
    case "blockquote":
      return (token as Tokens.Blockquote).tokens
        .map(blockPlain)
        .filter(Boolean)
        .join("\n\n");
    case "list": {
      const list = token as Tokens.List;
      return list.items
        .map((item, index) => {
          const marker = item.task
            ? item.checked
              ? "[x]"
              : "[ ]"
            : list.ordered
              ? `${(list.start || 1) + index}.`
              : "-";
          return `${marker} ${item.tokens.map(blockPlain).filter(Boolean).join("\n")}`;
        })
        .join("\n");
    }
    case "table": {
      const table = token as Tokens.Table;
      const row = (cells: Tokens.TableCell[]) =>
        cells.map((cell) => inlinePlain(cell.tokens) || cell.text).join(" | ");
      return [row(table.header), ...table.rows.map(row)].join("\n");
    }
    case "hr":
      return "---";
    case "html":
      return (token as Tokens.HTML).text.replace(/<[^>]*>/g, "").trim();
    default:
      return ((token as { raw?: string }).raw ?? "").trim();
  }
}

function BlockText({
  tokens,
  fallback,
  style,
  onLongPress,
}: {
  tokens?: Token[];
  fallback?: string;
  style: StyleProp<TextStyle>;
  onLongPress?: () => void;
}) {
  const nodes = renderInline(tokens);
  const content = nodes.length > 0 ? nodes : fallback ? [fallback] : [];
  return (
    <Text style={style} onLongPress={onLongPress}>
      {content.length > 0 ? content : undefined}
    </Text>
  );
}

function renderBlocks(tokens: Token[], onCopy: CopyHandler): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${token.type}-${index}`;
    const copy = () => onCopy(blockPlain(token));
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
          <BlockText
            key={key}
            tokens={heading.tokens}
            fallback={heading.text}
            style={[styles.blockText, size, styles.heading]}
            onLongPress={copy}
          />
        );
      }
      case "paragraph": {
        const paragraph = token as Tokens.Paragraph;
        return (
          <BlockText
            key={key}
            tokens={paragraph.tokens}
            fallback={paragraph.text}
            style={styles.blockText}
            onLongPress={copy}
          />
        );
      }
      case "text": {
        const text = token as Tokens.Text;
        return (
          <BlockText
            key={key}
            tokens={text.tokens}
            fallback={text.text}
            style={styles.blockText}
            onLongPress={copy}
          />
        );
      }
      case "code": {
        const code = token as Tokens.Code;
        return (
          <Pressable key={key} onLongPress={copy} delayLongPress={300} style={styles.codeBlock}>
            {code.lang ? <Text style={styles.codeLang}>{code.lang}</Text> : null}
            <Text style={styles.codeText}>{code.text}</Text>
          </Pressable>
        );
      }
      case "blockquote": {
        const quote = token as Tokens.Blockquote;
        return (
          <View key={key} style={styles.quote}>
            {renderBlocks(quote.tokens, onCopy)}
          </View>
        );
      }
      case "list": {
        const list = token as Tokens.List;
        return (
          <View key={key}>
            {list.items.map((item, itemIndex) => (
              <Pressable
                key={itemIndex}
                onLongPress={copy}
                delayLongPress={300}
                style={styles.listItem}
              >
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
                    <BlockText
                      tokens={(item.tokens[0] as Tokens.Text | Tokens.Paragraph).tokens}
                      fallback={(item.tokens[0] as Tokens.Text | Tokens.Paragraph).text}
                      style={styles.blockText}
                      onLongPress={copy}
                    />
                  ) : null}
                  {renderBlocks(
                    item.tokens.filter(
                      (entry) => entry.type !== "text" && entry.type !== "paragraph",
                    ),
                    onCopy,
                  )}
                </View>
              </Pressable>
            ))}
          </View>
        );
      }
      case "table": {
        const table = token as Tokens.Table;
        return (
          <Pressable key={key} onLongPress={copy} delayLongPress={300} style={styles.table}>
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
          </Pressable>
        );
      }
      case "hr":
        return <View key={key} style={styles.hr} />;
      case "html": {
        const html = token as Tokens.HTML;
        // Raw HTML has no native equivalent; show the text it wraps, if any.
        const plain = html.text.replace(/<[^>]*>/g, "").trim();
        return plain ? (
          <BlockText
            key={key}
            fallback={plain}
            style={[styles.blockText, styles.muted]}
            onLongPress={copy}
          />
        ) : null;
      }
      default: {
        const raw = (token as { raw?: string }).raw;
        return raw ? (
          <BlockText
            key={key}
            fallback={raw}
            style={styles.blockText}
            onLongPress={copy}
          />
        ) : null;
      }
    }
  });
}

export function MarkdownText({ text }: { text: string }) {
  const { tokens, plain, blocks } = useMemo(() => {
    const lexed = marked.lexer(text);
    const reply = lexed
      .map(blockPlain)
      .filter(Boolean)
      .join("\n\n");
    const onCopy: CopyHandler = (blockText) => openCopyMenu(blockText, reply);
    return { tokens: lexed, plain: reply, blocks: renderBlocks(lexed, onCopy) };
  }, [text]);
  return (
    <View style={styles.root}>
      {blocks.length > 0 ? (
        blocks
      ) : (
        <Text style={styles.blockText} onLongPress={() => openCopyMenu(plain, plain)}>
          {text}
        </Text>
      )}
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
