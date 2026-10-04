#!/bin/sh
# Zips the extension into dist/Notion-Presenter-View-<version>.zip, a folder ready for Load unpacked.
set -e
cd "$(dirname "$0")/.."
export TZ=UTC

version=$(node -p "require('./manifest.json').version")
icons=$(node -p "[...new Set(Object.values(require('./manifest.json').icons))].join(' ')")
name="Notion-Presenter-View-$version"
stage="dist/$name"

rm -rf dist
mkdir -p "$stage/icons"
cp manifest.json background.js presenter.js toggle.js LICENSE "$stage/"
for icon in $icons; do cp "$icon" "$stage/icons/"; done

# Fixed timestamps, permissions and file order, so the same commit gives the same zip on any machine
find "$stage" -exec touch -t 202601010000 {} +
find "$stage" -type d -exec chmod 755 {} +
find "$stage" -type f -exec chmod 644 {} +
(cd dist && find "$name" | LC_ALL=C sort | zip -qX "$name.zip" -@)
rm -rf "$stage"

shasum -a 256 "dist/$name.zip"
