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
import { UrlFields } from "./UrlFields";
import { THEME } from "../styles/theme";
import { hapticTap } from "../components/PressableRow";

type Transport =
  | "paseo-direct"
  | "paseo-relay"
  | "opencode-direct"
  | "opencode-pair";

// The backend is the tab above, so the cards only name the transport.
const TRANSPORT_TITLES: Record<Transport, string> = {
  "paseo-direct": "Direct",
  "paseo-relay": "Relay",
  "opencode-direct": "Direct",
  "opencode-pair": "Pair",
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

  // Nothing is open until the reader asks for it; the page starts as a short
  // menu of four ways in.
  const [backend, setBackend] = useState<"opencode" | "paseo">("opencode");
  const [expanded, setExpanded] = useState<Transport | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const connectPending = useRef(false);
  const isBusy = connecting;
  const addingConnection = connections.length > 0 || savedConnections.length > 0;

  // The card is the source of truth for which mode the store is in. OpenClaw is
  // no longer offered, so a stored selection lands on Paseo direct.
  useEffect(() => {
    if (!expanded) return;
    if (expanded.startsWith("opencode")) {
      if (mode !== "opencode") setMode("opencode");
      return;
    }
    const next = expanded === "paseo-relay" ? "relay" : "direct";
    if (mode !== next) setMode(next);
  }, [expanded, mode, setMode]);

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
        <UrlFields
          value={daemonUrl}
          onChange={setDaemonUrl}
          schemes={{ plain: "ws", secure: "wss" }}
          defaultPort="6767"
          pathSuffix="/ws"
          password={password}
          onPasswordChange={setPassword}
          passwordPlaceholder="Optional"
          insecureHint="This connection is not encrypted. WebSocket traffic and the daemon password travel in the clear, so anyone on the same network can read them. Prefer SSL, or a private network such as Tailscale."
        />
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
        <UrlFields
          value={opencodeUrl}
          onChange={setOpenCodeUrl}
          schemes={{ plain: "http", secure: "https" }}
          defaultPort="4096"
          username={opencodeUsername}
          onUsernameChange={setOpenCodeUsername}
          password={opencodePassword}
          onPasswordChange={setOpenCodePassword}
          passwordPlaceholder="OPENCODE_SERVER_PASSWORD"
          insecureHint="This connection is not encrypted. HTTP sends the server password and session token in the clear, so anyone on the same network can read them. Prefer HTTPS, or a private network such as Tailscale."
        />
        <Text style={styles.hint}>
          Run `opencode serve`, then use the printed server password. For the web app,
          allow this page's origin with `--cors`.
        </Text>
      </>
    );
  }

  const visibleTransports = TRANSPORT_ORDER.filter((transport) =>
    backend === "opencode"
      ? transport.startsWith("opencode")
      : transport.startsWith("paseo"),
  );

  return (
    <View style={styles.form}>
      <View style={styles.tabs}>
        {(
          [
            ["opencode", "OpenCode"],
            ["paseo", "Paseo"],
          ] as const
        ).map(([selected, label]) => {
          const active = backend === selected;
          return (
            <TouchableOpacity
              key={selected}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => {
                if (active) return;
                hapticTap("selection");
                setBackend(selected);
                setExpanded(null);
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

      {visibleTransports.map((transport) => {
        const open = expanded === transport;
        return (
          <View key={transport} style={[styles.card, open && styles.cardOpen]}>
            <TouchableOpacity
              style={[styles.cardHeader, open && styles.cardHeaderOpen]}
              onPress={() => {
                hapticTap("selection");
                setExpanded(open ? null : transport);
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
  tabs: {
    flexDirection: "row",
    gap: 2,
    backgroundColor: THEME.colors.surface,
    borderRadius: 9,
    marginBottom: THEME.spacing.xs,
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
  cardHeaderOpen: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.colors.border,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: THEME.colors.text,
  },
  cardBody: {
    gap: 10,
    paddingHorizontal: THEME.spacing.md,
    paddingTop: THEME.spacing.md,
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
