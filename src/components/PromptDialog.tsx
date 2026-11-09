import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { THEME } from "../styles/theme";

/**
 * A small text prompt. React Native's Alert.prompt is iOS-only, and the action
 * has to exist on every platform the app runs on.
 */
export function PromptDialog({
  visible,
  title,
  message,
  placeholder,
  initialValue = "",
  confirmLabel = "Save",
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            autoFocus
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => onSubmit(value)}
          />
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
              onPress={onCancel}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.action,
                styles.confirm,
                pressed && styles.actionPressed,
              ]}
              onPress={() => onSubmit(value)}
              accessibilityRole="button"
            >
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: THEME.spacing.xl,
    backgroundColor: "rgba(15,23,42,0.32)",
  },
  card: {
    width: "100%",
    maxWidth: 360,
    gap: THEME.spacing.md,
    padding: THEME.spacing.lg,
    borderRadius: THEME.radii.xl,
    backgroundColor: THEME.colors.background,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    color: THEME.colors.text,
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
    color: THEME.colors.textSecondary,
    marginTop: -THEME.spacing.sm,
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
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: THEME.spacing.sm,
    marginTop: THEME.spacing.xs,
  },
  action: {
    paddingHorizontal: THEME.spacing.lg,
    paddingVertical: 9,
    borderRadius: THEME.radii.lg,
  },
  actionPressed: {
    opacity: 0.6,
  },
  confirm: {
    backgroundColor: THEME.colors.primary,
  },
  cancelText: {
    fontSize: 15,
    color: THEME.colors.textSecondary,
  },
  confirmText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
});
