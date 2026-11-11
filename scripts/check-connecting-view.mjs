import { readFile } from "node:fs/promises";

const [connectingView, connectScreen, writerShell, openingStore] = await Promise.all([
  readFile(new URL("../src/components/ConnectingView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/index.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/writer/session.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/stores/writer-opening-store.ts", import.meta.url), "utf8"),
]);

const requirements = [
  ["loading view carries the Puff identity", /<Icon\s+name="edit"[\s\S]*<Text style=\{styles\.brand\}>Puff<\/Text>/, connectingView],
  ["loading view uses a restrained animated progress line", /Animated\.loop[\s\S]*style=\{styles\.progressTrack\}[\s\S]*styles\.progressBar/, connectingView],
  ["loading animation is stopped on unmount", /return\s*\(\)\s*=>\s*animation\.stop\(\)/, connectingView],
  ["loading subtitle keeps long endpoints legible", /ellipsizeMode="middle"/, connectingView],
  ["connect launch still uses the shared loading view", /<ConnectingView title="Connecting…"/, connectScreen],
  ["the writer shell observes shared opening progress and errors", /useWriterOpeningStore\(\(state\) => state\.opening\)[\s\S]*useWriterOpeningStore\(\(state\) => state\.error\)/, writerShell],
  ["the writer shell renders project opening status alongside its content", /showOpeningStatus[\s\S]*styles\.openingStatus[\s\S]*"Opening project…"[\s\S]*<ContentPreview\s*\/>/, writerShell],
  ["same-project session switching does not show project loading", /switchingProjectSession = Boolean\(openingTarget\?\.agentId[\s\S]*openingTarget\.connectionId === activeConnectionId[\s\S]*normalizeWorkspaceCwd\(openingTarget\.cwd \?\? ""\) === projectCwd\)[\s\S]*showOpeningStatus = Boolean\(openingError \|\| \(opening && !switchingProjectSession\)\)/, writerShell],
  ["opening errors are announced as alerts", /accessibilityRole=\{openingError \? "alert" : undefined\}/, writerShell],
  ["failed writer startup exposes the shared retry action", /openingError && !opening[\s\S]*useWriterOpeningStore\.getState\(\)\.retry\(\)/, writerShell],
  ["opening status offers access to connection settings", /styles\.openingStatus[\s\S]*router\.push\("\/writer\/settings"\)[\s\S]*>Connections<\/Text>/, writerShell],
  ["the host opener clears previous errors when a new attempt starts", /set\(\{ opening: true, error: null, target \}\)/, openingStore],
];

const forbidden = [
  ["loading view no longer uses the generic spinner", /ActivityIndicator/, connectingView],
];

const failures = [
  ...requirements.filter(([, pattern, source]) => !pattern.test(source)).map(([label]) => label),
  ...forbidden.filter(([, pattern, source]) => pattern.test(source)).map(([label]) => label),
];

if (failures.length) {
  console.error(`Connecting view contract failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Connecting view contract passed.");
