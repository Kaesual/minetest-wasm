#!/bin/bash

RELEASE_UUID=$(find ./www -mindepth 1 -maxdepth 1 -type d -printf '%f')
echo "RELEASE_UUID: $RELEASE_UUID"

# Copy JS libraries
rm -f ./www/$RELEASE_UUID/idb.js
rm -f ./www/$RELEASE_UUID/snackbar.js
rm -f ./www/$RELEASE_UUID/storageManager.js

cp ./static/idb.js ./www/$RELEASE_UUID/idb.js
cp ./static/snackbar.js ./www/$RELEASE_UUID/snackbar.js
cp ./static/storageManager.js ./www/$RELEASE_UUID/storageManager.js

# Update HTML and launcher with proper UUID
sed "s/%__RELEASE_UUID__%/$RELEASE_UUID/g" ./static/launcher.js > ./www/$RELEASE_UUID/launcher.js
sed "s/%__RELEASE_UUID__%/$RELEASE_UUID/g" ./static/index.html > ./www/index.html
echo "SUCCESS"