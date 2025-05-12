#!/bin/bash -eux
docker build -t minetest_builder:latest .
docker run --rm -it -u $(id -u):$(id -g) -v .:/minetest-wasm:rw minetest_builder:latest bash
