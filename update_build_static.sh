#!/bin/bash

RELEASE_UUID=$(find ./www -mindepth 1 -maxdepth 1 -type d -printf '%f')
echo "RELEASE_UUID: $RELEASE_UUID"
sed "s/%__RELEASE_UUID__%/$RELEASE_UUID/g" ./static/launcher.js > ./www/$RELEASE_UUID/launcher.js
sed "s/%__RELEASE_UUID__%/$RELEASE_UUID/g" ./static/index.html > ./www/index.html
echo "SUCCESS"