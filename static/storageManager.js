class StorageManager {
    constructor() {
        this.storagePolicy = 'no-storage'; // 'no-storage', 'indexeddb', 'directory'
        this.directoryHandle = null;
        this.idbManager = null; // Instance of IDBManager (from idb.js)
        this.lastKnownMtimesIDB = new Map(); // For IndexedDB: path -> mtime (timestamp)
        this.lastKnownMtimesDir = new Map(); // For Directory: path -> mtime (timestamp)
        this.fs = null; // Reference to Module.FS

        this.WORLDS_SYNC_BASE_PATH = '/minetest/worlds';
        this.MODS_SYNC_BASE_PATH = '/minetest/mods'; // Assuming this is the target in WasmFS

        this.SYNC_INTERVAL = 10000; // 10 seconds (decreased from 30 seconds)
        this.syncIntervalId = null;
        
        // Statistics tracking
        this.worldsStats = { 
            fileCount: 0,
            totalSize: 0,
            lastUpdate: null
        };
        this.modsStats = { 
            fileCount: 0,
            totalSize: 0,
            lastUpdate: null
        };
        
        // Sync tracking
        this.lastSyncTime = 0;
        this.syncTotalDuration = 0;
        this.syncCount = 0;
    }

    async initialize(storageOptions, moduleFS) {
        this.storagePolicy = storageOptions.policy;
        this.fs = moduleFS;

        console.log(`StorageManager: Initializing with policy - ${this.storagePolicy}`);

        if (!this.fs && (this.storagePolicy === 'indexeddb' || this.storagePolicy === 'directory')) {
            console.error('StorageManager: Module.FS is required for IndexedDB or Directory storage but not provided.');
            showError('Storage error: Module.FS not available. Using no-storage mode.');
            this.storagePolicy = 'no-storage'; // Fallback or error
            return Promise.reject('Module.FS not available');
        }

        if (this.storagePolicy === 'indexeddb') {
            if (typeof IDBManager === 'undefined') {
                console.error('StorageManager: IDBManager class not found. Make sure idb.js is loaded.');
                showError('Storage error: IDBManager not found. Using no-storage mode.');
                this.storagePolicy = 'no-storage'; // Fallback
                return Promise.reject('IDBManager not found');
            }
            this.idbManager = new IDBManager();
            try {
                await this.idbManager.initDB();
                console.log('StorageManager: IndexedDB initialized for persistence.');
                
                // Load worlds data from IndexedDB
                await this.initialLoadFromIDB(this.WORLDS_SYNC_BASE_PATH);
                
                // Also load mods data from IndexedDB
                await this.initialLoadFromIDB(this.MODS_SYNC_BASE_PATH);
                
                await this.updateStorageStats();
                showInfo('Storage: IndexedDB loaded successfully');
            } catch (e) {
                console.error('StorageManager: Failed to initialize IndexedDB backend.', e);
                showError('Storage error: Failed to initialize IndexedDB. Using no-storage mode.');
                this.storagePolicy = 'no-storage'; // Fallback on error
                return Promise.reject(e);
            }
        } else if (this.storagePolicy === 'directory') {
            if (!storageOptions.handle) {
                console.error('StorageManager: Directory storage policy selected, but no directory handle provided.');
                showError('Storage error: No directory handle provided. Using no-storage mode.');
                this.storagePolicy = 'no-storage'; // Fallback
                return Promise.reject('Directory handle not provided');
            }
            this.directoryHandle = storageOptions.handle;
            console.log('StorageManager: Using directory handle:', this.directoryHandle.name);
            
            try {
                // Verify permissions
                const permission = await this.directoryHandle.requestPermission({ mode: 'readwrite' });
                if (permission !== 'granted') {
                    console.error('StorageManager: Directory permissions not granted');
                    showError('Storage error: Directory permissions not granted. Using no-storage mode.');
                    return Promise.reject('Directory permissions not granted');
                }
                
                // Create necessary subdirectories in the handle
                await this.ensureDirectoryExists(this.directoryHandle, 'worlds');
                await this.ensureDirectoryExists(this.directoryHandle, 'mods');
                
                // Load from directory to WasmFS
                await this.initialLoadFromDirectory();
                await this.updateStorageStats();
                showInfo('Storage: Directory loaded successfully');
            } catch (e) {
                console.error('StorageManager: Failed to initialize Directory backend.', e);
                showError('Storage error: Failed to initialize directory storage. Using no-storage mode.');
                this.storagePolicy = 'no-storage'; // Fallback
                return Promise.reject(e);
            }
        }

        if (this.storagePolicy !== 'no-storage') {
            this.startPeriodicSync();
        }
        return Promise.resolve();
    }

    // --- IndexedDB Specific Methods (adapted from launcher.js) ---
    async initialLoadFromIDB(basePath) {
        if (!this.fs || !this.idbManager) {
            console.error('StorageManager-IDB: Module.FS or IDBManager not available for initial load.');
            return Promise.reject('FS or IDBManager not ready for IDB load');
        }
        
        console.log('StorageManager-IDB: Starting initial load from IndexedDB for path: ' + basePath);
        try {
            const files = await this.idbManager.getAllFiles(basePath);
            if (files.length === 0) {
                console.log('StorageManager-IDB: No files found in IndexedDB under ' + basePath + ' to preload.');
                return;
            }
            console.log(`StorageManager-IDB: Found ${files.length} file(s) to load into WasmFS.`);

            for (const file of files) {
                try {
                    const dir = file.path.substring(0, file.path.lastIndexOf('/'));
                    if (dir && !this.fs.analyzePath(dir).exists) {
                        this.fs.mkdirTree(dir);
                    }
                    this.fs.writeFile(file.path, file.content);
                    this.lastKnownMtimesIDB.set(file.path, file.mtime.getTime());
                } catch (e) {
                    console.error('StorageManager-IDB: Error writing file to WasmFS:', file.path, e);
                }
            }
            console.log('StorageManager-IDB: Finished loading files from IndexedDB into WasmFS for ' + basePath);
        } catch (e) {
            console.error('StorageManager-IDB: Error during initial load from IndexedDB:', e);
            throw e; 
        }
    }

    async persistToIDB() {
        if (!this.fs || !this.idbManager) return;
        
        const syncStartTime = performance.now();
        let filesProcessed = 0, filesSynced = 0, filesDeleted = 0;
        let worldsFilesSynced = 0, modsFilesSynced = 0;
        let totalSyncedSize = 0; // Track total size of synced files

        // Get all current files in IndexedDB to check for deletions
        const currentIdbFiles = await this.idbManager.getAllFiles();
        const existingPaths = new Set(); // Track paths that exist in WasmFS

        const scanDirectoryIDB = async (currentPath) => {
            let entries;
            try { 
                entries = this.fs.readdir(currentPath); 
            } catch (e) { 
                try {
                    const stat = this.fs.stat(currentPath);
                    filesProcessed++;
                    const currentMtimeMs = stat.mtime * 1000; 
                    const knownMtimeMs = this.lastKnownMtimesIDB.get(currentPath);
                    
                    // Mark this path as existing in WasmFS
                    existingPaths.add(currentPath);
                    
                    if (currentMtimeMs !== knownMtimeMs) {
                        const content = this.fs.readFile(currentPath, { encoding: 'binary' });
                        await this.idbManager.saveFile(currentPath, content, stat.mtime * 1000, stat.atime * 1000);
                        this.lastKnownMtimesIDB.set(currentPath, currentMtimeMs);
                        filesSynced++;
                        
                        const fileSize = content.length || 0;
                        totalSyncedSize += fileSize;
                        
                        // Track which area got synced
                        if (currentPath.startsWith(this.WORLDS_SYNC_BASE_PATH)) {
                            worldsFilesSynced++;
                        } else if (currentPath.startsWith(this.MODS_SYNC_BASE_PATH)) {
                            modsFilesSynced++;
                        }
                    }
                    return;
                } catch (statError) {
                    console.error('StorageManager-IDB: Error stating WasmFS entry:', currentPath, e, statError);
                    return;
                }
            }
            for (const entry of entries) {
                if (entry === '.' || entry === '..') continue;
                const fullPath = currentPath + (currentPath.endsWith('/') ? '' : '/') + entry;
                await scanDirectoryIDB(fullPath);
            }
        };
        
        try {
            // Sync both worlds and mods directories
            await scanDirectoryIDB(this.WORLDS_SYNC_BASE_PATH);
            await scanDirectoryIDB(this.MODS_SYNC_BASE_PATH);
            
            // Handle deletions - remove files from IndexedDB that no longer exist in WasmFS
            for (const file of currentIdbFiles) {
                // Only check files in our sync paths
                if ((file.path.startsWith(this.WORLDS_SYNC_BASE_PATH) || 
                     file.path.startsWith(this.MODS_SYNC_BASE_PATH)) && 
                    !existingPaths.has(file.path)) {
                    
                    await this.idbManager.deleteFile(file.path);
                    filesDeleted++;
                    this.lastKnownMtimesIDB.delete(file.path);
                }
            }
            
            const syncEndTime = performance.now();
            const syncDuration = syncEndTime - syncStartTime;
            this.syncTotalDuration += syncDuration;
            this.syncCount++;
            this.lastSyncTime = Date.now();
            
            // Format size for logging
            const formatSize = (bytes) => {
                if (bytes === 0) return '0 B';
                const sizes = ['B', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(1024));
                return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
            };
            
            if (filesSynced > 0 || filesDeleted > 0) {
                console.log(`StorageManager-IDB: Sync complete in ${syncDuration.toFixed(2)}ms. ${filesSynced}/${filesProcessed} files synced (${formatSize(totalSyncedSize)}), ${filesDeleted} files deleted.`);
                
                // Update stats after successful sync
                await this.updateStorageStats();
                
                // Only show notification if we synced significant number of files (avoid spamming)
                if (filesSynced >= 3 || filesDeleted > 0) {
                    showInfo(`Game data saved: ${filesSynced} files (${formatSize(totalSyncedSize)}) synced, ${filesDeleted} files deleted`);
                }
            } else {
                console.log(`StorageManager-IDB: Sync complete in ${syncDuration.toFixed(2)}ms. No changes detected.`);
            }
        } catch (e) { 
            console.error('StorageManager-IDB: Error during WasmFS to IDB sync:', e); 
        }
    }

    // --- Directory (File System API) Specific Methods ---
    
    // Helper function to ensure directory exists in the FileSystem API
    async ensureDirectoryExists(parentHandle, dirName) {
        try {
            return await parentHandle.getDirectoryHandle(dirName, { create: true });
        } catch (e) {
            console.error(`StorageManager-Dir: Error creating directory ${dirName}:`, e);
            throw e;
        }
    }

    // Helper function to get directory handle with path parts
    async getDirectoryFromPath(basePath) {
        if (!this.directoryHandle) return null;
        
        // Extract path segments (basePath format: "/minetest/worlds/my_world")
        const parts = basePath.split('/').filter(p => p); // Remove empty segments
        
        // For "/minetest/worlds" or "/minetest/mods" we need to determine which root folder
        if (parts.length >= 2) {
            if (parts[0] === 'minetest') {
                let currentHandle = this.directoryHandle;
                
                // Navigate to worlds or mods folder
                try {
                    if (parts[1] === 'worlds') {
                        currentHandle = await this.ensureDirectoryExists(currentHandle, 'worlds');
                        // Navigate further if needed
                        for (let i = 2; i < parts.length; i++) {
                            currentHandle = await this.ensureDirectoryExists(currentHandle, parts[i]);
                        }
                        return currentHandle;
                    } else if (parts[1] === 'mods') {
                        currentHandle = await this.ensureDirectoryExists(currentHandle, 'mods');
                        // Navigate further if needed
                        for (let i = 2; i < parts.length; i++) {
                            currentHandle = await this.ensureDirectoryExists(currentHandle, parts[i]);
                        }
                        return currentHandle;
                    }
                } catch (e) {
                    console.error('StorageManager-Dir: Error navigating to path:', basePath, e);
                    return null;
                }
            }
        }
        
        return null; // Invalid path or not found
    }

    async initialLoadFromDirectory() {
        if (!this.fs || !this.directoryHandle) {
            console.error('StorageManager-Dir: Module.FS or DirectoryHandle not available for initial load.');
            return Promise.reject('FS or DirectoryHandle not ready for directory load');
        }
        
        console.log('StorageManager-Dir: Starting initial load from Directory for paths: ' + 
            this.WORLDS_SYNC_BASE_PATH + ' and ' + this.MODS_SYNC_BASE_PATH);
        
        // Make sure base directories exist in WasmFS
        if (!this.fs.analyzePath(this.WORLDS_SYNC_BASE_PATH).exists) {
            this.fs.mkdirTree(this.WORLDS_SYNC_BASE_PATH);
        }
        
        if (!this.fs.analyzePath(this.MODS_SYNC_BASE_PATH).exists) {
            this.fs.mkdirTree(this.MODS_SYNC_BASE_PATH);
        }
        
        try {
            // Create a root for worlds
            const worldsHandle = await this.ensureDirectoryExists(this.directoryHandle, 'worlds');
            await this.loadDirectoryToWasmFS(worldsHandle, this.WORLDS_SYNC_BASE_PATH);
            
            // Create a root for mods
            const modsHandle = await this.ensureDirectoryExists(this.directoryHandle, 'mods');
            await this.loadDirectoryToWasmFS(modsHandle, this.MODS_SYNC_BASE_PATH);
            
            console.log('StorageManager-Dir: Finished loading files from Directory into WasmFS.');
        } catch (e) {
            console.error('StorageManager-Dir: Error during initial load from Directory:', e);
            throw e;
        }
    }

    async loadDirectoryToWasmFS(dirHandle, targetPath) {
        let filesLoaded = 0;
        
        const processDirectory = async (handle, currentPath) => {
            for await (const [name, entry] of handle.entries()) {
                const entryPath = `${currentPath}/${name}`;
                
                if (entry.kind === 'file') {
                    try {
                        const file = await entry.getFile();
                        const content = new Uint8Array(await file.arrayBuffer());
                        
                        // Make sure parent directory exists in WasmFS
                        const dir = entryPath.substring(0, entryPath.lastIndexOf('/'));
                        if (!this.fs.analyzePath(dir).exists) {
                            this.fs.mkdirTree(dir);
                        }
                        
                        // Write the file to WasmFS
                        this.fs.writeFile(entryPath, content);
                        // Store mtime in milliseconds
                        this.lastKnownMtimesDir.set(entryPath, file.lastModified);
                        filesLoaded++;
                        
                    } catch (e) {
                        console.error(`StorageManager-Dir: Error loading file ${entryPath}:`, e);
                    }
                } else if (entry.kind === 'directory') {
                    // Create directory in WasmFS if it doesn't exist
                    if (!this.fs.analyzePath(entryPath).exists) {
                        this.fs.mkdirTree(entryPath);
                    }
                    // Process subdirectory recursively
                    await processDirectory(entry, entryPath);
                }
            }
        };
        
        await processDirectory(dirHandle, targetPath);
        console.log(`StorageManager-Dir: Loaded ${filesLoaded} files from Directory to WasmFS.`);
    }

    async persistToDirectory() {
        if (!this.fs || !this.directoryHandle) return;
        
        const syncStartTime = performance.now();
        let filesProcessed = 0, filesSynced = 0, filesDeleted = 0;
        let worldsFilesSynced = 0, modsFilesSynced = 0;
        let totalSyncedSize = 0; // Track total size of synced files
        
        // Track existing files in WasmFS
        const existingPaths = new Set();
        
        // Map to store directory file paths for deletion check
        const directoryFilePaths = new Map(); // path -> FileHandle
        
        // Helper to scan directory structure in local filesystem
        const scanLocalDirectory = async (dirHandle, basePath) => {
            for await (const [name, entry] of dirHandle.entries()) {
                const relativePath = basePath + '/' + name;
                if (entry.kind === 'file') {
                    directoryFilePaths.set(relativePath, entry);
                } else if (entry.kind === 'directory') {
                    await scanLocalDirectory(entry, relativePath);
                }
            }
        };
        
        // Scan local directory to get file map
        try {
            const worldsHandle = await this.directoryHandle.getDirectoryHandle('worlds', { create: true });
            await scanLocalDirectory(worldsHandle, this.WORLDS_SYNC_BASE_PATH);
            
            const modsHandle = await this.directoryHandle.getDirectoryHandle('mods', { create: true });
            await scanLocalDirectory(modsHandle, this.MODS_SYNC_BASE_PATH);
        } catch (e) {
            console.error('StorageManager-Dir: Error scanning local directory structure:', e);
        }
        
        // Convert WasmFS path to directory path parts and write file
        const writeToDirectoryHandle = async (wasmPath, content) => {
            try {
                // Extract target directory path
                const parts = wasmPath.split('/').filter(p => p);
                const fileName = parts.pop(); // Last part is the filename
                
                // Determine if we're handling worlds or mods
                const isWorlds = parts.length >= 2 && parts[0] === 'minetest' && parts[1] === 'worlds';
                const isMods = parts.length >= 2 && parts[0] === 'minetest' && parts[1] === 'mods';
                
                if (!isWorlds && !isMods) {
                    console.warn(`StorageManager-Dir: Path ${wasmPath} not in worlds or mods directory, skipping`);
                    return;
                }
                
                // Start from appropriate root
                let dirHandle = isWorlds ? 
                    await this.ensureDirectoryExists(this.directoryHandle, 'worlds') :
                    await this.ensureDirectoryExists(this.directoryHandle, 'mods');
                
                // Navigate to target directory (skip minetest/worlds or minetest/mods)
                for (let i = 2; i < parts.length; i++) {
                    dirHandle = await this.ensureDirectoryExists(dirHandle, parts[i]);
                }
                
                // Write the file
                const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(content);
                await writable.close();
                
                const fileSize = content.length || 0;
                totalSyncedSize += fileSize;
                filesSynced++;
                
                // Track which area got synced
                if (isWorlds) {
                    worldsFilesSynced++;
                } else if (isMods) {
                    modsFilesSynced++;
                }
                
                return true;
                
            } catch (e) {
                console.error(`StorageManager-Dir: Error writing file ${wasmPath} to directory:`, e);
                return false;
            }
        };
        
        // Scan WasmFS directory recursively
        const scanDirectoryDir = async (currentPath) => {
            let entries;
            try { 
                entries = this.fs.readdir(currentPath); 
            } catch (e) { 
                // Handle as file instead of directory
                try {
                    const stat = this.fs.stat(currentPath);
                    filesProcessed++;
                    const currentMtimeMs = stat.mtime * 1000; 
                    const knownMtimeMs = this.lastKnownMtimesDir.get(currentPath);
                    
                    // Mark path as existing in WasmFS
                    existingPaths.add(currentPath);
                    
                    if (currentMtimeMs !== knownMtimeMs) {
                        const content = this.fs.readFile(currentPath, { encoding: 'binary' });
                        if (await writeToDirectoryHandle(currentPath, content)) {
                            this.lastKnownMtimesDir.set(currentPath, currentMtimeMs);
                        }
                    }
                    return;
                } catch (statError) {
                    console.error('StorageManager-Dir: Error stating WasmFS entry:', currentPath, e, statError);
                    return;
                }
            }
            
            // Process directory entries
            for (const entry of entries) {
                if (entry === '.' || entry === '..') continue;
                const fullPath = currentPath + (currentPath.endsWith('/') ? '' : '/') + entry;
                await scanDirectoryDir(fullPath);
            }
        };
        
        try {
            // Sync both worlds and mods directories
            await scanDirectoryDir(this.WORLDS_SYNC_BASE_PATH);
            await scanDirectoryDir(this.MODS_SYNC_BASE_PATH);
            
            // Delete files from directory that no longer exist in WasmFS
            for (const [dirPath, fileHandle] of directoryFilePaths.entries()) {
                if ((dirPath.startsWith(this.WORLDS_SYNC_BASE_PATH) || 
                     dirPath.startsWith(this.MODS_SYNC_BASE_PATH)) && 
                    !existingPaths.has(dirPath)) {
                    
                    try {
                        // Get parent directory handle
                        const parts = dirPath.split('/').filter(p => p);
                        const fileName = parts.pop();
                        
                        // Start from root (worlds or mods)
                        let parentDirHandle = parts[1] === 'worlds' ? 
                            await this.directoryHandle.getDirectoryHandle('worlds', { create: false }) :
                            await this.directoryHandle.getDirectoryHandle('mods', { create: false });
                        
                        // Navigate to the parent directory
                        for (let i = 2; i < parts.length; i++) {
                            parentDirHandle = await parentDirHandle.getDirectoryHandle(parts[i], { create: false });
                        }
                        
                        // Remove the file
                        await parentDirHandle.removeEntry(fileName);
                        filesDeleted++;
                        this.lastKnownMtimesDir.delete(dirPath);
                    } catch (e) {
                        console.error(`StorageManager-Dir: Error deleting file ${dirPath}:`, e);
                    }
                }
            }
            
            const syncEndTime = performance.now();
            const syncDuration = syncEndTime - syncStartTime;
            this.syncTotalDuration += syncDuration;
            this.syncCount++;
            this.lastSyncTime = Date.now();
            
            // Format size for logging
            const formatSize = (bytes) => {
                if (bytes === 0) return '0 B';
                const sizes = ['B', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(1024));
                return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
            };
            
            if (filesSynced > 0 || filesDeleted > 0) {
                console.log(`StorageManager-Dir: Sync complete in ${syncDuration.toFixed(2)}ms. ${filesSynced}/${filesProcessed} files synced (${formatSize(totalSyncedSize)}), ${filesDeleted} files deleted.`);
                
                // Update stats after successful sync
                await this.updateStorageStats();
                
                // Only show notification if we synced significant number of files (avoid spamming)
                if (filesSynced >= 3 || filesDeleted > 0) {
                    showInfo(`Game data saved: ${filesSynced} files (${formatSize(totalSyncedSize)}) synced, ${filesDeleted} files deleted to local directory`);
                }
            } else {
                console.log(`StorageManager-Dir: Sync complete in ${syncDuration.toFixed(2)}ms. No changes detected.`);
            }
        } catch (e) { 
            console.error('StorageManager-Dir: Error during WasmFS to Directory sync:', e); 
            throw e; // Let the main syncNow method handle the error
        }
    }

    // --- Storage Statistics and Management ---
    
    /**
     * Calculate and update storage statistics
     * @returns {Object} Stats for worlds and mods
     */
    async updateStorageStats() {
        // Reset stats
        this.worldsStats = { fileCount: 0, totalSize: 0, lastUpdate: new Date() };
        this.modsStats = { fileCount: 0, totalSize: 0, lastUpdate: new Date() };
        
        if (this.storagePolicy === 'indexeddb' && this.idbManager) {
            try {
                // Get all worlds files from IndexedDB
                const worldFiles = await this.idbManager.getAllFiles(this.WORLDS_SYNC_BASE_PATH);
                this.worldsStats.fileCount = worldFiles.length;
                this.worldsStats.totalSize = 0;
                
                // Calculate total size of world files
                for (const file of worldFiles) {
                    this.worldsStats.totalSize += file.content ? file.content.length : 0;
                }
                
                // Get all mods files from IndexedDB
                const modFiles = await this.idbManager.getAllFiles(this.MODS_SYNC_BASE_PATH);
                this.modsStats.fileCount = modFiles.length;
                this.modsStats.totalSize = 0;
                
                // Calculate total size of mod files
                for (const file of modFiles) {
                    this.modsStats.totalSize += file.content ? file.content.length : 0;
                }
            } catch (e) {
                console.error('StorageManager: Error calculating IndexedDB stats:', e);
            }
        } else if (this.storagePolicy === 'directory' && this.directoryHandle) {
            try {
                this.worldsStats.fileCount = 0;
                this.worldsStats.totalSize = 0;
                this.modsStats.fileCount = 0;
                this.modsStats.totalSize = 0;
                
                // Helper function to recursively calculate size and count files in a directory
                const calculateDirStats = async (dirHandle, isWorlds) => {
                    const stats = isWorlds ? this.worldsStats : this.modsStats;
                    
                    for await (const [name, entry] of dirHandle.entries()) {
                        if (entry.kind === 'file') {
                            stats.fileCount++;
                            try {
                                const file = await entry.getFile();
                                stats.totalSize += file.size;
                            } catch (e) {
                                console.error(`Error getting file size for ${name}:`, e);
                            }
                        } else if (entry.kind === 'directory') {
                            await calculateDirStats(entry, isWorlds);
                        }
                    }
                };
                
                // Calculate worlds stats
                try {
                    const worldsHandle = await this.directoryHandle.getDirectoryHandle('worlds', { create: false });
                    await calculateDirStats(worldsHandle, true);
                } catch (e) {
                    // Worlds directory might not exist yet
                    console.log('Worlds directory not found or empty');
                }
                
                // Calculate mods stats
                try {
                    const modsHandle = await this.directoryHandle.getDirectoryHandle('mods', { create: false });
                    await calculateDirStats(modsHandle, false);
                } catch (e) {
                    // Mods directory might not exist yet
                    console.log('Mods directory not found or empty');
                }
            } catch (e) {
                console.error('StorageManager: Error calculating directory stats:', e);
            }
        } else if (this.fs) {
            // Fallback to WasmFS calculation if we have no persistent storage but have the filesystem
            const calculateDirStats = async (path, statsObj) => {
                try {
                    const scanDir = (dirPath) => {
                        try {
                            const entries = this.fs.readdir(dirPath);
                            
                            for (const entry of entries) {
                                if (entry === '.' || entry === '..') continue;
                                
                                const fullPath = dirPath + (dirPath.endsWith('/') ? '' : '/') + entry;
                                
                                try {
                                    const stat = this.fs.stat(fullPath);
                                    
                                    if (stat.mode & 16384) { // Directory
                                        scanDir(fullPath);
                                    } else { // File
                                        statsObj.fileCount++;
                                        
                                        // Get file size
                                        try {
                                            const content = this.fs.readFile(fullPath, { encoding: 'binary' });
                                            statsObj.totalSize += content.length || 0;
                                        } catch (e) {
                                            console.error(`Error reading file size: ${fullPath}`, e);
                                        }
                                    }
                                } catch (e) {
                                    console.error(`Error stating path: ${fullPath}`, e);
                                }
                            }
                        } catch (e) {
                            // Directory doesn't exist or can't be read
                            console.log(`Directory doesn't exist or can't be read: ${dirPath}`, e);
                        }
                    };
                    
                    scanDir(path);
                } catch (e) {
                    console.error(`Error calculating stats for ${path}`, e);
                }
            };
            
            // Calculate stats for worlds and mods
            await calculateDirStats(this.WORLDS_SYNC_BASE_PATH, this.worldsStats);
            await calculateDirStats(this.MODS_SYNC_BASE_PATH, this.modsStats);
        }
        
        return {
            worlds: this.worldsStats,
            mods: this.modsStats
        };
    }
    
    /**
     * Get formatted storage statistics
     */
    getFormattedStats() {
        const formatSize = (bytes) => {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };
        
        return {
            worlds: {
                fileCount: this.worldsStats.fileCount,
                totalSize: formatSize(this.worldsStats.totalSize),
                totalSizeBytes: this.worldsStats.totalSize,
                lastUpdate: this.worldsStats.lastUpdate
            },
            mods: {
                fileCount: this.modsStats.fileCount,
                totalSize: formatSize(this.modsStats.totalSize),
                totalSizeBytes: this.modsStats.totalSize,
                lastUpdate: this.modsStats.lastUpdate
            },
            total: {
                fileCount: this.worldsStats.fileCount + this.modsStats.fileCount,
                totalSize: formatSize(this.worldsStats.totalSize + this.modsStats.totalSize),
                totalSizeBytes: this.worldsStats.totalSize + this.modsStats.totalSize
            }
        };
    }
    
    /**
     * Clear storage data
     * @param {string} area - 'worlds', 'mods', or 'all'
     */
    async clearStorage(area = 'all') {
        if (!this.idbManager && this.storagePolicy === 'indexeddb') {
            console.error('StorageManager: Cannot clear storage without initialized IDBManager');
            return false;
        }
        
        try {
            if (area === 'worlds' || area === 'all') {
                if (this.storagePolicy === 'indexeddb') {
                    // Get all files that start with worlds path
                    const files = await this.idbManager.getAllFiles(this.WORLDS_SYNC_BASE_PATH);
                    // Delete each file
                    for (const file of files) {
                        await this.idbManager.deleteFile(file.path);
                    }
                    console.log(`StorageManager: Deleted ${files.length} world files from IndexedDB`);
                }
                
                // Clear memory map
                for (const [path] of this.lastKnownMtimesIDB.entries()) {
                    if (path.startsWith(this.WORLDS_SYNC_BASE_PATH)) {
                        this.lastKnownMtimesIDB.delete(path);
                    }
                }
            }
            
            if (area === 'mods' || area === 'all') {
                if (this.storagePolicy === 'indexeddb') {
                    // Get all files that start with mods path
                    const files = await this.idbManager.getAllFiles(this.MODS_SYNC_BASE_PATH);
                    // Delete each file
                    for (const file of files) {
                        await this.idbManager.deleteFile(file.path);
                    }
                    console.log(`StorageManager: Deleted ${files.length} mod files from IndexedDB`);
                }
                
                // Clear memory map
                for (const [path] of this.lastKnownMtimesIDB.entries()) {
                    if (path.startsWith(this.MODS_SYNC_BASE_PATH)) {
                        this.lastKnownMtimesIDB.delete(path);
                    }
                }
            }
            
            // Update stats
            await this.updateStorageStats();
            return true;
        } catch (e) {
            console.error('StorageManager: Error clearing storage', e);
            showError('Failed to clear storage: ' + e.message);
            return false;
        }
    }

    // --- General Sync Logic ---
    async syncNow() {
        try {
            if (this.storagePolicy === 'indexeddb') {
                await this.persistToIDB();
            } else if (this.storagePolicy === 'directory') {
                await this.persistToDirectory();
            }
        } catch (e) {
            console.error('StorageManager: Error during sync:', e);
            showWarning('Storage sync failed. Some changes may not be saved.');
        }
    }

    startPeriodicSync() {
        if (this.syncIntervalId) clearInterval(this.syncIntervalId);
        this.syncIntervalId = setInterval(() => this.syncNow(), this.SYNC_INTERVAL);
        console.log(`StorageManager: Periodic sync started (${this.storagePolicy}, interval: ${this.SYNC_INTERVAL}ms).`);
    }

    stopPeriodicSync() {
        if (this.syncIntervalId) clearInterval(this.syncIntervalId);
        this.syncIntervalId = null;
        console.log('StorageManager: Periodic sync stopped.');
    }

    async onTeardown() { // Call on window.beforeunload or similar
        this.stopPeriodicSync();
        console.log('StorageManager: Performing final sync on teardown...');
        try {
            await this.syncNow();
            console.log('StorageManager: Final sync attempt complete.');
        } catch (e) {
            console.error('StorageManager: Error during final sync:', e);
            // No need to show warning here since the page is unloading
        }
    }
}
