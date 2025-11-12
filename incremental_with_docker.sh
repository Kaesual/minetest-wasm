#!/bin/bash -eux

cd "$(dirname "$0")"

# Build React app
echo "Building React app..."
pushd app
# Check if build is required
if [ "${1:-}" = "--with-build" ]; then
  ./docker.sh --with-build npm --version
  ./docker.sh --with-build npm install
  ./docker.sh --with-build npm run build
else
  ./docker.sh npm --version
  ./docker.sh npm install
  ./docker.sh npm run build
fi
popd

IMAGE_EXISTS=$(docker images -q minetest_builder)
if [ -z "$IMAGE_EXISTS" ] || [ "${1:-}" = "--with-build" ]; then
  docker build -t minetest_builder .
fi

echo "cd /minetest-wasm && ./install_emsdk.sh && ./incremental.sh" | docker run --rm -i -u $(id -u):$(id -g) -v .:/minetest-wasm:rw minetest_builder bash
