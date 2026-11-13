import { useEffect, useState } from "react";
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./Icon";
import { PressableRow } from "./PressableRow";
import { THEME } from "../styles/theme";

/**
 * A full-screen look at message images. Tapping a thumbnail in a bubble opens
 * this at that image; swiping moves between the images of the same message.
 * Tapping the picture or the close button dismisses it.
 */
export function ImageViewer({
  images,
  index,
  onClose,
}: {
  images: string[];
  /** Which image to open at; `null` keeps the viewer closed. */
  index: number | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [current, setCurrent] = useState(0);
  // Bumped on every open so the pager remounts at the tapped image even when
  // the same thumbnail is opened twice (the previous session may have been
  // swiped elsewhere before closing).
  const [session, setSession] = useState(0);
  const visible = index !== null && images.length > 0;

  // The pager starts on the tapped image; `onShow` is Android-only, so track
  // the entry point here instead of relying on the modal lifecycle.
  useEffect(() => {
    if (index === null) return;
    setCurrent(index);
    setSession((value) => value + 1);
  }, [index]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <FlatList
          // Re-keying per entry point gives the pager the right starting page
          // without imperative scrolling; swiping inside the viewer keeps its
          // own scroll position.
          key={`image-viewer-${session}`}
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={index ?? 0}
          getItemLayout={(_, itemIndex) => ({
            length: width,
            offset: width * itemIndex,
            index: itemIndex,
          })}
          keyExtractor={(uri, itemIndex) => `${itemIndex}-${uri.length}`}
          onMomentumScrollEnd={(event) => {
            const next = Math.round(event.nativeEvent.contentOffset.x / width);
            setCurrent(Math.min(Math.max(next, 0), images.length - 1));
          }}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.page, { width, height }]}
              onPress={onClose}
              accessibilityRole="imagebutton"
              accessibilityLabel="Close image"
            >
              <Image source={{ uri: item }} style={styles.image} resizeMode="contain" />
            </Pressable>
          )}
        />

        <PressableRow
          style={[styles.close, { top: insets.top + THEME.spacing.sm }]}
          haptic="light"
          scale={false}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close image"
        >
          <Icon name="close" size={18} color="#fff" />
        </PressableRow>

        {images.length > 1 ? (
          <Text style={[styles.counter, { bottom: insets.bottom + THEME.spacing.md }]}>
            {current + 1} / {images.length}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "#000",
  },
  page: {
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  close: {
    position: "absolute",
    right: THEME.spacing.md,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  counter: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.16)",
    color: "#fff",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
});
