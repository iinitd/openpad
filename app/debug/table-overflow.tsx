import { useEffect } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { ContentPreview } from "../../src/content/ContentPreview";
import { useEditorStore } from "../../src/stores/editor-store";
import { useContentStore } from "../../src/content/content-store";
import { markdownToHtml } from "../../src/editor/file-content";
import { THEME } from "../../src/styles/theme";

const SAMPLE_MARKDOWN = `
# Table Overflow Repro

This screen exists only to debug table overflow behavior in the web preview.

| Name | Description | API Response | Notes | Owner | Link |
| --- | --- | --- | --- | --- | --- |
| Foundation | Extremely verbose markdown table cell that should make the table wider than the prose column if local horizontal scrolling is working correctly | {"status":"ok","message":"this-is-a-deliberately-wide-value-to-force-horizontal-overflow-inside-the-table-wrapper-only","request_id":"req_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"} | This row is intentionally wide to reproduce the layout bug without relying on workspace state | Writer Team | https://example.com/some/really/long/path/that/should/not/create/global/page/overflow/but/should/be-contained/by/the/table/wrapper |
| Safety | Another long cell with multiple wide chunks mixed together to make column sizing realistic instead of synthetic nonsense | token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | The goal is to keep the page width stable while the table itself scrolls horizontally | Platform | https://example.com/another/very/long/link/for/testing/table/overflow/behavior/in/the/editor |
| Runtime | This repro exercises the shared HTML renderer path used by ordinary Markdown and Feishu working-copy previews | payload_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb | If the page still gets a horizontal scrollbar, the overflow is escaping the intended local table scroller | Runtime | https://example.com/runtime/overflow/check |
`;

export default function TableOverflowDebugScreen() {
  useEffect(() => {
    const html = markdownToHtml(SAMPLE_MARKDOWN);
    useEditorStore
      .getState()
      .openDocument("__debug__/table-overflow.md", "Table Overflow Debug", html, true);
    useContentStore.getState().openFile("__debug__/table-overflow.md");
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Table Overflow Debug</Text>
        <Text style={styles.subtitle}>Use this route to inspect whether a wide markdown table causes page-level overflow or only local table scrolling in the shared HTML renderer.</Text>
      </View>
      <View style={styles.previewPane}>
        <ContentPreview hideInlineCommentBar />
      </View>
      <ScrollView style={styles.notes}>
        <Text style={styles.notesTitle}>Expected</Text>
        <Text style={styles.notesBody}>The page itself should not gain a horizontal scrollbar. Only the table region inside the document should scroll horizontally.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  header: {
    paddingHorizontal: THEME.spacing.lg,
    paddingTop: THEME.spacing.lg,
    paddingBottom: THEME.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
    gap: THEME.spacing.xs,
  },
  title: {
    fontSize: 19,
    fontWeight: "700",
    color: THEME.colors.text,
  },
  subtitle: {
    fontSize: 15,
    color: THEME.colors.textSecondary,
  },
  previewPane: {
    flex: 1,
    minWidth: 0,
  },
  notes: {
    maxHeight: 88,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
    paddingHorizontal: THEME.spacing.lg,
  },
  notesTitle: {
    marginTop: THEME.spacing.md,
    fontSize: 13,
    fontWeight: "700",
    color: THEME.colors.text,
  },
  notesBody: {
    marginTop: THEME.spacing.xs,
    marginBottom: THEME.spacing.md,
    fontSize: 13,
    color: THEME.colors.textSecondary,
  },
});
