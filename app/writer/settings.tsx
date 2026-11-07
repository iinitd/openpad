import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { SettingsPane } from "../../src/settings/SettingsPane";
import { Icon } from "../../src/components/Icon";
import { THEME } from "../../src/styles/theme";

// Dedicated Settings screen. The FileTree sidebar footer and the desktop file
// pane gear both route here with `router.push("/writer/settings")`. The screen
// hosts a top bar with a back affordance and the shared connection settings.
export default function WriterSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/writer/session");
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          hitSlop={8}
          accessibilityLabel="Back"
          style={styles.backBtn}
        >
          <Text style={styles.backGlyph}>‹</Text>
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Icon name="settings" size={16} color={THEME.colors.textSecondary} />
          <Text style={styles.title}>Settings</Text>
        </View>
        <View style={styles.backBtn} />
      </View>
      <View style={[styles.body, { paddingBottom: insets.bottom }]}>
        <SettingsPane />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  header: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: THEME.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.colors.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  backGlyph: {
    fontSize: 30,
    lineHeight: 28,
    color: THEME.colors.text,
    marginTop: -2,
  },
  titleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: THEME.spacing.sm,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    color: THEME.colors.text,
  },
  body: {
    flex: 1,
  },
});
