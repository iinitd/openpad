#!/usr/bin/env bash
# Build the OTA install page for an ad-hoc iOS build.
#
#   publish-dev-client.sh <ipa-path> <output-dir>
#
# The output directory is a self-contained Pages root: the IPA, an
# itms-services manifest next to it, and an index page with the install link.
# Requires GITHUB_REPOSITORY (set automatically on Actions) to derive the site
# URL, which must be the https://<owner>.github.io/<repo> form Pages serves.
set -euo pipefail

IPA="${1:?usage: publish-dev-client.sh <ipa> <output-dir>}"
OUT="${2:?usage: publish-dev-client.sh <ipa> <output-dir>}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
OWNER="${REPO%%/*}"
NAME="${REPO#*/}"
BASE_URL="https://${OWNER}.github.io/${NAME}"
SUBDIR="dev"

[ -f "$IPA" ] || { echo "IPA not found: $IPA" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

unzip -q -o "$IPA" "Payload/*.app/Info.plist" -d "$WORK"
PLIST="$(find "$WORK/Payload" -maxdepth 2 -name Info.plist | head -1)"
[ -n "$PLIST" ] || { echo "Info.plist not found inside $IPA" >&2; exit 1; }

BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw "$PLIST")"
BUILD_NUMBER="$(plutil -extract CFBundleVersion raw "$PLIST")"
SHORT_VERSION="$(plutil -extract CFBundleShortVersionString raw "$PLIST")"
DISPLAY_NAME="$(plutil -extract CFBundleDisplayName raw "$PLIST" 2>/dev/null || echo "OpenPad Dev")"

mkdir -p "$OUT/$SUBDIR"
IPA_NAME="$(basename "$IPA")"
cp "$IPA" "$OUT/$SUBDIR/$IPA_NAME"

IPA_URL="${BASE_URL}/${SUBDIR}/${IPA_NAME}"
MANIFEST_URL="${BASE_URL}/${SUBDIR}/manifest.plist"
INSTALL_URL="itms-services://?action=download-manifest&url=${MANIFEST_URL}"

cat > "$OUT/$SUBDIR/manifest.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${IPA_URL}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${BUNDLE_ID}</string>
        <key>bundle-version</key>
        <string>${BUILD_NUMBER}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${DISPLAY_NAME}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
PLIST

cat > "$OUT/index.html" <<HTML
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${DISPLAY_NAME}</title>
<body style="font: 16px -apple-system, system-ui, sans-serif; margin: 24px; line-height: 1.5">
  <h1>${DISPLAY_NAME}</h1>
  <p>${SHORT_VERSION} (${BUILD_NUMBER}) &middot; ${BUNDLE_ID}</p>
  <p>Open this page in Safari on an iOS device that is registered to the
     provisioning profile, then tap Install.</p>
  <p><a href="${INSTALL_URL}">Install ${DISPLAY_NAME}</a></p>
  <p style="color: #64748b">Safari only. Other in-app browsers ignore
     itms-services links.</p>
</body>
</html>
HTML

echo "install_url=${INSTALL_URL}"
echo "manifest_url=${MANIFEST_URL}"
echo "ipa_url=${IPA_URL}"
