#!/bin/bash
docker build -t minetest_builder:latest .

pushd ../
echo "cd /minetest-wasm && source common.sh && rm -rf ./sources/minetest && getrepo minetest https://github.com/paradust7/minetest.git 943e0e9f99245aaf61a3e3967d53f807c70492e6" | docker run --rm -i -u $(id -u):$(id -g) -v .:/minetest-wasm:rw minetest_builder:latest bash
popd


diff -Naur ../sources/minetest/src/database/database-sqlite3.cpp ./modified_files/database-sqlite3.cpp > ./database-sqlite3.patch
diff -Naur ../sources/minetest/src/database/database-files.cpp ./modified_files/database-files.cpp > ./database-files.patch
diff -Naur ../sources/minetest/src/database/database-sqlite3.h ./modified_files/database-sqlite3.h > ./database-sqlite3.h.patch
diff -Naur ../sources/minetest/src/filesys.cpp ./modified_files/filesys.cpp > ./filesys.patch
diff -Naur ../sources/minetest/src/main.cpp ./modified_files/main.cpp > ./main.patch
diff -Naur ../sources/minetest/src/CMakeLists.txt ./modified_files/CMakeLists.txt > ./CMakeLists.patch

sed -i 's|--- ../sources/|--- |' ./CMakeLists.patch
sed -i 's|--- ../sources/|--- |' ./database-sqlite3.patch
sed -i 's|--- ../sources/|--- |' ./database-sqlite3.h.patch
sed -i 's|--- ../sources/|--- |' ./database-files.patch
sed -i 's|--- ../sources/|--- |' ./filesys.patch
sed -i 's|--- ../sources/|--- |' ./main.patch

sed -i 's|+++ ./modified_files/|+++ minetest/src/|' ./CMakeLists.patch
sed -i 's|+++ ./modified_files/|+++ minetest/src/database/|' ./database-sqlite3.patch
sed -i 's|+++ ./modified_files/|+++ minetest/src/database/|' ./database-sqlite3.h.patch
sed -i 's|+++ ./modified_files/|+++ minetest/src/database/|' ./database-files.patch
sed -i 's|+++ ./modified_files/|+++ minetest/src/|' ./filesys.patch
sed -i 's|+++ ./modified_files/|+++ minetest/src/|' ./main.patch


