import Svg, { Circle, Line, Path, Polyline, Rect } from "react-native-svg";
import { THEME } from "../styles/theme";

// Minimal stroke (line) icons, Feather-style: a single-colour 24×24 viewBox
// drawn with round caps/joins. We keep just the glyphs the editor top bar
// needs so we don't pull in a whole icon font. `size`/`color` mirror the usual
// icon API; stroke width scales lightly with size to stay crisp.
export type IconName =
  | "folder"
  | "folder-open"
  | "edit"
  | "check"
  | "stop"
  | "refresh"
  | "chat"
  | "settings"
  | "chevron-right"
  | "chevron-left"
  | "eye"
  | "dice"
  | "eye-off"
  | "chevron-down"
  | "chevron-up"
  | "file"
  | "close"
  | "send"
  | "target"
  | "plus"
  | "pin"
  | "star"
  | "star-filled"
  | "arrow-down"
  | "image"
  | "grid"
  | "list"
  | "archive";

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({
  name,
  size = 20,
  color = THEME.colors.textSecondary,
  strokeWidth = 1.75,
}: IconProps) {
  const common = {
    stroke: color,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "folder-open" ? (
        <>
          <Path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V10H3z" {...common} />
          <Path d="M3 10h18l-2.2 7.6a2 2 0 0 1-1.9 1.4H6.1a2 2 0 0 1-1.9-1.4z" {...common} />
        </>
      ) : null}
      {name === "folder" ? (
        <Path
          d="M3 6a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"
          {...common}
        />
      ) : null}
      {name === "edit" ? (
        <>
          <Path d="M12 20h9" {...common} />
          <Path
            d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"
            {...common}
          />
        </>
      ) : null}
      {name === "check" ? (
        <Polyline points="20 6 9 17 4 12" {...common} />
      ) : null}
      {name === "stop" ? (
        <Rect x="6" y="6" width="12" height="12" rx="2" {...common} fill={color} />
      ) : null}
      {name === "refresh" ? (
        <>
          <Path d="M20 6v5h-5" {...common} />
          <Path d="M4 18v-5h5" {...common} />
          <Path d="M18.4 9A7 7 0 0 0 6.2 6.2L4 8" {...common} />
          <Path d="M5.6 15A7 7 0 0 0 17.8 17.8L20 16" {...common} />
        </>
      ) : null}
      {name === "chat" ? (
        <Path
          d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"
          {...common}
        />
      ) : null}
      {name === "settings" ? (
        <>
          <Circle cx="12" cy="12" r="3" {...common} />
          <Path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            {...common}
          />
        </>
      ) : null}
      {name === "chevron-right" ? (
        <Polyline points="9 6 15 12 9 18" {...common} />
      ) : null}
      {name === "chevron-left" ? (
        <Polyline points="15 6 9 12 15 18" {...common} />
      ) : null}
      {name === "dice" ? (
        <>
          <Rect x="3" y="3" width="18" height="18" rx="4" {...common} />
          <Circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
          <Circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
          <Circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
          <Circle cx="8.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
          <Circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
        </>
      ) : null}
      {name === "eye" ? (
        <>
          <Path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" {...common} />
          <Circle cx="12" cy="12" r="3" {...common} />
        </>
      ) : null}
      {name === "eye-off" ? (
        <>
          <Path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" {...common} />
          <Circle cx="12" cy="12" r="3" {...common} />
          <Line x1="3" y1="21" x2="21" y2="3" {...common} />
        </>
      ) : null}
      {name === "chevron-down" ? (
        <Polyline points="6 9 12 15 18 9" {...common} />
      ) : null}
      {name === "chevron-up" ? (
        <Polyline points="6 15 12 9 18 15" {...common} />
      ) : null}
      {name === "arrow-down" ? (
        <>
          <Line x1="12" y1="5" x2="12" y2="19" {...common} />
          <Polyline points="6 13 12 19 18 13" {...common} />
        </>
      ) : null}
      {name === "file" ? (
        <>
          <Path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" {...common} />
          <Polyline points="14 3 14 9 20 9" {...common} />
        </>
      ) : null}
      {name === "close" ? (
        <>
          <Line x1="6" y1="6" x2="18" y2="18" {...common} />
          <Line x1="18" y1="6" x2="6" y2="18" {...common} />
        </>
      ) : null}
      {name === "list" ? (
        <>
          <Line x1="8" y1="6" x2="21" y2="6" {...common} />
          <Line x1="8" y1="12" x2="21" y2="12" {...common} />
          <Line x1="8" y1="18" x2="21" y2="18" {...common} />
          <Line x1="3" y1="6" x2="3.01" y2="6" {...common} />
          <Line x1="3" y1="12" x2="3.01" y2="12" {...common} />
          <Line x1="3" y1="18" x2="3.01" y2="18" {...common} />
        </>
      ) : null}
      {name === "archive" ? (
        <>
          <Polyline points="21 8 21 21 3 21 3 8" {...common} />
          <Rect x="1" y="3" width="22" height="5" rx="1" {...common} />
          <Line x1="10" y1="12" x2="14" y2="12" {...common} />
        </>
      ) : null}
      {name === "grid" ? (
        <>
          <Rect x="3" y="3" width="7" height="7" rx="1.5" {...common} />
          <Rect x="14" y="3" width="7" height="7" rx="1.5" {...common} />
          <Rect x="3" y="14" width="7" height="7" rx="1.5" {...common} />
          <Rect x="14" y="14" width="7" height="7" rx="1.5" {...common} />
        </>
      ) : null}
      {name === "image" ? (
        <>
          <Rect x="3" y="3" width="18" height="18" rx="2" ry="2" {...common} />
          <Circle cx="8.5" cy="8.5" r="1.5" {...common} />
          <Polyline points="21 15 16 10 5 21" {...common} />
        </>
      ) : null}
      {name === "send" ? (
        <Path d="M12 19V5M5 12l7-7 7 7" {...common} />
      ) : null}
      {name === "target" ? (
        <>
          <Circle cx="12" cy="12" r="9" {...common} />
          <Circle cx="12" cy="12" r="4" {...common} />
          <Circle cx="12" cy="12" r="1" {...common} fill={color} />
        </>
      ) : null}
      {name === "plus" ? (
        <>
          <Line x1="12" y1="5" x2="12" y2="19" {...common} />
          <Line x1="5" y1="12" x2="19" y2="12" {...common} />
        </>
      ) : null}
      {name === "pin" ? (
        <>
          <Line x1="12" y1="17" x2="12" y2="22" {...common} />
          <Path
            d="M9 3h6v2l-1 2v4l3 3H7l3-3V7L9 5V3z"
            {...common}
          />
        </>
      ) : null}
      {name === "star" || name === "star-filled" ? (
        <Path
          d="m12 3 2.75 5.57 6.15.9-4.45 4.34 1.05 6.13L12 18.05 6.5 20.94l1.05-6.13L3.1 9.47l6.15-.9L12 3z"
          {...common}
          fill={name === "star-filled" ? color : "none"}
        />
      ) : null}
    </Svg>
  );
}
