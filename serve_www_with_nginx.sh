#!/bin/bash

cd "$(dirname "$0")"

if [ ! -d "./www" ] || [ ! "$(ls -A ./www)" ]; then
    echo "Error: Built www directory not found or empty"
    exit 1
fi

mkdir -p ./nginx/logs

docker run \
  --rm \
  --name minetest_www \
  -p 8080:8080 \
  -v $(pwd)/www:/minetest_www/ \
  -v $(pwd)/nginx/nginx.conf:/etc/nginx/nginx.conf:ro \
  -v $(pwd)/nginx/logs:/var/log/nginx \
  nginx:alpine-slim