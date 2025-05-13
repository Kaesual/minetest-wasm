#!/bin/bash -eux

source common.sh

RELEASE_DIR="$WWW_DIR/minetest"
PACKS_DIR="$RELEASE_DIR/packs"
ASSETS_DST_DIR="$WWW_DIR/assets"

echo "Installing release into www/"
rm -rf "$WWW_DIR"
mkdir "$WWW_DIR"
mkdir "$RELEASE_DIR"
mkdir "$PACKS_DIR"
mkdir "$ASSETS_DST_DIR"

# Copy emscripten generated files
pushd "$BUILD_DIR/minetest/src"
EMSCRIPTEN_FILES="minetest.js minetest.wasm minetest.worker.js"
for I in $EMSCRIPTEN_FILES; do
  cp "$I" "$RELEASE_DIR"
done

# Copy assets
cp -a "$BASE_DIR/static/assets/." "$ASSETS_DST_DIR"

# Ideally this would be in RELEASE_DIR, but the way this file
# is located (see emcc --source-map-base) apparently cannot be
# relative to the .wasm file.
if [ -f minetest.wasm.map ]; then
  cp minetest.wasm.map "$WWW_DIR"
fi

popd

# Copy React app build to www/
echo "Copying React app build to www/"
cp -a "$BASE_DIR/app/build/." "$WWW_DIR"

# Copy base file system pack
cp "$BUILD_DIR/fsroot.tar.zst" "$PACKS_DIR/base.pack"

echo "DONE"

# Optional script to customize deployment
# Use this to add extra data packs, deploy to webserver, etc
if [ -f deploy.sh ]; then
  ./deploy.sh "$RELEASE_UUID"
fi
