#include "notify_fs.h"
#include <emscripten.h>

void notify_file_modified(const std::string &path)
{
    // Use EM_ASM to directly call JavaScript to report the file change
    EM_ASM({
        if (Module.onFileChange && typeof Module.onFileChange === 'function')
            Module.onFileChange(UTF8ToString($0));
    }, path.c_str());
}

void notify_file_deleted(const std::string &path)
{
    // Use EM_ASM to directly call JavaScript to report the file/directory deletion
    EM_ASM({
        if (Module.onFileDelete && typeof Module.onFileDelete === 'function')
            Module.onFileDelete(UTF8ToString($0));
    }, path.c_str());
}