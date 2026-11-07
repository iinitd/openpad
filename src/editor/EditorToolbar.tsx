import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import type { Editor } from "@tiptap/react";
import { THEME } from "../styles/theme";

interface Props {
  editor: Editor | null;
}

export function EditorToolbar({ editor }: Props) {
  if (!editor) return null;

  const actions = [
    { label: "B", action: () => editor.chain().focus().toggleBold().run(), active: editor.isActive("bold") },
    { label: "I", action: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive("italic") },
    { label: "H1", action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), active: editor.isActive("heading", { level: 1 }) },
    { label: "H2", action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: editor.isActive("heading", { level: 2 }) },
    { label: "•", action: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive("bulletList") },
    { label: "1.", action: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive("orderedList") },
  ] as const;

  return (
    <View style={styles.container}>
      {actions.map((item) => (
        <TouchableOpacity
          key={item.label}
          style={[styles.button, item.active && styles.buttonActive]}
          onPress={item.action}
        >
          <Text style={[styles.buttonText, item.active && styles.buttonTextActive]}>
            {item.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.xs,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  button: {
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.xs,
    borderRadius: THEME.radii.sm,
  },
  buttonActive: {
    backgroundColor: THEME.colors.primary,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
    color: THEME.colors.textSecondary,
  },
  buttonTextActive: {
    color: "#fff",
  },
});
