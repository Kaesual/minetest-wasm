#!/bin/bash -eux

# Build virtual file system
#
# The files minetest needs to function correctly.
#
# Shaders, fonts, games, etc

source common.sh

pushd "$BUILD_DIR"

rm -rf fsroot
mkdir fsroot
cp -a "minetest-install" fsroot/minetest


#############################################
pushd fsroot/minetest

rm -rf bin unix
# Emscripten strips empty directories. But bin/ needs to be present so that
# realpath() works on relative paths starting with bin/../
mkdir bin
echo "This is here to ensure bin exists" > bin/readme.txt

mkdir -p cache
cat > cache/common.conf << EOF
update_last_checked = disabled
no_mtg_notification = true
no_keycode_migration_warning = true
EOF

popd


#############################################
# Copy root certificates for OpenSSL
pushd fsroot
mkdir -p etc/ssl/certs
# May be a symlink, use cat to copy contents
cat /etc/ssl/certs/ca-certificates.crt > etc/ssl/certs/ca-certificates.crt
popd


# Make fsroot.tar
rm -f fsroot.tar
pushd fsroot
tar cf ../fsroot.tar .
popd

# Compress with ZSTD
rm -f fsroot.tar.zst
zstd --ultra -22 fsroot.tar

# Make minetest_game pack
mkdir -p minetest_game_fsroot/minetest/games
pushd minetest_game_fsroot/minetest
cp -a "$SOURCES_DIR"/minetest_game games
cd games/minetest_game
rm -rf ".git" ".github"
popd
# Make minetest_game_fsroot.tar
rm -f minetest_game_fsroot.tar
pushd minetest_game_fsroot
tar cf ../minetest_game_fsroot.tar .
popd
# Compress with ZSTD
rm -f minetest_game_fsroot.tar.zst
zstd --ultra -22 minetest_game_fsroot.tar

# Make voxelibre_game_fsroot.tar
mkdir -p voxelibre_fsroot/minetest/games
pushd voxelibre_fsroot/minetest
cp -a "$SOURCES_DIR"/voxelibre games
mv games/voxelibre games/mineclone2
cd games/mineclone2
rm -rf ".git" ".github"
popd
# Make voxelibre_fsroot.tar
rm -f voxelibre_fsroot.tar
pushd voxelibre_fsroot
tar cf ../voxelibre_fsroot.tar .
popd
# Compress with ZSTD
rm -f voxelibre_fsroot.tar.zst
zstd --ultra -22 voxelibre_fsroot.tar

# Make mineclonia_game_fsroot.tar
mkdir -p mineclonia_fsroot/minetest/games
pushd mineclonia_fsroot/minetest
cp -a "$SOURCES_DIR"/mineclonia games
cd games/mineclonia
rm -rf ".git" ".github"
popd
# Make mineclonia_fsroot.tar
rm -f mineclonia_fsroot.tar
pushd mineclonia_fsroot
tar cf ../mineclonia_fsroot.tar .
popd
# Compress with ZSTD
rm -f mineclonia_fsroot.tar.zst
zstd --ultra -22 mineclonia_fsroot.tar

# Make glitch_game_fsroot.tar
mkdir -p glitch_fsroot/minetest/games
pushd glitch_fsroot/minetest
cp -a "$SOURCES_DIR"/glitch games
cd games/glitch
rm -rf ".git" ".github"
popd
# Make glitch_fsroot.tar
rm -f glitch_fsroot.tar
pushd glitch_fsroot
tar cf ../glitch_fsroot.tar .
popd
# Compress with ZSTD
rm -f glitch_fsroot.tar.zst
zstd --ultra -22 glitch_fsroot.tar

# Make blockbomber_game_fsroot.tar
mkdir -p blockbomber_fsroot/minetest/games
pushd blockbomber_fsroot/minetest
cp -a "$SOURCES_DIR"/blockbomber games
cd games/blockbomber
rm -rf ".git" ".github"
popd
# Make blockbomber_fsroot.tar
rm -f blockbomber_fsroot.tar
pushd blockbomber_fsroot
tar cf ../blockbomber_fsroot.tar .
popd
# Compress with ZSTD
rm -f blockbomber_fsroot.tar.zst
zstd --ultra -22 blockbomber_fsroot.tar