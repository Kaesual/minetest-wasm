#!/bin/bash
set -e

cd "$(dirname "$0")"

IMAGE_EXISTS=$(docker images -q minetest_app_builder)
if [ -z "$IMAGE_EXISTS" ] || [ "$1" = "--with-build" ]; then
  docker build -t minetest_app_builder .
fi

# If first argument is --with-build, remove it from the arguments
if [ "$1" = "--with-build" ]; then
  shift
fi

# Change to the directory containing this script
cd "$(dirname "$0")"

# Run Node.js 22 Docker container with proper permissions
docker run --rm -it \
  -u "$(id -u):$(id -g)" \
  -v "$(pwd)":/app:rw \
  -w /app \
  minetest_app_builder ${@:-bash}