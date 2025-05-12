'use strict';

// These are relative paths
const RELEASE_DIR = '%__RELEASE_UUID__%'; // set by build_www.sh
const DEFAULT_PACKS_DIR = RELEASE_DIR + '/packs';

const WORLDS_DIR = '/minetest'; // Minetest worlds are found here

const rtCSS = `
body {
  font-family: arial;
  margin: 0;
  padding: none;
  background-color: black;
}

.emscripten {
  color: #aaaaaa;
  padding-right: 0;
  margin-left: auto;
  margin-right: auto;
  display: block;
}

div.emscripten {
  text-align: center;
  width: 100%;
}

/* the canvas *must not* have any border or padding, or mouse coords will be wrong */
canvas.emscripten {
  border: 0px none;
  background-color: black;
}

#controls {
  display: inline-block;
  vertical-align: top;
	height: 25px;
}

.console {
  width: 100%;
  margin: 0 auto;
  margin-top: 0px;
  border-left: 0px;
  border-right: 0px;
  padding-left: 0px;
  padding-right: 0px;
  display: block;
  background-color: black;
  color: white;
  font-family: 'Lucida Console', Monaco, monospace;
  outline: none;
}
`;

const rtHTML = `
  <div id="header">

  <div class="emscripten">
    <span id="controls">
      <span>
        <select id="resolution" onchange="fixGeometry()">
          <option value="high">High Res</option>
          <option value="medium">Medium</option>
          <option value="low">Low Res</option>
        </select>
      </span>
      <span>
        <select id="aspectRatio" onchange="fixGeometry()">
          <option value="any">Fit Screen</option>
          <option value="4:3">4:3</option>
          <option value="16:9">16:9</option>
          <option value="5:4">5:4</option>
          <option value="21:9">21:9</option>
          <option value="32:9">32:9</option>
          <option value="1:1">1:1</option>
        </select>
      </span>
      <span><input id="console_button" type="button" value="Show Console" onclick="consoleToggle()"></span>
      <span>(full screen: try F11 or Command+Shift+F)</span>
    </span>
    <div id="progressbar_div" style="display: none">
      <progress id="progressbar" value="0" max="100">0%</progress>
    </div>
  </div>

  </div>

  <div class="emscripten" id="canvas_container">
  </div>

  <div id="footer">
    <textarea id="console_output" class="console" rows="8" style="display: none; height: 200px"></textarea>
  </div>
`;

// The canvas needs to be created before the wasm module is loaded.
// It is not attached to the document until activateBody()
const mtCanvas = document.createElement('canvas');
mtCanvas.className = "emscripten";
mtCanvas.id = "canvas";
mtCanvas.oncontextmenu = (event) => {
  event.preventDefault();
};
mtCanvas.tabIndex = "-1";
mtCanvas.width = 1024;
mtCanvas.height = 600;

var consoleButton;
var consoleOutput;
var progressBar;
var progressBarDiv;

function activateBody() {
    const extraCSS = document.createElement("style");
    extraCSS.innerText = rtCSS;
    document.head.appendChild(extraCSS);

    // Replace the entire body
    document.body.style = '';
    document.body.className = '';
    document.body.innerHTML = '';

    const mtContainer = document.createElement('div');
    mtContainer.innerHTML = rtHTML;
    document.body.appendChild(mtContainer);

    const canvasContainer = document.getElementById('canvas_container');
    canvasContainer.appendChild(mtCanvas);

    setupResizeHandlers();

    consoleButton = document.getElementById('console_button');
    consoleOutput = document.getElementById('console_output');
    // Triggers the first and all future updates
    consoleUpdate();

    progressBar = document.getElementById('progressbar');
    progressBarDiv = document.getElementById('progressbar_div');
    updateProgressBar(0, 0);
}

var PB_bytes_downloaded = 0;
var PB_bytes_needed = 0;
function updateProgressBar(doneBytes, neededBytes) {
    PB_bytes_downloaded += doneBytes;
    PB_bytes_needed += neededBytes;
    if (progressBar) {
        progressBarDiv.style.display = (PB_bytes_downloaded == PB_bytes_needed) ? "none" : "block";
        const pct = PB_bytes_needed ? Math.round(100 * PB_bytes_downloaded / PB_bytes_needed) : 0;
        progressBar.value = `${pct}`;
        progressBar.innerText = `${pct}%`;
    }
}

// Singleton
var mtLauncher = null;

class LaunchScheduler {
    constructor() {
        this.conditions = new Map();
        window.requestAnimationFrame(this.invokeCallbacks.bind(this));
    }

    isSet(name) {
        return this.conditions.get(name)[0];
    }

    addCondition(name, startCallback = null, deps = []) {
        this.conditions.set(name, [false, new Set(), startCallback]);
        for (const depname of deps) {
            this.addDep(name, depname);
        }
    }

    addDep(name, depname) {
        if (!this.isSet(depname)) {
            this.conditions.get(name)[1].add(depname);
        }
    }

    setCondition(name) {
        if (this.isSet(name)) {
            throw new Error('Scheduler condition set twice');
        }
        this.conditions.get(name)[0] = true;
        this.conditions.forEach(v => {
            v[1].delete(name);
        });
        window.requestAnimationFrame(this.invokeCallbacks.bind(this));
    }

    clearCondition(name, newCallback = null, deps = []) {
        if (!this.isSet(name)) {
            throw new Error('clearCondition called on unset condition');
        }
        const arr = this.conditions.get(name);
        arr[0] = false;
        arr[1] = new Set(deps);
        arr[2] = newCallback;
    }

    invokeCallbacks() {
        const callbacks = [];
        this.conditions.forEach(v => {
            if (!v[0] && v[1].size == 0 && v[2] !== null) {
                callbacks.push(v[2]);
                v[2] = null;
            }
        });
        callbacks.forEach(cb => cb());
    }
}
const mtScheduler = new LaunchScheduler();

// --- START WasmFS Persistence Logic ---
let persistenceInitialized = false;
let idbManager = null; // Will be instance of IDBManager
let storageManager = null; // Will be instance of StorageManager
let lastKnownMtimes = new Map(); // path -> mtime (timestamp)
const WORLDS_SYNC_BASE_PATH = '/minetest/worlds'; // Only sync this subtree

async function initialLoadFromIDB() {
    if (!Module.FS || !idbManager) {
        console.error('initialLoadFromIDB: Module.FS or IDBManager not available.');
        return Promise.reject('FS or IDBManager not ready');
    }
    console.log('WasmFS_IDB: Starting initial load from IndexedDB for path: ' + WORLDS_SYNC_BASE_PATH);
    try {
        const files = await idbManager.getAllFiles(WORLDS_SYNC_BASE_PATH);
        if (files.length === 0) {
            console.log('WasmFS_IDB: No files found in IndexedDB under ' + WORLDS_SYNC_BASE_PATH + ' to preload.');
            return;
        }
        console.log(`WasmFS_IDB: Found ${files.length} file(s) in IndexedDB under ${WORLDS_SYNC_BASE_PATH} to load into WasmFS.`);

        for (const file of files) {
            try {
                // Ensure directory exists in WasmFS
                const dir = file.path.substring(0, file.path.lastIndexOf('/'));
                if (dir && !Module.FS.analyzePath(dir).exists) {
                    Module.FS.mkdirTree(dir);
                    // console.log('WasmFS_IDB: Created directory in WasmFS: ' + dir);
                }
                Module.FS.writeFile(file.path, file.content); // content is Uint8Array
                lastKnownMtimes.set(file.path, file.mtime.getTime()); // Store original mtime
                // console.log('WasmFS_IDB: Loaded file from IDB to WasmFS: ' + file.path);

                // Optionally, try to set mtime/atime if FS.utime is available and works
                // This is often not fully supported or might not behave as expected.
                // if (Module.FS.utime) {
                //     try {
                //         Module.FS.utime(file.path, file.atime.getTime(), file.mtime.getTime());
                //     } catch (e) {
                //         console.warn('WasmFS_IDB: Could not set mtime/atime for ', file.path, e);
                //     }
                // }
            } catch (e) {
                console.error('WasmFS_IDB: Error writing file to WasmFS:', file.path, e);
            }
        }
        console.log('WasmFS_IDB: Finished loading files from IndexedDB into WasmFS.');
    } catch (e) {
        console.error('WasmFS_IDB: Error during initial load from IndexedDB:', e);
        throw e; // Re-throw to be caught by initializePersistentFS
    }
}

async function initializePersistentFS(callback) {
    console.log('WasmFS_IDB: Attempting to initialize persistent storage using IndexedDB.');
    
    if (!idbManager) {
        idbManager = new IDBManager(); // Assuming IDBManager is globally available via idb.js
    }

    try {
        await idbManager.initDB();
        console.log('WasmFS_IDB: IndexedDB initialized.');

        // Ensure base WORLDS_DIR and WORLDS_DIR + '/worlds' exist in WasmFS (Minetest might create these anyway)
        // This is more for sanity checking and ensuring our sync logic has a base to scan.
        if (Module && Module.FS) {
            if (!Module.FS.analyzePath(WORLDS_DIR).exists) {
                Module.FS.mkdirTree(WORLDS_DIR);
                console.log('WasmFS_IDB: Created base directory in WasmFS: ' + WORLDS_DIR);
            }
            const fullWorldsPath = WORLDS_DIR + '/worlds'; // This is WORLDS_SYNC_BASE_PATH
            if (!Module.FS.analyzePath(fullWorldsPath).exists) {
                Module.FS.mkdirTree(fullWorldsPath);
                console.log('WasmFS_IDB: Created worlds subdirectory in WasmFS: ' + fullWorldsPath);
            }
        } else {
            console.error('WasmFS_IDB: Module.FS not available for directory pre-creation.');
            // Continue, as initialLoadFromIDB will also check Module.FS
        }

        await initialLoadFromIDB(); // Load data from IDB into WasmFS

        persistenceInitialized = true;
        console.log('WasmFS_IDB: Initial persistence setup complete. Files loaded from IDB to WasmFS.');
        if (callback) callback(null);

    } catch (e) {
        console.error('WasmFS_IDB: Error during IndexedDB persistence setup: ', e);
        persistenceInitialized = false; 
        if (callback) callback(e);
    }
}

async function persistFS() {
    if (!persistenceInitialized || !Module.FS || !idbManager) {
        // console.warn('WasmFS_IDB: Cannot persist, not initialized or FS/IDBManager not available.');
        return;
    }

    // console.log('WasmFS_IDB: Starting periodic sync from WasmFS to IndexedDB for path: ' + WORLDS_SYNC_BASE_PATH);
    let filesProcessed = 0;
    let filesSynced = 0;

    async function scanDirectory(currentPath) {
        let entries;
        try {
            entries = Module.FS.readdir(currentPath);
        } catch (e) {
            // If readdir fails, it might be a file, or an inaccessible directory/error.
            // We rely on the fact that `currentPath` itself was listed by a parent readdir call,
            // or is the initial WORLDS_SYNC_BASE_PATH.
            // If it is the base path and readdir fails, something is very wrong.
            if (currentPath === WORLDS_SYNC_BASE_PATH && e.message.includes('No such file or directory')) {
                 console.warn('WasmFS_IDB: WORLDS_SYNC_BASE_PATH does not exist in WasmFS, skipping scan: ' + currentPath, e);
                 return; // Nothing to scan if base path is gone
            }
            // Assume it's a file if readdir fails for a path we know should exist (from parent scan)
            // and the error isn't about the base path itself missing.
            // We will try to stat it as a file.
            try {
                const stat = Module.FS.stat(currentPath);
                // If stat succeeds, and readdir failed, it strongly implies it's a file.
                filesProcessed++;
                const currentMtimeMs = stat.mtime * 1000; // Convert seconds to milliseconds
                const knownMtimeMs = lastKnownMtimes.get(currentPath); // Already in ms

                if (currentMtimeMs !== knownMtimeMs) {
                    // console.log(`WasmFS_IDB: File changed (or new): ${currentPath}, mtime: ${new Date(currentMtimeMs)} (known: ${knownMtimeMs ? new Date(knownMtimeMs) : 'N/A'})`);
                    const content = Module.FS.readFile(currentPath, { encoding: 'binary' });
                    // Pass mtime & atime in milliseconds to IDBManager
                    await idbManager.saveFile(currentPath, content, stat.mtime * 1000, stat.atime * 1000);
                    lastKnownMtimes.set(currentPath, currentMtimeMs);
                    filesSynced++;
                }
                return; // It was a file, processed.
            } catch (statError) {
                // If both readdir and stat fail for an entry known from parent, log and skip.
                console.error('WasmFS_IDB: Error stating WasmFS entry (and readdir failed, so not a typical dir): ', currentPath, 'readdir error:', e, 'stat error:', statError);
                return;
            }
        }

        // If readdir succeeded, it's a directory.
        for (const entry of entries) {
            if (entry === '.' || entry === '..') continue;
            const fullPath = currentPath + (currentPath.endsWith('/') ? '' : '/') + entry;
            await scanDirectory(fullPath); // Recurse for sub-items (which could be files or dirs)
        }
    }

    try {
        await scanDirectory(WORLDS_SYNC_BASE_PATH);
        if (filesSynced > 0) {
            console.log(`WasmFS_IDB: Sync complete. Processed ${filesProcessed} WasmFS files, synced ${filesSynced} to IndexedDB.`);
        }
    } catch (e) {
        console.error('WasmFS_IDB: Error during WasmFS to IndexedDB sync process:', e);
    }
}

// --- END WasmFS Persistence Logic ---

function loadIDBScript(callback) {
    // If already loaded, just run callback
    if (typeof IDBManager !== 'undefined') {
        console.log('idb.js already loaded, skipping load.');
        loadStorageManagerScript(callback);
        return;
    }

    const idbScript = document.createElement('script');
    idbScript.src = RELEASE_DIR + "/idb.js"; // Assuming idb.js is in the same directory (static/)
    idbScript.onload = () => {
        console.log('idb.js loaded successfully.');
        loadStorageManagerScript(callback);
    };
    idbScript.onerror = () => {
        console.error('Failed to load idb.js!');
        showError('Critical error: Could not load IndexedDB helper. Saves will not work.');
        // Potentially block further execution or allow launch without persistence
        if (callback) callback(new Error('Failed to load idb.js'));
    };
    document.head.appendChild(idbScript);
}

function loadStorageManagerScript(callback) {
    // If already loaded, just run callback
    if (typeof StorageManager !== 'undefined') {
        console.log('storageManager.js already loaded, skipping load.');
        if (callback) callback();
        return;
    }

    const storageScript = document.createElement('script');
    storageScript.src = RELEASE_DIR + "/storageManager.js"; 
    storageScript.onload = () => {
        console.log('storageManager.js loaded successfully.');
        if (callback) callback();
    };
    storageScript.onerror = () => {
        console.error('Failed to load storageManager.js!');
        showError('Critical error: Could not load StorageManager. Saves will not work.');
        // Potentially block further execution or allow launch without persistence
        if (callback) callback(new Error('Failed to load storageManager.js'));
    };
    document.head.appendChild(storageScript);
}

function loadWasm() {
    // Start loading the wasm module
    // The module will call emloop_ready when it is loaded
    // and waiting for main() arguments.
    const mtModuleScript = document.createElement("script");
    mtModuleScript.type = "text/javascript";
    mtModuleScript.src = RELEASE_DIR + "/minetest.js";
    mtModuleScript.async = true;
    document.head.appendChild(mtModuleScript);
}

function callMain() {
    const fullargs = [ './minetest', ...mtLauncher.args.toArray() ];
    const [argc, argv] = makeArgv(fullargs);
    emloop_invoke_main(argc, argv);
    // Pausing and unpausing here gives the browser time to redraw the DOM
    // before Minetest freezes the main thread generating the world. If this
    // is not done, the page will stay frozen for several seconds
    emloop_request_animation_frame();
    mtScheduler.setCondition("main_called");
}

var emloop_pause;
var emloop_unpause;
var emloop_init_sound;
var emloop_invoke_main;
var emloop_install_pack;
var emloop_set_minetest_conf;
var irrlicht_want_pointerlock;
var irrlicht_force_pointerlock;
var irrlicht_resize;
var emsocket_init;
var emsocket_set_proxy;
var emsocket_set_vpn;

// Called when the wasm module is ready
function emloop_ready() {
    emloop_pause = cwrap("emloop_pause", null, []);
    emloop_unpause = cwrap("emloop_unpause", null, []);
    emloop_init_sound = cwrap("emloop_init_sound", null, []);
    emloop_invoke_main = cwrap("emloop_invoke_main", null, ["number", "number"]);
    emloop_install_pack = cwrap("emloop_install_pack", null, ["number", "number", "number"]);
    emloop_set_minetest_conf = cwrap("emloop_set_minetest_conf", null, ["number"]);
    irrlicht_want_pointerlock = cwrap("irrlicht_want_pointerlock", "number");
    irrlicht_force_pointerlock = cwrap("irrlicht_force_pointerlock", null);
    irrlicht_resize = cwrap("irrlicht_resize", null, ["number", "number"]);
    emsocket_init = cwrap("emsocket_init", null, []);
    emsocket_set_proxy = cwrap("emsocket_set_proxy", null, ["number"]);
    emsocket_set_vpn = cwrap("emsocket_set_vpn", null, ["number"]);

    console.log("emloop_ready called. Inspecting Module object:", Module);

    loadIDBScript(() => {
        // This callback is executed after idb.js and storageManager.js are loaded
        if (typeof IDBManager === 'undefined') {
            console.error("emloop_ready: IDBManager class not found even after idb.js attempted to load. Saves will not work.");
            mtScheduler.isReady = true; // Allow launch but persistence is broken
            showError("Critical error: IDBManager not available. Game saves will not work!");
            mtScheduler.setCondition("wasmReady"); // Still set wasmReady, as the wasm module itself might be fine
            return;
        }

        if (typeof StorageManager === 'undefined') {
            console.error("emloop_ready: StorageManager class not found even after storageManager.js attempted to load. Saves will not work.");
            mtScheduler.isReady = true; // Allow launch but persistence is broken
            showError("Critical error: StorageManager not available. Game saves will not work!");
            mtScheduler.setCondition("wasmReady"); // Still set wasmReady, as the wasm module itself might be fine
            return;
        }

        if (Module && Module.FS && typeof Module.FS.mkdir === 'function') {
            console.log("emloop_ready: Module.FS and Module.FS.mkdir are available.");
            
            // Create StorageManager instance - it will be initialized when launch() is called
            storageManager = new StorageManager();
            console.log('StorageManager instance created. Will be initialized with settings when launch() is called.');
            mtScheduler.isReady = true;
            mtScheduler.setCondition("wasmReady");

        } else {
            console.error("emloop_ready: Module.FS or Module.FS.mkdir is STILL NOT available here.");
            if (!Module) console.error("emloop_ready: Module object itself is not defined!");
            else if (!Module.FS) console.error("emloop_ready: Module.FS is not defined on Module object.");
            else if (typeof Module.FS.mkdir !== 'function') console.error("emloop_ready: Module.FS.mkdir is not a function.");
            else if (typeof Module.FS.syncfs !== 'function') console.error("emloop_ready: Module.FS.syncfs is not a function (though likely not needed for WasmFS native backends).");
            
            // If FS isn't available, persistence definitely won't work.
            // Allow launch but with a clear warning.
            mtScheduler.isReady = true;
            showError("Critical error: Emscripten FileSystem (Module.FS) is not available. Game saves will not work!");
            mtScheduler.setCondition("wasmReady");
        }
    });
}

// Called when the wasm module wants to force redraw before next frame
function emloop_request_animation_frame() {
    emloop_pause();
    window.requestAnimationFrame(() => { emloop_unpause(); });
}

function makeArgv(args) {
    // Assuming 4-byte pointers
    const argv = _malloc((args.length + 1) * 4);
    let i;
    for (i = 0; i < args.length; i++) {
        HEAPU32[(argv >>> 2) + i] = stringToNewUTF8(args[i]);
    }
    HEAPU32[(argv >>> 2) + i] = 0; // argv[argc] == NULL
    return [i, argv];
}

var consoleText = [];
var consoleLengthMax = 1000;
var consoleTextLast = 0;
var consoleDirty = false;
function consoleUpdate() {
    if (consoleDirty) {
        if (consoleText.length > consoleLengthMax) {
            consoleText = consoleText.slice(-consoleLengthMax);
        }
        consoleOutput.value = consoleText.join('');
        consoleOutput.scrollTop = consoleOutput.scrollHeight; // focus on bottom
        consoleDirty = false;
    }
    window.requestAnimationFrame(consoleUpdate);
}

function consoleToggle() {
    consoleOutput.style.display = (consoleOutput.style.display == 'block') ? 'none' : 'block';
    consoleButton.value = (consoleOutput.style.display == 'none') ? 'Show Console' : 'Hide Console';
    fixGeometry();
}

var enableTracing = false;
function consolePrint(text) {
    if (enableTracing) {
        console.trace(text);
    }
    consoleText.push(text + "\n");
    consoleDirty = true;
    if (mtLauncher && mtLauncher.onprint) {
        mtLauncher.onprint(text);
    }
}

var Module = {
    preRun: [],
    postRun: [],
    print: consolePrint,
    canvas: (function() {
        // As a default initial behavior, pop up an alert when webgl context is lost. To make your
        // application robust, you may want to override this behavior before shipping!
        // See http://www.khronos.org/registry/webgl/specs/latest/1.0/#5.15.2
        mtCanvas.addEventListener("webglcontextlost", function(e) { 
            showError('WebGL context lost. You will need to reload the page.'); 
            e.preventDefault(); 
        }, false);

        return mtCanvas;
    })(),
    setStatus: function(text) {
        if (text) Module.print('[wasm module status] ' + text);
    },
    totalDependencies: 0,
    monitorRunDependencies: function(left) {
        this.totalDependencies = Math.max(this.totalDependencies, left);
        if (!mtLauncher || !mtLauncher.onprogress) return;
        mtLauncher.onprogress('wasm_module', (this.totalDependencies-left) / this.totalDependencies);
    },
    // Handler for file changes reported by C++ code
    onFileChange: function(path, isDirectory) {
        console.log("File changed:", path, "isDirectory:", isDirectory);

        // Normalize the path to handle cases like "/minetest/bin/../worlds/asd/foo.txt"
        // We need to resolve relative path segments like ".." and "."
        function normalizePath(path) {
            // Split the path into segments
            const segments = path.split('/');
            const resultSegments = [];
            
            for (let i = 0; i < segments.length; i++) {
                const segment = segments[i];
                
                // Handle parent directory segments
                if (segment === '..') {
                    if (resultSegments.length > 0) {
                        resultSegments.pop();
                    }
                    continue;
                }
                
                // Add valid segments to the result
                resultSegments.push(segment);
            }
            
            // Reconstruct the path
            let normalizedPath = resultSegments.join('/');
            
            return normalizedPath;
        }
        
        // Normalize the path before processing
        const normalizedPath = normalizePath(path);
        if (normalizedPath.startsWith('/minetest/worlds/') || normalizedPath.startsWith('/minetest/mods/')) {
            // Only save worlds and mods to IndexedDB
            // Check if storage manager is available
            if (typeof storageManager !== 'undefined' && storageManager) {
                // For directories, we just need to ensure they exist in IndexedDB
                if (isDirectory) {
                    storageManager.ensureDirectoryExists(normalizedPath);
                } else {
                    // For files, read from WASMFS and persist to IndexedDB
                    try {
                        const content = FS.readFile(normalizedPath, { encoding: 'binary' });
                        storageManager.persistFile(normalizedPath, content);
                    } catch (e) {
                        console.error("Error persisting file:", normalizedPath, e);
                    }
                }
            }
        }
    },
    
    // Handler for file deletions reported by C++ code
    onFileDelete: function(path, isDirectory) {
        console.log("File deleted:", path, "isDirectory:", isDirectory);
        
        // Check if storage manager is available
        if (typeof storageManager !== 'undefined' && storageManager) {
            if (isDirectory) {
                // For directories, we need to delete the directory and all its contents
                storageManager.deleteDirectory(path);
            } else {
                // For single files, delete just that file
                storageManager.deleteFile(path);
            }
        }
    },
    
    // Handler for map block saves
    onMapBlockSaved: function(x, y, z) {
        console.log("Map block saved at:", x, y, z);
        
        // This is useful for tracking which parts of the world are being modified
        // We could use this to prioritize certain areas for syncing
        if (typeof storageManager !== 'undefined' && storageManager) {
            // The actual file path for the block is already handled by onFileChange
            // But we can use this to track block-level statistics if needed
            storageManager.recordBlockSave(x, y, z);
        }
    },
    
    // Handler for mod storage changes
    onModStorageChanged: function(modname, key) {
        console.log("Mod storage changed for mod:", modname, "key:", key);
        
        // We could use this to prioritize mod-related files for syncing
        if (typeof storageManager !== 'undefined' && storageManager) {
            // The actual file save will trigger onFileChange
            storageManager.recordModChange(modname, key);
        }
    },
};

Module['printErr'] = Module['print'];

// This is injected into workers so that out/err are sent to the main thread.
// This probably should be the default behavior, but doesn't seem to be for WasmFS.
const workerInject = `
  Module['print'] = (text) => {
    postMessage({cmd: 'callHandler', handler: 'print', args: [text], threadId: Module['_pthread_self']()});
  };
  Module['printErr'] = (text) => {
    postMessage({cmd: 'callHandler', handler: 'printErr', args: [text], threadId: Module['_pthread_self']()});
  };
  importScripts('minetest.js');
`;
Module['mainScriptUrlOrBlob'] = new Blob([workerInject], { type: "text/javascript" });



Module['onFullScreen'] = () => { fixGeometry(); };
window.onerror = function(event) {
    consolePrint('Exception thrown, see JavaScript console');
};

function resizeCanvas(width, height) {
    const canvas = mtCanvas;
    if (canvas.width != width || canvas.height != height) {
        canvas.width = width;
        canvas.height = height;
        canvas.widthNative = width;
        canvas.heightNative = height;
    }
    // Trigger SDL window resize.
    // This should happen automatically, not sure why it doesn't.
    irrlicht_resize(width, height);
}

function now() {
    return (new Date()).getTime();
}

// Only allow fixGeometry to be called every 250ms
// Firefox calls this way too often, causing flicker.
var fixGeometryPause = 0;
function fixGeometry(override) {
    if (!override && now() < fixGeometryPause) {
        return;
    }
    const resolutionSelect = document.getElementById('resolution');
    const aspectRatioSelect = document.getElementById('aspectRatio');
    var canvas = mtCanvas;
    var resolution = resolutionSelect.value;
    var aspectRatio = aspectRatioSelect.value;
    var screenX;
    var screenY;

    // Prevent the controls from getting focus
    canvas.focus();

    var isFullScreen = document.fullscreenElement ? true : false;
    if (isFullScreen) {
        screenX = screen.width;
        screenY = screen.height;
    } else {
        // F11-style full screen
        var controls = document.getElementById('controls');
        var maximized = !window.screenTop && !window.screenY;
        controls.style = maximized ? 'display: none' : '';

        var headerHeight = document.getElementById('header').offsetHeight;
        var footerHeight = document.getElementById('footer').offsetHeight;
        screenX = document.documentElement.clientWidth - 6;
        screenY = document.documentElement.clientHeight - headerHeight - footerHeight - 6;
    }

    // Size of the viewport (after scaling)
    var realX;
    var realY;
    if (aspectRatio == 'any') {
        realX = screenX;
        realY = screenY;
    } else {
        var ar = aspectRatio.split(':');
        var innerRatio = parseInt(ar[0]) / parseInt(ar[1]);
        var outerRatio = screenX / screenY;
        if (innerRatio <= outerRatio) {
            realX = Math.floor(innerRatio * screenY);
            realY = screenY;
        } else {
            realX = screenX;
            realY = Math.floor(screenX / innerRatio);
        }
    }

    // Native canvas resolution
    var resX;
    var resY;
    var scale = false;
    if (resolution == 'high') {
        resX = realX;
        resY = realY;
    } else if (resolution == 'medium') {
        resX = Math.floor(realX / 1.5);
        resY = Math.floor(realY / 1.5);
        scale = true;
    } else {
        resX = Math.floor(realX / 2.0);
        resY = Math.floor(realY / 2.0);
        scale = true;
    }
    resizeCanvas(resX, resY);

    if (scale) {
        var styleWidth = realX + "px";
        var styleHeight = realY + "px";
        canvas.style.setProperty("width", styleWidth, "important");
        canvas.style.setProperty("height", styleHeight, "important");
    } else {
        canvas.style.removeProperty("width");
        canvas.style.removeProperty("height");
    }
}

function setupResizeHandlers() {
    window.addEventListener('resize', () => { fixGeometry(); });

    // Needed to prevent special keys from triggering browser actions, like
    // F5 causing page reload.
    document.addEventListener('keydown', (e) => {
        // Allow F11 to go full screen
        if (e.code == "F11") {
            // On Firefox, F11 is animated. The window smoothly grows to
            // full screen over several seconds. During this transition, the 'resize'
            // event is triggered hundreds of times. To prevent flickering, have
            // fixGeometry ignore repeated calls, and instead resize every 500ms
            // for 2.5 seconds. By then it should be finished.
            fixGeometryPause = now() + 2000;
            for (var delay = 100; delay <= 2600; delay += 500) {
                setTimeout(() => { fixGeometry(true); }, delay);
            }
        }
    });
}

class MinetestArgs {
    constructor() {
        this.go = false;
        this.server = false;
        this.name = '';
        this.password = '';
        this.gameid = '';
        this.address = '';
        this.port = '';
        this.packs = [];
        this.extra = [];
    }

    toArray() {
        const args = [];
        if (this.go) args.push('--go');
        if (this.server) args.push('--server');
        if (this.name) args.push('--name', this.name);
        if (this.password) args.push('--password', this.password);
        if (this.gameid) args.push('--gameid', this.gameid);
        if (this.address) args.push('--address', this.address);
        if (this.port) args.push('--port', this.port.toString());
        args.push(...this.extra);
        return args;
    }

    toQueryString() {
        const params = new URLSearchParams();
        if (this.go) params.append('go', '');
        if (this.server) params.append('server', '');
        if (this.name) params.append('name', this.name);
        if (this.password) params.append('password', this.password);
        if (this.gameid) params.append('gameid', this.gameid);
        if (this.address) params.append('address', this.address);
        if (this.port) params.append('port', this.port.toString());
        const extra_packs = [];
        this.packs.forEach(v => {
            if (v != 'base' && v != 'minetest_game' && v != 'devtest' && v != this.gameid) {
                extra_packs.push(v);
            }
        });
        if (extra_packs.length) {
            params.append('packs', extra_packs.join(','));
        }
        if (this.extra.length) {
            params.append('extra', this.extra.join(','));
        }
        return params.toString();
    }

    static fromQueryString(qs) {
        const r = new MinetestArgs();
        const params = new URLSearchParams(qs);
        if (params.has('go')) r.go = true;
        if (params.has('server')) r.server = true;
        if (params.has('name')) r.name = params.get('name');
        if (params.has('password')) r.password = params.get('password');
        if (params.has('gameid')) r.gameid = params.get('gameid');
        if (params.has('address')) r.address = params.get('address');
        if (params.has('port')) r.port = parseInt(params.get('port'));
        if (r.gameid && r.gameid != 'minetest_game' && r.gameid != 'devtest' && r.gameid != 'base') {
            r.packs.push(r.gameid);
        }
        if (params.has('packs')) {
            params.get('packs').split(',').forEach(p => {
                if (!r.packs.includes(p)) {
                    r.packs.push(p);
                }
            });
        }
        if (params.has('extra')) {
            r.extra = params.get('extra').split(',');
        }
        return r;
    }
}

class MinetestLauncher {
    constructor() {
        if (mtLauncher !== null) {
            throw new Error("There can be only one launcher");
        }
        mtLauncher = this;
        this.args = null;
        this.onprogress = null; // function(name, percent done)
        this.onready = null; // function()
        this.onerror = null; // function(message)
        this.onprint = null; // function(text)
        this.addedPacks = new Set();
        this.vpn = null;
        this.serverCode = null;
        this.clientCode = null;
        this.proxyUrl = "wss://minetest.dustlabs.io/proxy";
        this.packsDir = DEFAULT_PACKS_DIR;
        this.packsDirIsCors = false;
        this.minetestConf = new Map();

        mtScheduler.addCondition("wasmReady", loadWasm);
        mtScheduler.addCondition("launch_called");
        mtScheduler.addCondition("ready", this.#notifyReady.bind(this), ['wasmReady']);
        mtScheduler.addCondition("main_called", callMain, ['ready', 'launch_called']);
        this.addPack('base');
    }

    setProxy(url) {
        this.proxyUrl = url;
    }

    /*
     * Set the url for the pack files directory
     * This can be relative or absolute.
     */
    setPacksDir(url, is_cors) {
        this.packsDir = url;
        this.packsDirIsCors = is_cors;
    }

    #notifyReady() {
        mtScheduler.setCondition("ready");
        if (this.onready) this.onready();
    }

    isReady() {
        return mtScheduler.isSet("ready");
    }

    // Must be set before launch()
    setVPN(serverCode, clientCode) {
        this.serverCode = serverCode;
        this.clientCode = clientCode;
        this.vpn = serverCode ? serverCode : clientCode;
    }

    // Set a key/value pair in minetest.conf
    // Overrides previous values of the same key
    setConf(key, value) {
        key = key.toString();
        value = value.toString();
        this.minetestConf.set(key, value);
    }

    // Get access to the WASM filesystem
    getFS() {
        if (typeof Module !== 'undefined' && Module.FS) {
            return Module.FS;
        }
        return null;
    }

    #renderMinetestConf() {
        let lines = [];
        for (const [k, v] of this.minetestConf.entries()) {
            lines.push(`${k} = ${v}\n`);
        }
        return lines.join('');
    }

    setLang(lang) {
        if (!SUPPORTED_LANGUAGES_MAP.has(lang)) {
            showWarning(`Invalid language code: ${lang}`);
        }
        this.setConf("language", lang);
    }

    // Returns pack status:
    //   0 - pack has not been added
    //   1 - pack is downloading
    //   2 - pack has been installed
    checkPack(name) {
       if (!this.addedPacks.has(name)) {
           return 0;
       }
       if (mtScheduler.isSet("installed:" + name)) {
           return 2;
       }
       return 1;
    }

    addPacks(packs) {
        for (const pack of packs) {
            this.addPack(pack);
        }
    }

    async addPack(name) {
        if (mtScheduler.isSet("launch_called")) {
            throw new Error("Cannot add packs after launch");
        }
        if (name == 'minetest_game' || name == 'devtest' || this.addedPacks.has(name))
            return;
        this.addedPacks.add(name);

        const fetchedCond = "fetched:" + name;
        const installedCond = "installed:" + name;

        let chunks = [];
        let received = 0;
        // This is done here instead of at the bottom, because it needs to
        // be delayed until after the 'wasmReady' condition.
        // TODO: Add the ability to `await` a condition instead.
        const installPack = () => {
            // Install
            const data = _malloc(received);
            let offset = 0;
            for (const arr of chunks) {
                HEAPU8.set(arr, data + offset);
                offset += arr.byteLength;
            }
            emloop_install_pack(stringToNewUTF8(name), data, received);
            _free(data);
            mtScheduler.setCondition(installedCond);
            if (this.onprogress) {
                this.onprogress(`download:${name}`, 1.0);
                this.onprogress(`install:${name}`, 1.0);
            }
        };
        mtScheduler.addCondition(fetchedCond, null);
        mtScheduler.addCondition(installedCond, installPack, ["wasmReady", fetchedCond]);
        mtScheduler.addDep("main_called", installedCond);

        const packUrl = this.packsDir + '/' + name + '.pack';
        let resp;
        try {
            resp = await fetch(packUrl, this.packsDirIsCors ? { credentials: 'omit' } : {});
        } catch (err) {
            if (this.onerror) {
                this.onerror(`${err}`);
            } else {
                showError(`Error loading ${packUrl}. Please refresh page`);
            }
            throw new Error(`${err}`);
        }
        // This could be null if the header is missing
        var contentLength = resp.headers.get('Content-Length');
        if (contentLength) {
            contentLength = parseInt(contentLength);
            updateProgressBar(0, contentLength);
        }
        let reader = resp.body.getReader();
        while (true) {
            const {done, value} = await reader.read();
            if (done) {
                break;
            }
            chunks.push(value);
            received += value.byteLength;
            if (contentLength) {
                updateProgressBar(value.byteLength, 0);
                if (this.onprogress) {
                    this.onprogress(`download:${name}`, received / contentLength);
                }
            }
        }
        mtScheduler.setCondition(fetchedCond);
    }

    // Launch minetest.exe <args>
    //
    // This must be called from a keyboard or mouse event handler,
    // after the 'onready' event has fired. (For this reason, it cannot
    // be called from the `onready` handler)
    launch(args, storageOptions = { policy: 'no-storage' }) {
        if (!this.isReady()) {
            throw new Error("launch called before onready");
        }
        if (!(args instanceof MinetestArgs)) {
            throw new Error("launch called without MinetestArgs");
        }
        if (mtScheduler.isSet("launch_called")) {
            throw new Error("launch called twice");
        }
        this.args = args;

        // Log the chosen storage options
        console.log("Storage policy selected:", storageOptions.policy);
        
        // Initialize StorageManager if available
        if (storageManager) {
            // This will happen asynchronously but we're not waiting for it
            storageManager.initialize(storageOptions, Module.FS)
                .then(() => {
                    console.log('StorageManager initialized successfully with policy:', storageOptions.policy);
                })
                .catch(err => {
                    console.error('StorageManager initialization failed:', err);
                    // Continue anyway with no-storage policy (StorageManager handles fallback internally)
                });
        } else {
            console.warn('StorageManager not available for persistence.');
        }

        if (this.args.gameid) {
            this.addPack(this.args.gameid);
        }
        this.addPacks(this.args.packs);
        activateBody();
        fixGeometry();
        if (this.minetestConf.size > 0) {
            const contents = this.#renderMinetestConf();
            console.log("minetest.conf is: ", contents);
            const confBuf = stringToNewUTF8(contents);
            emloop_set_minetest_conf(confBuf);
            _free(confBuf);
        }
        emloop_init_sound();
        // Setup emsocket
        // TODO: emsocket should export the helpers for this
        emsocket_init();
        const proxyBuf = stringToNewUTF8(this.proxyUrl);
        emsocket_set_proxy(proxyBuf);
        _free(proxyBuf);
        if (this.vpn) {
            const vpnBuf = stringToNewUTF8(this.vpn);
            emsocket_set_vpn(vpnBuf);
            _free(vpnBuf);
        }
        if (args.go) {
            irrlicht_force_pointerlock();
        }
        mtScheduler.setCondition("launch_called");
    }
}

// Pulled from builtin/mainmenu/settings/dlg_settings.lua
const SUPPORTED_LANGUAGES = [
	['be', "Беларуская [be]"],
	['bg', "Български [bg]"],
	['ca', "Català [ca]"],
	['cs', "Česky [cs]"],
	['cy', "Cymraeg [cy]"],
	['da', "Dansk [da]"],
	['de', "Deutsch [de]"],
	['el', "Ελληνικά [el]"],
	['en', "English [en]"],
	['eo', "Esperanto [eo]"],
	['es', "Español [es]"],
	['et', "Eesti [et]"],
	['eu', "Euskara [eu]"],
	['fi', "Suomi [fi]"],
	['fil', "Wikang Filipino [fil]"],
	['fr', "Français [fr]"],
	['gd', "Gàidhlig [gd]"],
	['gl', "Galego [gl]"],
	['hu', "Magyar [hu]"],
	['id', "Bahasa Indonesia [id]"],
	['it', "Italiano [it]"],
	['ja', "日本語 [ja]"],
	['jbo', "Lojban [jbo]"],
	['kk', "Қазақша [kk]"],
	['ko', "한국어 [ko]"],
	['ky', "Kırgızca / Кыргызча [ky]"],
	['lt', "Lietuvių [lt]"],
	['lv', "Latviešu [lv]"],
	['mn', "Монгол [mn]"],
	['mr', "मराठी [mr]"],
	['ms', "Bahasa Melayu [ms]"],
	['nb', "Norsk Bokmål [nb]"],
	['nl', "Nederlands [nl]"],
	['nn', "Norsk Nynorsk [nn]"],
	['oc', "Occitan [oc]"],
	['pl', "Polski [pl]"],
	['pt', "Português [pt]"],
	['pt_BR', "Português do Brasil [pt_BR]"],
	['ro', "Română [ro]"],
	['ru', "Русский [ru]"],
	['sk', "Slovenčina [sk]"],
	['sl', "Slovenščina [sl]"],
	['sr_Cyrl', "Српски [sr_Cyrl]"],
	['sr_Latn', "Srpski (Latinica) [sr_Latn]"],
	['sv', "Svenska [sv]"],
	['sw', "Kiswahili [sw]"],
	['tr', "Türkçe [tr]"],
	['tt', "Tatarça [tt]"],
	['uk', "Українська [uk]"],
	['vi', "Tiếng Việt [vi]"],
	['zh_CN', "中文 (简体) [zh_CN]"],
	['zh_TW', "正體中文 (繁體) [zh_TW]"],
];

const SUPPORTED_LANGUAGES_MAP = new Map(SUPPORTED_LANGUAGES);

function getDefaultLanguage() {
    const fuzzy = [];

    const url_params = new URLSearchParams(window.location.search);
    if (url_params.has("lang")) {
        const lang = url_params.get("lang");
        if (SUPPORTED_LANGUAGES_MAP.has(lang)) {
            return lang;
        }
        showWarning(`Invalid lang parameter: ${lang}`);
        return 'en';
    }

    for (let candidate of navigator.languages) {
        candidate = candidate.replaceAll('-', '_');

        if (SUPPORTED_LANGUAGES_MAP.has(candidate)) {
            return candidate;
        }

        // Try stripping off the country code
        const parts = candidate.split('_');
        if (parts.length > 2) {
            const rcandidate = parts.slice(0, 2).join('_');
            if (SUPPORTED_LANGUAGES_MAP.has(rcandidate)) {
                return rcandidate;
            }
        }

        // Try just matching the language code
        if (parts.length > 1) {
            if (SUPPORTED_LANGUAGES_MAP.has(parts[0])) {
                return parts[0];
            }
        }

        // Try fuzzy match (ignore country code of both)
        for (let entry of SUPPORTED_LANGUAGES) {
            if (entry[0].split('_')[0] == parts[0]) {
                fuzzy.push(entry[0]);
            }
        }
    }

    if (fuzzy.length > 0) {
        return fuzzy[0];
    }

    return 'en';
}

// Add these helper methods to the StorageManager class

/**
 * Ensures a directory exists in IndexedDB
 * @param {string} dirPath - Path to the directory
 */
StorageManager.prototype.ensureDirectoryExists = function(dirPath) {
    console.log("Ensuring directory exists in IndexedDB:", dirPath);
    // The actual implementation depends on how your IDB structure works
    // This might just be a record in the directories table or creating empty marker files
    
    if (this.idbManager) {
        this.idbManager.storeDirectory(dirPath);
    }
};

/**
 * Persists a file to IndexedDB
 * @param {string} filePath - Path to the file
 * @param {Uint8Array} content - File content as binary data
 */
StorageManager.prototype.persistFile = function(filePath, content) {
    console.log("Persisting file to IndexedDB:", filePath, "size:", content.length);
    
    if (this.idbManager) {
        this.idbManager.saveFile(filePath, content);
    }
};

/**
 * Deletes a file from IndexedDB
 * @param {string} filePath - Path to the file to delete
 */
StorageManager.prototype.deleteFile = function(filePath) {
    console.log("Deleting file from IndexedDB:", filePath);
    
    if (this.idbManager) {
        this.idbManager.deleteFile(filePath);
    }
};

/**
 * Deletes a directory and all its contents from IndexedDB
 * @param {string} dirPath - Path to the directory to delete
 */
StorageManager.prototype.deleteDirectory = function(dirPath) {
    console.log("Deleting directory from IndexedDB:", dirPath);
    
    if (this.idbManager) {
        // Get files in and under this directory and delete them
        this.idbManager.deleteDirectory(dirPath);
    }
};

/**
 * Records block saves for statistics
 * @param {number} x - Block X coordinate
 * @param {number} y - Block Y coordinate
 * @param {number} z - Block Z coordinate
 */
StorageManager.prototype.recordBlockSave = function(x, y, z) {
    // This method is optional - it can be used for statistics or prioritization
    // Currently just logs the save
    console.debug("Block saved at", x, y, z);
};

/**
 * Records mod storage changes for statistics
 * @param {string} modname - Name of the mod
 * @param {string} key - Key that was changed
 */
StorageManager.prototype.recordModChange = function(modname, key) {
    // This method is optional - it can be used for statistics or prioritization
    // Currently just logs the change
    console.debug("Mod storage changed:", modname, key);
};
