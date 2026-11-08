import { useState } from "react";
import { TextInput, type StyleProp, type TextStyle } from "react-native";

/**
 * Read-only text the user can select normally.
 *
 * `<Text selectable>` on iOS only offers a whole-block Copy: no highlight, no
 * drag handles, no range selection (react-native#13938, open since 2017 and
 * still unfixed). A non-editable multiline TextInput is a real native text
 * view, so selection, handles and the edit menu behave the way they do
 * everywhere else on the platform.
 */
export function SelectableText({
  text,
  style,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
}) {
  const [height, setHeight] = useState(0);
  return (
    <TextInput
      editable={false}
      multiline
      scrollEnabled={false}
      value={text}
      onContentSizeChange={(event) => {
        const next = Math.ceil(event.nativeEvent.contentSize.height);
        if (next !== height) setHeight(next);
      }}
      // The text view is sized by its own content, so the surrounding modal
      // still lays out like a plain block of text.
      style={[styles.input, style, height > 0 ? { height } : null]}
    />
  );
}

const styles = {
  input: {
    padding: 0,
    margin: 0,
    backgroundColor: "transparent",
    textAlignVertical: "top",
  } as const,
};
