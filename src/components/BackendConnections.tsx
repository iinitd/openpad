import { useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useShallow } from "zustand/react/shallow";
import { useConnectionStore } from "../stores/connection-store";
import { useWriterOpeningStore } from "../stores/writer-opening-store";
import { THEME } from "../styles/theme";

interface BackendConnectionsProps {
  disabled?: boolean;
  showActiveOpen?: boolean;
}

function publicEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "Endpoint unavailable";
  }
}

export function BackendConnections({ disabled = false, showActiveOpen = false }: BackendConnectionsProps) {
  const router = useRouter();
  const { connections, savedConnections, activeConnectionId, isSwitchingConnection } = useConnectionStore(useShallow((state) => ({
    connections: state.connections,
    savedConnections: state.savedConnections,
    activeConnectionId: state.activeConnectionId,
    isSwitchingConnection: state.isSwitchingConnection,
  })));
  const opening = useWriterOpeningStore((state) => state.opening);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pending = useRef(false);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const rows = [
    ...connections,
    ...savedConnections.filter((saved) => !connections.some((connection) => connection.id === saved.id)),
  ];

  async function runAction(id: string, action: "open" | "retry" | "disconnect") {
    if (disabled || pending.current || useWriterOpeningStore.getState().opening || useConnectionStore.getState().isSwitchingConnection) return;
    pending.current = true;
    setPendingId(id);
    setError(null);
    try {
      const store = useConnectionStore.getState();
      const previousActiveId = store.activeConnectionId;
      if (action === "open" || action === "retry") {
        const operation = useWriterOpeningStore.getState().open({ connectionId: id });
        router.replace("/writer/session");
        await operation;
      } else {
        await store.disconnect(id);
        const next = useConnectionStore.getState();
        if (!next.client) router.replace("/");
        else if (previousActiveId === id) {
          const operation = useWriterOpeningStore.getState().open();
          router.replace("/writer/session");
          await operation;
        }
      }
    } catch (cause) {
      setError({ id, message: cause instanceof Error ? cause.message : "Could not update this connection" });
    } finally {
      pending.current = false;
      setPendingId(null);
    }
  }

  if (rows.length === 0) return null;

  return (
    <View style={styles.list}>
      {rows.map((connection) => {
        const live = connections.find((entry) => entry.id === connection.id);
        const saved = savedConnections.find((entry) => entry.id === connection.id);
        const status = live?.connectionState.status ?? "idle";
        const connected = status === "connected";
        const connecting = status === "connecting";
        const active = Boolean(live && activeConnectionId === connection.id);
        const busy = pendingId === connection.id;
        const actionsDisabled = disabled || pendingId !== null || opening || isSwitchingConnection;
        const modeLabel = connection.mode === "openclaw" ? "OpenClaw"
          : connection.mode === "opencode" ? "OpenCode"
          : connection.mode === "relay" ? "Relay" : "Direct";
        const reconnecting = live?.connectionState.status === "connecting" && live.connectionState.attempt > 0;
        const statusLabel = connected ? "Connected" : reconnecting ? "Reconnecting…" : connecting ? "Connecting…" : status === "disconnected" ? "Offline" : "Disconnected";

        return (
          <View key={connection.id} style={[styles.card, active && styles.cardActive]}>
            <View style={styles.header}>
              <Text style={styles.label} numberOfLines={1}>
                {connection.mode === "relay" ? "Relay" : connection.label || modeLabel}
              </Text>
              {active ? <Text style={styles.activeBadge}>Active</Text> : null}
            </View>
            {connection.mode !== "relay" ? (
              <Text style={styles.endpoint} numberOfLines={1}>{publicEndpoint(connection.endpoint)}</Text>
            ) : null}
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, connected ? styles.statusConnected : connecting ? styles.statusConnecting : styles.statusOffline]} />
              <Text style={styles.statusText}>
                {statusLabel}{connection.mode !== "relay" ? ` · ${modeLabel}` : ""}
              </Text>
              {busy ? <ActivityIndicator size="small" color={THEME.colors.primary} /> : null}
            </View>
            {saved?.autoConnect ? <Text style={styles.hint}>Reconnects on launch</Text> : null}
            <View style={styles.actions}>
              {connected && (!active || showActiveOpen) ? (
                <TouchableOpacity
                  style={[styles.button, actionsDisabled && styles.buttonDisabled]}
                  onPress={() => runAction(connection.id, "open")}
                  disabled={actionsDisabled}
                  accessibilityRole="button"
                  activeOpacity={0.7}
                >
                  <Text style={styles.buttonText}>{active || showActiveOpen ? "Open" : "Switch"}</Text>
                </TouchableOpacity>
              ) : null}
              {!connected && !connecting && saved ? (
                <TouchableOpacity
                  style={[styles.button, actionsDisabled && styles.buttonDisabled]}
                  onPress={() => runAction(connection.id, "retry")}
                  disabled={actionsDisabled}
                  accessibilityRole="button"
                  activeOpacity={0.7}
                >
                  <Text style={styles.buttonText}>Retry</Text>
                </TouchableOpacity>
              ) : null}
              {live || saved?.autoConnect ? (
                <TouchableOpacity
                  style={[styles.button, styles.buttonDanger, actionsDisabled && styles.buttonDisabled]}
                  onPress={() => runAction(connection.id, "disconnect")}
                  disabled={actionsDisabled}
                  accessibilityRole="button"
                  activeOpacity={0.7}
                >
                  <Text style={[styles.buttonText, styles.buttonTextDanger]}>Disconnect</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {error?.id === connection.id ? <Text style={styles.error} accessibilityRole="alert">{error.message}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: THEME.spacing.md },
  card: {
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: THEME.radii.lg,
    backgroundColor: THEME.colors.backgroundSecondary,
    padding: THEME.spacing.lg,
    gap: THEME.spacing.sm,
  },
  cardActive: { borderColor: THEME.colors.primaryLight },
  header: { flexDirection: "row", alignItems: "center", gap: THEME.spacing.sm },
  label: { flex: 1, minWidth: 0, fontSize: 17, fontWeight: "600", color: THEME.colors.text },
  activeBadge: {
    fontSize: 13,
    fontWeight: "600",
    color: THEME.colors.primary,
    backgroundColor: THEME.colors.surface,
    paddingHorizontal: THEME.spacing.sm,
    paddingVertical: THEME.spacing.xs,
    borderRadius: THEME.radii.full,
  },
  endpoint: { fontSize: 14, color: THEME.colors.textMuted, fontFamily: THEME.fonts.mono },
  statusRow: { flexDirection: "row", alignItems: "center", gap: THEME.spacing.sm },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusConnected: { backgroundColor: THEME.colors.success },
  statusConnecting: { backgroundColor: THEME.colors.warning },
  statusOffline: { backgroundColor: THEME.colors.textMuted },
  statusText: { fontSize: 14, color: THEME.colors.textSecondary },
  hint: { fontSize: 14, color: THEME.colors.textSecondary },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: THEME.spacing.sm },
  button: {
    paddingHorizontal: THEME.spacing.lg,
    paddingVertical: THEME.spacing.sm,
    borderRadius: THEME.radii.md,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.background,
    marginTop: THEME.spacing.xs,
  },
  buttonText: { fontSize: 16, fontWeight: "600", color: THEME.colors.text },
  buttonDisabled: { opacity: 0.6 },
  buttonDanger: { borderColor: THEME.colors.error },
  buttonTextDanger: { color: THEME.colors.error },
  error: { fontSize: 15, color: THEME.colors.error },
});
