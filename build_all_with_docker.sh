#!/bin/bash -eux
docker build -t minetest_builder:latest .
rm -rf ./www
mkdir -p ./www
docker run --rm -u $(id -u) -v ./www:/www:rw minetest_builder:latest cp -a /home/builder/minetest-wasm/www/. /www/
