// Host that mounts the preview Renderer declared by the active plugin.
//
// Phase 1 keeps the dispatch rule aligned with the pre-plugin behaviour: look
// at `content-store.active.pluginId` and ask the registry for the matching
// plugin. Any renderer props the host supplies (hideInlineCommentBar,
// onRequestFiles, onRequestAgent, active) are forwarded unchanged, so the
// existing EditorView / WebPreview components work without wrappers.
//
// If a plugin id in the store has no registered descriptor (e.g. the user
// upgraded while an old session was pinned to a removed plugin), we fall
// back to the document plugin — never crash — so the editor pane always
// shows something.

import { memo, type ComponentProps } from "react";
import { View, Text, StyleSheet } from "react-native";
import { EditorView } from "../editor/EditorView";
import { useContentStore } from "./content-store";
import { getPlugin } from "../plugins";
import type { PreviewRendererProps } from "../plugins";
import { ContentActivityBanner } from "./ContentActivityBanner";
import { useSessionStore } from "../stores/session-store";
import { PressableRow } from "../components/PressableRow";
import { Icon } from "../components/Icon";
import { THEME } from "../styles/theme";

type Props = ComponentProps<typeof EditorView>;

const DEFAULT_PLUGIN_ID = "markdown";

export const ContentPreview = memo(function ContentPreview(props: Props) {
  const activePluginId = useContentStore((state) => state.active.pluginId);
  const isStreaming = useSessionStore((state) => state.isStreaming);
  const plugin = getPlugin(activePluginId) ?? getPlugin(DEFAULT_PLUGIN_ID);
  const Renderer = (plugin?.kind === "preview" ? plugin.Renderer : EditorView) as React.ComponentType<PreviewRendererProps>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {props.onRequestFiles ? (
          <PressableRow
            style={styles.headerAction}
            pressedStyle={styles.headerActionPressed}
            onPressIn={props.onRequestFiles}
            hitSlop={8}
            accessibilityLabel="Open files"
            haptic="light"
          >
            <View style={styles.headerActionInner}>
              <Icon name="folder" size={20} color={THEME.colors.textSecondary} />
            </View>
          </PressableRow>
        ) : (
          <View style={styles.headerSide} />
        )}

        <View style={styles.headerCenter} pointerEvents="none">
          <Text style={styles.headerTitle} numberOfLines={1}>
            {plugin?.title ?? "Document"}
          </Text>
        </View>

        {props.onRequestAgent ? (
          <PressableRow
            style={styles.headerAction}
            pressedStyle={styles.headerActionPressed}
            onPressIn={props.onRequestAgent}
            hitSlop={8}
            accessibilityLabel="Open agent chat"
            haptic="light"
          >
            <View style={styles.headerActionInner}>
              <Icon name="chat" size={20} color={THEME.colors.textSecondary} />
              {isStreaming ? <View style={styles.agentDot} /> : null}
            </View>
          </PressableRow>
        ) : (
          <View style={styles.headerSide} />
        )}
      </View>

      <ContentActivityBanner onPress={props.onRequestAgent} />

      <View style={styles.renderer}>
        <Renderer
          onRequestFiles={props.onRequestFiles}
          onRequestAgent={props.onRequestAgent}
          hideInlineCommentBar={props.hideInlineCommentBar}
          active={props.active}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minWidth: 0,
    backgroundColor: THEME.colors.background,
  },
  header: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f0f0f2",
    zIndex: 30,
  },
  headerSide: {
    width: 48,
    height: 48,
  },
  headerAction: {
    width: 40,
    height: 40,
    marginHorizontal: THEME.spacing.xs,
    borderRadius: THEME.radii.md,
    overflow: "hidden",
  },
  headerActionPressed: {
    backgroundColor: "rgba(15, 23, 42, 0.05)",
  },
  headerActionInner: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    maxWidth: "100%",
    paddingHorizontal: THEME.spacing.sm,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.1,
    textTransform: "uppercase",
    color: THEME.colors.textMuted,
  },
  agentDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: THEME.colors.success,
    borderWidth: 1,
    borderColor: THEME.colors.background,
  },
  renderer: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
});
