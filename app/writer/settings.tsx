import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SettingsPane } from "../../src/settings/SettingsPane";
import { ConnectionForm } from "../../src/settings/ConnectionForm";
import { Icon } from "../../src/components/Icon";
import { THEME } from "../../src/styles/theme";

// Dedicated Settings screen. The FileTree sidebar footer and the desktop file
// pane gear both route here with `router.push("/writer/settings")`. It hosts the
// same app settings as the workspace sheet's Settings tab, plus the full-page
// connection form so desktop has one entry for both.
export default function WriterSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // The empty projects list sends people straight to the form with ?add=1, so
  // its "Add connection" button lands on the fields rather than this list.
  const { add } = useLocalSearchParams<{ add?: string }>();
  const [addingConnection, setAddingConnection] = useState(add === "1");

  function goBack() {
    if (addingConnection) {
      setAddingConnection(false);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/writer/session");
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          hitSlop={8}
          accessibilityLabel={addingConnection ? "Back to settings" : "Back"}
          style={styles.backBtn}
        >
          <Text style={styles.backGlyph}>‹</Text>
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          {addingConnection ? null : (
            <Icon name="settings" size={16} color={THEME.colors.textSecondary} />
          )}
          <Text style={styles.title}>{addingConnection ? "Add connection" : "Settings"}</Text>
        </View>
        <View style={styles.backBtn} />
      </View>
      <View style={[styles.body, { paddingBottom: insets.bottom }]}>
        {addingConnection ? (
          <ScrollView
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            <ConnectionForm
              onConnected={() => {
                setAddingConnection(false);
                router.replace("/writer/session");
              }}
            />
          </ScrollView>
        ) : (
          <SettingsPane onAddConnection={() => setAddingConnection(true)} />
        )}
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
  formContent: {
    flexGrow: 1,
    paddingHorizontal: THEME.spacing.lg,
    paddingTop: THEME.spacing.lg,
    paddingBottom: THEME.spacing.xxl,
    backgroundColor: THEME.colors.backgroundSecondary,
  },
});
