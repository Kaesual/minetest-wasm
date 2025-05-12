#pragma once

#include <string>

/**
 * Notify JavaScript about file changes for WASM synchronization
 * @param path Path to the file that was modified
 */
void notify_file_modified(const std::string &path);

/**
 * Notify JavaScript about file/directory deletions for WASM synchronization
 * @param path Path to the file or directory that was deleted
 */
void notify_file_deleted(const std::string &path);