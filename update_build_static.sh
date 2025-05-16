#!/bin/bash

cd "$(dirname "$0")"

# Build React app
echo "Building React app..."
pushd app
# Check if build is required
if [ "${1:-}" = "--with-build" ]; then
  # Check if node_modules exists, if not run npm install
  ./docker.sh --with-build npm --version
  if [ ! -d "node_modules" ]; then
    ./docker.sh --with-build npm install
  fi
  # Build the React app
  ./docker.sh --with-build npm run build
else
  ./docker.sh npm --version
  # Check if node_modules exists, if not run npm install
  if [ ! -d "node_modules" ]; then
    ./docker.sh npm install
  fi
  # Build the React app
  ./docker.sh npm run build
fi
popd

./build_www.sh

# Check if build was successful
if [ -f "www/index.html" ]; then
  echo "Build successful (index.html exists)"
else
  echo "Build failed (index.html does not exist)"
  exit 1
fi
