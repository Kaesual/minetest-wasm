#!/bin/bash -eux
docker build -t minetest_builder:latest .
echo "cd /minetest-wasm && ./install_emsdk.sh && ./build_all.sh" | docker run --rm -i -u $(id -u):$(id -g) -v .:/minetest-wasm:rw minetest_builder:latest bash
