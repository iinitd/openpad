import { useState } from "react";
import {
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Icon } from "../components/Icon";
import { THEME } from "../styles/theme";

interface UrlFieldsProps {
  value: string;
  onChange: (value: string) => void;
  /** Scheme pair for the insecure and secure forms, e.g. ws / wss. */
  schemes: { plain: string; secure: string };
  defaultPort: string;
  /** Appended when the URL carries no path of its own (Paseo's /ws). */
  pathSuffix?: string;
  username?: string;
  onUsernameChange?: (value: string) => void;
  password?: string;
  onPasswordChange?: (value: string) => void;
  passwordPlaceholder?: string;
  /** Shown under the switch whenever SSL is off. */
  insecureHint?: string;
}

interface ParsedUrl {
  host: string;
  port: string;
  secure: boolean;
  path: string;
}

function parseUrl(
  value: string,
  schemes: UrlFieldsProps["schemes"],
  defaultPort: string,
  pathSuffix: string,
): ParsedUrl {
  // A regex rather than `new URL`: the RN polyfill is picky about ws:// and
  // other non-http schemes, and this only needs the four pieces.
  const match = /^([a-z][a-z\d+.-]*):\/\/([^/:?#]+)(?::(\d+))?(\/[^?#]*)?/i.exec(
    value.trim(),
  );
  if (!match) {
    return {
      host: "",
      port: defaultPort,
      secure: false,
      path: pathSuffix.replace(/^\/+/, ""),
    };
  }
  return {
    host: match[2] ?? "",
    port: match[3] ?? defaultPort,
    secure: (match[1] ?? "").toLowerCase() === schemes.secure,
    path: (match[4] ?? "").replace(/^\/+/, ""),
  };
}

function composeUrl(
  parts: ParsedUrl,
  schemes: UrlFieldsProps["schemes"],
  pathSuffix: string,
): string {
  const host = parts.host.trim();
  if (!host) return "";
  const scheme = parts.secure ? schemes.secure : schemes.plain;
  const port = parts.port.trim();
  const path = parts.path || pathSuffix.replace(/^\/+/, "");
  return `${scheme}://${host}${port ? `:${port}` : ""}${path ? `/${path}` : ""}`;
}

/**
 * The address split into the parts people actually know (host, port, TLS),
 * with the assembled URL available under Advanced for anything unusual. Edits
 * run both ways: the parts rebuild the URL, and editing the URL re-parses them.
 */
export function UrlFields({
  value,
  onChange,
  schemes,
  defaultPort,
  pathSuffix = "",
  username,
  onUsernameChange,
  password,
  onPasswordChange,
  passwordPlaceholder = "Optional",
  insecureHint = "Not encrypted. Everything sent here, including the password, can be read on the network. Prefer SSL, or a private network such as Tailscale.",
}: UrlFieldsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  const parts = parseUrl(value, schemes, defaultPort, pathSuffix);
  const setPart = (next: Partial<ParsedUrl>) =>
    onChange(composeUrl({ ...parts, ...next }, schemes, pathSuffix));

  return (
    <>
      <View style={styles.row}>
        <View style={styles.hostColumn}>
          <Text style={styles.label}>Host</Text>
          <TextInput
            style={styles.input}
            value={parts.host}
            onChangeText={(host) => setPart({ host })}
            placeholder="localhost"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={styles.portColumn}>
          <Text style={styles.label}>Port</Text>
          <TextInput
            style={styles.input}
            value={parts.port}
            onChangeText={(port) => setPart({ port: port.replace(/[^0-9]/g, "") })}
            placeholder={defaultPort}
            keyboardType="number-pad"
          />
        </View>
      </View>

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Use SSL</Text>
        <Switch
          value={parts.secure}
          onValueChange={(secure) => setPart({ secure })}
          trackColor={{ true: THEME.colors.primary, false: THEME.colors.border }}
          thumbColor="#fff"
        />
      </View>

      {!parts.secure ? (
        <Text style={styles.warning}>{insecureHint}</Text>
      ) : null}

      {onUsernameChange ? (
        <>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            value={username ?? ""}
            onChangeText={onUsernameChange}
            placeholder="Optional"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      ) : null}

      {onPasswordChange ? (
        <>
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              value={password ?? ""}
              onChangeText={onPasswordChange}
              placeholder={passwordPlaceholder}
              secureTextEntry={!reveal}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.revealButton}
              onPress={() => setReveal((current) => !current)}
              accessibilityRole="button"
              accessibilityLabel={reveal ? "Hide password" : "Show password"}
            >
              <Icon
                name={reveal ? "eye-off" : "eye"}
                size={17}
                color={THEME.colors.textMuted}
              />
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      <TouchableOpacity
        style={styles.advancedToggle}
        onPress={() => setAdvancedOpen((current) => !current)}
        accessibilityRole="button"
        accessibilityState={{ expanded: advancedOpen }}
      >
        <Icon
          name={advancedOpen ? "chevron-down" : "chevron-right"}
          size={13}
          color={THEME.colors.textMuted}
        />
        <Text style={styles.advancedLabel}>Advanced</Text>
      </TouchableOpacity>

      {advancedOpen ? (
        <TextInput
          style={[styles.input, styles.advancedInput]}
          value={value}
          onChangeText={onChange}
          placeholder={`${schemes.plain}://${parts.host || "localhost"}:${defaultPort}${pathSuffix}`}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: THEME.spacing.sm,
  },
  hostColumn: {
    flex: 1,
    gap: 4,
  },
  portColumn: {
    width: 88,
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: "500",
    color: THEME.colors.textSecondary,
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
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  switchLabel: {
    fontSize: 14,
    color: THEME.colors.text,
  },
  warning: {
    fontSize: 12,
    lineHeight: 17,
    color: THEME.colors.warning,
    marginTop: -THEME.spacing.xs,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
  },
  passwordInput: {
    flex: 1,
  },
  revealButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: THEME.radii.lg,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.background,
  },
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    alignSelf: "flex-start",
  },
  advancedLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: THEME.colors.textSecondary,
  },
  advancedInput: {
    minHeight: 44,
    fontFamily: THEME.fonts.mono,
    fontSize: 13,
    color: THEME.colors.textSecondary,
    backgroundColor: THEME.colors.backgroundSecondary,
  },
});
