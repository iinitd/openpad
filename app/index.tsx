import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useConnectionStore } from "../src/stores/connection-store";
import { useWriterOpeningStore } from "../src/stores/writer-opening-store";
import { ConnectingView } from "../src/components/ConnectingView";
import { BackendConnections } from "../src/components/BackendConnections";
import { THEME } from "../src/styles/theme";
import { beginStartupTrace, measureStartupTrace, noteStartupTrace } from "../src/utils/startup-trace";
import { useShallow } from "zustand/react/shallow";

export default function ConnectScreen() {
  const router = useRouter();
  const { add } = useLocalSearchParams<{ add?: string }>();
  const addMode = add === "1";
  const addModeRef = useRef(addMode);
  addModeRef.current = addMode;
  const {
    mode,
    daemonUrl,
    password,
    pairingLink,
    gatewayUrl,
    gatewayToken,
    opencodeUrl,
    opencodeUsername,
    opencodePassword,
    opencodePairLink,
    setMode,
    setDaemonUrl,
    setPassword,
    setPairingLink,
    setGatewayUrl,
    setGatewayToken,
    setOpenCodeUrl,
    setOpenCodeUsername,
    setOpenCodePassword,
    setOpenCodePairLink,
    connect,
    restoreConnections,
    client,
    connections,
    savedConnections,
    hasHydrated,
  } = useConnectionStore(useShallow((state) => ({
    mode: state.mode,
    daemonUrl: state.daemonUrl,
    password: state.password,
    pairingLink: state.pairingLink,
    gatewayUrl: state.gatewayUrl,
    gatewayToken: state.gatewayToken,
    opencodeUrl: state.opencodeUrl,
    opencodeUsername: state.opencodeUsername,
    opencodePassword: state.opencodePassword,
    opencodePairLink: state.opencodePairLink,
    setMode: state.setMode,
    setDaemonUrl: state.setDaemonUrl,
    setPassword: state.setPassword,
    setPairingLink: state.setPairingLink,
    setGatewayUrl: state.setGatewayUrl,
    setGatewayToken: state.setGatewayToken,
    setOpenCodeUrl: state.setOpenCodeUrl,
    setOpenCodeUsername: state.setOpenCodeUsername,
    setOpenCodePassword: state.setOpenCodePassword,
    setOpenCodePairLink: state.setOpenCodePairLink,
    connect: state.connect,
    restoreConnections: state.restoreConnections,
    client: state.client,
    connections: state.connections,
    savedConnections: state.savedConnections,
    hasHydrated: state.hasHydrated,
  })));

  const [connecting, setConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoConnecting, setAutoConnecting] = useState(false);
  const [autoFailed, setAutoFailed] = useState(false);
  const connectPending = useRef(false);
  const screenMounted = useRef(true);
  const isBusy = connecting;
  const addingConnection = addMode || connections.length > 0;

  // A bare host:port defaults to http://, so both spellings mean plaintext.
  const openCodePlaintext = (() => {
    const target = opencodePairLink.trim() || opencodeUrl.trim();
    if (!target) return false;
    return !/^https:\/\//i.test(target);
  })();

  useEffect(() => {
    screenMounted.current = true;
    return () => { screenMounted.current = false; };
  }, []);

  async function handleConnect() {
    if (connectPending.current) return;
    connectPending.current = true;
    setConnecting(true);
    setErrorMessage(null);
    try {
      await connect();
      if (screenMounted.current) {
        void useWriterOpeningStore.getState().open();
        router.replace("/writer/session");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not connect to writing backend";
      // Alert.alert is a no-op on react-native-web, so surface errors inline
      // (and still use the native dialog on iOS/Android).
      setErrorMessage(message);
      if (Platform.OS !== "web") {
        Alert.alert("Connection Failed", message);
      }
    } finally {
      connectPending.current = false;
      setConnecting(false);
    }
  }

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
            <BackendConnections disabled={isBusy} showActiveOpen />
          </View>
        ) : null}

        {/* Mode tabs */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, mode === "direct" && styles.tabActive]}
            onPress={() => setMode("direct")}
            disabled={isBusy}
          >
            <Text style={[styles.tabText, mode === "direct" && styles.tabTextActive]}>
              Direct
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, mode === "relay" && styles.tabActive]}
            onPress={() => setMode("relay")}
            disabled={isBusy}
          >
            <Text style={[styles.tabText, mode === "relay" && styles.tabTextActive]}>
              Relay
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, mode === "openclaw" && styles.tabActive]}
            onPress={() => setMode("openclaw")}
            disabled={isBusy}
          >
            <Text style={[styles.tabText, mode === "openclaw" && styles.tabTextActive]}>
              OpenClaw
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, mode === "opencode" && styles.tabActive]}
            onPress={() => setMode("opencode")}
            disabled={isBusy}
          >
            <Text style={[styles.tabText, mode === "opencode" && styles.tabTextActive]}>
              OpenCode
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.form}>
          {mode === "direct" ? (
            <>
              <Text style={styles.label}>Daemon URL</Text>
              <TextInput
                style={styles.input}
                value={daemonUrl}
                onChangeText={setDaemonUrl}
                editable={!isBusy}
                placeholder="ws://localhost:6767/ws"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />

              <Text style={styles.label}>Password (optional)</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                editable={!isBusy}
                placeholder="Leave empty if no password"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          ) : mode === "relay" ? (
            <>
              <Text style={styles.label}>Pairing Link</Text>
              <TextInput
                style={[styles.input, styles.pairingInput]}
                value={pairingLink}
                onChangeText={setPairingLink}
                editable={!isBusy}
                placeholder="https://app.paseo.sh/#offer=..."
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                multiline
              />
              <Text style={styles.hint}>
                Get this from the Paseo app → Settings → Pair new device
              </Text>
            </>
          ) : mode === "openclaw" ? (
            <>
              <Text style={styles.label}>Gateway URL</Text>
              <TextInput
                style={styles.input}
                value={gatewayUrl}
                onChangeText={setGatewayUrl}
                editable={!isBusy}
                placeholder="ws://localhost:18789"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />

              <Text style={styles.label}>Gateway token (optional)</Text>
              <TextInput
                style={styles.input}
                value={gatewayToken}
                onChangeText={setGatewayToken}
                editable={!isBusy}
                placeholder="Enter token if required"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.hint}>
                If pairing is requested, approve this device through OpenClaw and reconnect.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.label}>Pair link (optional)</Text>
              <TextInput
                style={styles.input}
                value={opencodePairLink}
                onChangeText={setOpenCodePairLink}
                editable={!isBusy}
                placeholder="https://host/auth/connect/..."
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <Text style={styles.hint}>
                Paste a one-time OpenCode pair link. OpenPad exchanges it for a session token, then saves the server URL and token; the link itself is not stored.
              </Text>

              <Text style={styles.label}>Server URL</Text>
              <TextInput
                style={styles.input}
                value={opencodeUrl}
                onChangeText={setOpenCodeUrl}
                editable={!isBusy}
                placeholder="http://localhost:4096"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />

              {openCodePlaintext ? (
                <Text style={[styles.hint, styles.warningHint]}>
                  This connection is not encrypted. HTTP sends the server password and session token in the clear, so anyone on the same network can read them. Prefer HTTPS, or a private network such as Tailscale.
                </Text>
              ) : null}

              <Text style={styles.label}>Username (optional)</Text>
              <TextInput
                style={styles.input}
                value={opencodeUsername}
                onChangeText={setOpenCodeUsername}
                editable={!isBusy}
                placeholder="opencode"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.label}>Server password (optional)</Text>
              <TextInput
                style={styles.input}
                value={opencodePassword}
                onChangeText={setOpenCodePassword}
                editable={!isBusy}
                placeholder="OPENCODE_SERVER_PASSWORD"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.hint}>
                Run `opencode serve`, then use the printed server password. For the web app, allow this page's origin with `--cors`.
              </Text>
            </>
          )}

          <TouchableOpacity
            style={[styles.button, isBusy && styles.buttonDisabled]}
            onPress={handleConnect}
            disabled={isBusy}
          >
            {isBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {addingConnection ? "Add connection" : "Connect"}
              </Text>
            )}
          </TouchableOpacity>

          {errorMessage && (
            <Text style={styles.error}>{errorMessage}</Text>
          )}
        </View>
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
    fontSize: 32,
    fontWeight: "700",
    color: THEME.colors.text,
    marginBottom: THEME.spacing.xs,
  },
  subtitle: {
    fontSize: 16,
    color: THEME.colors.textSecondary,
    marginBottom: THEME.spacing.xxl,
  },
  connections: {
    gap: THEME.spacing.md,
    marginBottom: THEME.spacing.xl,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: THEME.colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: THEME.colors.backgroundSecondary,
    borderRadius: THEME.radii.md,
    marginBottom: THEME.spacing.lg,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: THEME.spacing.sm,
    alignItems: "center",
    borderRadius: THEME.radii.sm,
  },
  tabActive: {
    backgroundColor: THEME.colors.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: THEME.colors.textSecondary,
  },
  tabTextActive: {
    color: "#fff",
  },
  form: {
    gap: THEME.spacing.md,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: THEME.colors.textSecondary,
    marginBottom: -THEME.spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: THEME.radii.md,
    paddingHorizontal: THEME.spacing.lg,
    paddingVertical: THEME.spacing.md,
    fontSize: 16,
    color: THEME.colors.text,
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  pairingInput: {
    minHeight: 80,
    textAlignVertical: "top",
    paddingTop: THEME.spacing.md,
  },
  hint: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    marginTop: -THEME.spacing.xs,
  },
  warningHint: {
    color: THEME.colors.warning,
  },
  button: {
    backgroundColor: THEME.colors.primary,
    borderRadius: THEME.radii.md,
    paddingVertical: THEME.spacing.md,
    alignItems: "center",
    marginTop: THEME.spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  error: {
    color: THEME.colors.error,
    fontSize: 14,
    marginTop: THEME.spacing.xs,
    textAlign: "center",
  },
});
