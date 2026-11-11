#!/usr/bin/env bash
# Publish the static site in site/ to the gh-pages branch.
#
# gh-pages is a single Pages site: the site pages own the root, the ad-hoc dev
# client keeps its generated IPA and installer under dev/. This script replaces
# the root files and leaves dev/ untouched.
#
# Requires GITHUB_TOKEN with contents:write and GITHUB_REPOSITORY.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
TOKEN="${GITHUB_TOKEN:?GITHUB_TOKEN is required}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git -C "$WORK" init -q
git -C "$WORK" remote add origin "https://x-access-token:${TOKEN}@github.com/${REPO}.git"

if git -C "$WORK" fetch -q origin gh-pages 2>/dev/null; then
  git -C "$WORK" checkout -q -b gh-pages FETCH_HEAD
else
  # First publish: start from an empty branch.
  git -C "$WORK" checkout -q -b gh-pages
fi

# Keep the dev client subtree, replace everything else with site/.
find "$WORK" -mindepth 1 -maxdepth 1 ! -name .git ! -name dev -exec rm -rf {} +
cp -R "$ROOT/site/." "$WORK"/
rm -f "$WORK/README.md"

git -C "$WORK" add -A
if git -C "$WORK" diff --cached --quiet; then
  echo "site: gh-pages already up to date"
  exit 0
fi

git -C "$WORK" config user.name "github-actions[bot]"
git -C "$WORK" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git -C "$WORK" commit -q -m "Publish site $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git -C "$WORK" push -q origin gh-pages

echo "site: published to https://${REPO%%/*}.github.io/${REPO#*/}/"
