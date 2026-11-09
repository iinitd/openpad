import { useEffect, useRef, useState } from "react";
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
    opencodeUrl,
    opencodeUsername,
    opencodePassword,
    opencodePairLink,
    setMode,
    setDaemonUrl,
    setPassword,
    setPairingLink,
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
      opencodeUrl: state.opencodeUrl,
      opencodeUsername: state.opencodeUsername,
      opencodePassword: state.opencodePassword,
      opencodePairLink: state.opencodePairLink,
      setMode: state.setMode,
      setDaemonUrl: state.setDaemonUrl,
      setPassword: state.setPassword,
      setPairingLink: state.setPairingLink,
      setOpenCodeUrl: state.setOpenCodeUrl,
      setOpenCodeUsername: state.setOpenCodeUsername,
      setOpenCodePassword: state.setOpenCodePassword,
      setOpenCodePairLink: state.setOpenCodePairLink,
      connect: state.connect,
      connections: state.connections,
      savedConnections: state.savedConnections,
    })),
  );

  // OpenClaw is hidden for now; a stored selection falls back to Paseo direct.
  useEffect(() => {
    if (mode === "openclaw") setMode("direct");
  }, [mode, setMode]);

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
            ["paseo", "Paseo"],
            ["opencode", "OpenCode"],
          ] as const
        ).map(([value, label]) => {
          const active = value === "opencode" ? mode === "opencode" : mode !== "opencode";
          return (
            <TouchableOpacity
              key={value}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => {
                if (active) return;
                hapticTap("selection");
                // Keep the chosen Paseo transport when re-entering the tab.
                setMode(value === "opencode" ? "opencode" : "direct");
              }}
              disabled={isBusy}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {mode !== "opencode" ? (
        <View style={styles.subTabs}>
          <TouchableOpacity
            style={[styles.subTab, mode !== "relay" && styles.subTabActive]}
            onPress={() => {
              hapticTap("selection");
              setMode("direct");
            }}
            disabled={isBusy}
            activeOpacity={0.8}
          >
            <Text
              style={[styles.subTabText, mode !== "relay" && styles.subTabTextActive]}
            >
              Direct
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.subTab, mode === "relay" && styles.subTabActive]}
            onPress={() => {
              hapticTap("selection");
              setMode("relay");
            }}
            disabled={isBusy}
            activeOpacity={0.8}
          >
            <Text
              style={[styles.subTabText, mode === "relay" && styles.subTabTextActive]}
            >
              Relay
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

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
    gap: 2,
    backgroundColor: THEME.colors.surface,
    borderRadius: 9,
    marginBottom: THEME.spacing.md,
    padding: 2,
  },
  tab: {
    flex: 1,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
  },
  tabActive: {
    backgroundColor: THEME.colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
  },
  tabText: {
    fontSize: 12,
    fontWeight: "600",
    color: THEME.colors.textSecondary,
  },
  tabTextActive: {
    color: THEME.colors.text,
  },
  subTabs: {
    flexDirection: "row",
    gap: 14,
    marginBottom: THEME.spacing.xs,
  },
  subTab: {
    paddingVertical: 4,
  },
  subTabActive: {
    borderBottomWidth: 1.5,
    borderBottomColor: THEME.colors.text,
  },
  subTabText: {
    fontSize: 13,
    fontWeight: "500",
    color: THEME.colors.textMuted,
  },
  subTabTextActive: {
    color: THEME.colors.text,
  },
  label: {
    fontSize: 13,
    fontWeight: "500",
    color: THEME.colors.textSecondary,
    marginBottom: -THEME.spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: THEME.radii.lg,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: 11,
    fontSize: 15,
    color: THEME.colors.text,
    backgroundColor: THEME.colors.background,
  },
  pairingInput: {
    minHeight: 80,
    textAlignVertical: "top",
    paddingTop: THEME.spacing.md,
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
    color: THEME.colors.textMuted,
    marginTop: -THEME.spacing.xs,
  },
  warningHint: {
    color: THEME.colors.warning,
  },
  button: {
    height: 46,
    backgroundColor: THEME.colors.primary,
    borderRadius: THEME.radii.lg,
    alignItems: "center",
    justifyContent: "center",
    marginTop: THEME.spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  error: {
    color: THEME.colors.error,
    fontSize: 13,
    lineHeight: 18,
    marginTop: THEME.spacing.xs,
  },
});
