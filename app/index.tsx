import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useConnectionStore } from "../src/stores/connection-store";
import { useWriterOpeningStore } from "../src/stores/writer-opening-store";
import { ConnectingView } from "../src/components/ConnectingView";
import { BackendConnections } from "../src/components/BackendConnections";
import { ConnectionForm } from "../src/settings/ConnectionForm";
import { THEME } from "../src/styles/theme";
import { beginStartupTrace, measureStartupTrace, noteStartupTrace } from "../src/utils/startup-trace";
import { useShallow } from "zustand/react/shallow";

export default function ConnectScreen() {
  const router = useRouter();
  const { add } = useLocalSearchParams<{ add?: string }>();
  const addMode = add === "1";
  const addModeRef = useRef(addMode);
  addModeRef.current = addMode;
  const { restoreConnections, client, connections, savedConnections, hasHydrated } =
    useConnectionStore(
      useShallow((state) => ({
        restoreConnections: state.restoreConnections,
        client: state.client,
        connections: state.connections,
        savedConnections: state.savedConnections,
        hasHydrated: state.hasHydrated,
      })),
    );

  const [autoConnecting, setAutoConnecting] = useState(false);
  const [autoFailed, setAutoFailed] = useState(false);
  const screenMounted = useRef(true);
  const addingConnection = addMode || connections.length > 0;

  useEffect(() => {
    screenMounted.current = true;
    return () => { screenMounted.current = false; };
  }, []);


  // Restore every saved auto-connect profile once on launch. Adding another
  // backend keeps the form available while existing transports reconnect.
  const autoTried = useRef(false);
  useEffect(() => {
    if (!hasHydrated || addMode || autoTried.current) return;
    autoTried.current = true;
    const store = useConnectionStore.getState();
    if (store.client || !store.savedConnections.some((connection) => connection.autoConnect)) return;

    beginStartupTrace("auto-reconnect");
    noteStartupTrace("connect-screen hydrated", { savedConnections: store.savedConnections.length });
    setAutoConnecting(true);
    measureStartupTrace("connect.auto", () => restoreConnections(), { savedConnections: store.savedConnections.length })
      .then(() => {
        if (!screenMounted.current || addModeRef.current) return;
        if (useConnectionStore.getState().client) {
          void useWriterOpeningStore.getState().open();
          router.replace("/writer/session");
        } else setAutoFailed(true);
      })
      .catch(() => {
        if (screenMounted.current) setAutoFailed(true);
      })
      .finally(() => {
        if (screenMounted.current) setAutoConnecting(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, addMode]);

  // Keep the launch spinner up until we've either (a) decided there's nothing
  // to auto-reconnect, or (b) finished the auto-reconnect attempt. This
  // prevents the connect form from flashing between hydration and the effect
  // firing, which was making every Dev Client reload look like it dropped us
  // back on the login screen.
  const expectAutoReconnect =
    !addMode && hasHydrated && !client && !autoFailed && !autoTried.current &&
    savedConnections.some((connection) => connection.autoConnect);
  const showLaunchSpinner = !addMode && (!hasHydrated || autoConnecting || expectAutoReconnect);

  if (showLaunchSpinner) {
    return <ConnectingView title="Connecting…" subtitle="Reconnecting to saved backends" />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{addMode ? "Add connection" : "OpenPad"}</Text>
        <Text style={styles.subtitle}>{addingConnection ? "Connect another writing backend" : "Connect to your writing backend"}</Text>

        {connections.length > 0 || savedConnections.length > 0 ? (
          <View style={styles.connections}>
            <Text style={styles.sectionLabel}>Your connections</Text>
            <BackendConnections showActiveOpen />
          </View>
        ) : null}

        <ConnectionForm onConnected={() => router.replace("/writer/session")} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: THEME.spacing.xl,
    paddingVertical: THEME.spacing.xxl,
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    color: THEME.colors.text,
    marginBottom: THEME.spacing.xs,
  },
  subtitle: {
    fontSize: 18,
    color: THEME.colors.textSecondary,
    marginBottom: THEME.spacing.xxl,
  },
  connections: {
    gap: THEME.spacing.md,
    marginBottom: THEME.spacing.xl,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: THEME.colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
