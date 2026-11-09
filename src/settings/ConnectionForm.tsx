import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { Icon } from "../components/Icon";
import { THEME } from "../styles/theme";
import { hapticTap } from "../components/PressableRow";

type Transport =
  | "paseo-direct"
  | "paseo-relay"
  | "opencode-direct"
  | "opencode-pair";

const TRANSPORT_TITLES: Record<Transport, string> = {
  "paseo-direct": "Paseo · Direct",
  "paseo-relay": "Paseo · Relay",
  "opencode-direct": "OpenCode · Direct",
  "opencode-pair": "OpenCode · Pair",
};

const TRANSPORT_ORDER: Transport[] = [
  "opencode-direct",
  "opencode-pair",
  "paseo-direct",
  "paseo-relay",
];

/**
 * The connection form: four ways to reach a backend, one accordion card each.
 * OpenCode is the primary backend, so it comes first. Only the open card shows
 * fields, which keeps the page to a handful of lines when nothing is chosen.
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

  const [expanded, setExpanded] = useState<Transport>(() => {
    if (mode === "opencode") return "opencode-direct";
    if (mode === "relay") return "paseo-relay";
    return "paseo-direct";
  });
  const [connecting, setConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const connectPending = useRef(false);
  const isBusy = connecting;
  const addingConnection = connections.length > 0 || savedConnections.length > 0;

  // The card is the source of truth for which mode the store is in. OpenClaw is
  // no longer offered, so a stored selection lands on Paseo direct.
  useEffect(() => {
    if (expanded.startsWith("opencode")) {
      if (mode !== "opencode") setMode("opencode");
      return;
    }
    const next = expanded === "paseo-relay" ? "relay" : "direct";
    if (mode !== next) setMode(next);
  }, [expanded, mode, setMode]);

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

  function renderFields(transport: Transport): ReactNode {
    if (transport === "paseo-direct") {
      return (
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
      );
    }
    if (transport === "paseo-relay") {
      return (
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
      );
    }
    if (transport === "opencode-pair") {
      return (
        <>
          <Text style={styles.label}>Pair link</Text>
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
        </>
      );
    }
    return (
      <>
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
    );
  }

  return (
    <View style={styles.form}>
      {TRANSPORT_ORDER.map((transport) => {
        const open = expanded === transport;
        return (
          <View key={transport} style={[styles.card, open && styles.cardOpen]}>
            <TouchableOpacity
              style={styles.cardHeader}
              onPress={() => {
                if (open) return;
                hapticTap("selection");
                setExpanded(transport);
              }}
              disabled={isBusy}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
            >
              <Text style={styles.cardTitle}>{TRANSPORT_TITLES[transport]}</Text>
              <Icon
                name={open ? "chevron-up" : "chevron-down"}
                size={16}
                color={THEME.colors.textMuted}
              />
            </TouchableOpacity>

            {open ? (
              <View style={styles.cardBody}>
                {renderFields(transport)}
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
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: THEME.spacing.sm,
  },
  card: {
    backgroundColor: THEME.colors.background,
    borderRadius: THEME.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
    overflow: "hidden",
  },
  cardOpen: {
    borderColor: "rgba(148,163,184,0.4)",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: THEME.spacing.md,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: THEME.colors.text,
  },
  cardBody: {
    gap: 10,
    paddingHorizontal: THEME.spacing.md,
    paddingBottom: THEME.spacing.md,
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
    marginTop: THEME.spacing.xs,
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
  },
});
