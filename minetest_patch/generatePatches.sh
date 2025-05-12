#!/bin/bash
diff -Naur ../sources/minetest/src/database/database-sqlite3.cpp ./modified_files/database-sqlite3.cpp > ./database-sqlite3.patch
diff -Naur ../sources/minetest/src/database/database-files.cpp ./modified_files/database-files.cpp > ./database-files.patch
diff -Naur ../sources/minetest/src/filesys.cpp ./modified_files/filesys.cpp > ./filesys.patch
diff -Naur ../sources/minetest/src/CMakeLists.txt ./modified_files/CMakeLists.txt > ./CMakeLists.patch

sed -i 's|--- ../sources/|--- |' ./CMakeLists.patch
sed -i 's|--- ../sources/|--- |' ./database-sqlite3.patch
sed -i 's|--- ../sources/|--- |' ./database-files.patch
sed -i 's|--- ../sources/|--- |' ./filesys.patch

sed -i 's|+++ ./modified_files/|+++ minetest/src/|' ./CMakeLists.patch
sed -i 's|+++ ./modified_files/|+++ minetest/src/database/|' ./database-sqlite3.patch
sed -i 's|+++ ./modified_files/|+++ minetest/src/database/|' ./database-files.patch
sed -i 's|+++ ./modified_files/|+++ minetest/src/|' ./filesys.patch


