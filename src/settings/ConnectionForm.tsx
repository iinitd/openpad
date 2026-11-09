import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useShallow } from "zustand/react/shallow";
import { useConnectionStore } from "../stores/connection-store";
import { useWriterOpeningStore } from "../stores/writer-opening-store";
import { THEME } from "../styles/theme";
import { hapticTap } from "../components/PressableRow";

/**
 * The connection form itself: mode tabs, the fields for the chosen mode, and
 * the connect action. It is shared by the launch screen and the in-sheet
 * "Add connection" page, so both stay in step.
 */
export function ConnectionForm({
  onConnected,
}: {
  /** Called after a successful connect, before the app switches sessions. */
  onConnected?: () => void;
}) {
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
    connections,
    savedConnections,
  } = useConnectionStore(
    useShallow((state) => ({
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
      connections: state.connections,
      savedConnections: state.savedConnections,
    })),
  );

  const [connecting, setConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const connectPending = useRef(false);
  const isBusy = connecting;
  const addingConnection = connections.length > 0 || savedConnections.length > 0;

  // A bare host:port defaults to http://, so both spellings mean plaintext.
  const openCodePlaintext = (() => {
    const target = opencodePairLink.trim() || opencodeUrl.trim();
    if (!target) return false;
    return !/^https:\/\//i.test(target);
  })();

  async function handleConnect() {
    if (connectPending.current) return;
    connectPending.current = true;
    setConnecting(true);
    setErrorMessage(null);
    try {
      await connect();
      void useWriterOpeningStore.getState().open();
      onConnected?.();
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

  return (
    <View style={styles.form}>
      <View style={styles.tabs}>
        {(
          [
            ["direct", "Direct"],
            ["relay", "Relay"],
            ["openclaw", "OpenClaw"],
            ["opencode", "OpenCode"],
          ] as const
        ).map(([value, label]) => (
          <TouchableOpacity
            key={value}
            style={[styles.tab, mode === value && styles.tabActive]}
            onPress={() => {
              hapticTap("selection");
              setMode(value);
            }}
            disabled={isBusy}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, mode === value && styles.tabTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

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
            Paste a one-time OpenCode pair link. OpenPad exchanges it for a session
            token, then saves the server URL and token; the link itself is not stored.
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
              This connection is not encrypted. HTTP sends the server password and
              session token in the clear, so anyone on the same network can read them.
              Prefer HTTPS, or a private network such as Tailscale.
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
            Run `opencode serve`, then use the printed server password. For the web app,
            allow this page's origin with `--cors`.
          </Text>
        </>
      )}

      <TouchableOpacity
        style={[styles.button, isBusy && styles.buttonDisabled]}
        onPress={() => {
          hapticTap("medium");
          void handleConnect();
        }}
        disabled={isBusy}
        activeOpacity={0.85}
      >
        {isBusy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {addingConnection ? "Add connection" : "Connect"}
          </Text>
        )}
      </TouchableOpacity>

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: THEME.spacing.md,
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
    fontSize: 16,
    fontWeight: "600",
    color: THEME.colors.textSecondary,
  },
  tabTextActive: {
    color: "#fff",
  },
  label: {
    fontSize: 16,
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
    fontSize: 18,
    color: THEME.colors.text,
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  pairingInput: {
    minHeight: 80,
    textAlignVertical: "top",
    paddingTop: THEME.spacing.md,
  },
  hint: {
    fontSize: 15,
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
    fontSize: 18,
    fontWeight: "600",
  },
  error: {
    color: THEME.colors.error,
    fontSize: 16,
    marginTop: THEME.spacing.xs,
    textAlign: "center",
  },
});
