class StorageManager {
    constructor() {
        this.storagePolicy = 'no-storage'; // 'no-storage' or 'indexeddb'
        this.idbManager = null; // Instance of IDBManager (from idb.js)
        this.lastKnownMtimesIDB = new Map(); // For IndexedDB: path -> mtime (timestamp)
        this.fs = null; // Reference to Module.FS

        this.WORLDS_SYNC_BASE_PATH = '/minetest/worlds';
        this.MODS_SYNC_BASE_PATH = '/minetest/mods'; // Assuming this is the target in WasmFS

        this.SYNC_INTERVAL = 10000; // 10 seconds
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

        if (!this.fs && this.storagePolicy === 'indexeddb') {
            console.error('StorageManager: Module.FS is required for IndexedDB storage but not provided.');
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
        }
        return Promise.resolve();
    }

    // --- IndexedDB Specific Methods ---
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
                    // Create directory if it doesn't exist
                    const dir = file.path.substring(0, file.path.lastIndexOf('/'));
                    if (dir && !this.fs.analyzePath(dir).exists) {
                        this.fs.mkdirTree(dir);
                    }
                    
                    // Ensure content is properly typed for writing to filesystem
                    // This is critical to avoid binary corruption
                    if (file.content) {
                        // If file.content is already a Uint8Array, use it directly
                        // Otherwise, convert it to ensure binary safety
                        const content = file.content instanceof Uint8Array ? 
                            file.content : 
                            new Uint8Array(file.content);
                            
                        this.fs.writeFile(file.path, content);
                        this.lastKnownMtimesIDB.set(file.path, file.mtime.getTime());
                    } else {
                        console.warn(`StorageManager-IDB: Empty content for file ${file.path}, skipping`);
                    }
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
     * Force clear all storage by recreating the database
     * This is a more drastic approach when regular clearing fails
     */
    async forceClearStorage() {
        try {
            console.log('StorageManager: Force clearing all storage data');
            
            // Set the storage policy to indexeddb if not already
            if (this.storagePolicy !== 'indexeddb') {
                console.warn('StorageManager: Storage policy was not set to indexeddb, forcing it for cleanup');
                this.storagePolicy = 'indexeddb';
            }
            
            // Close current database connection
            if (this.idbManager && this.idbManager.db) {
                this.idbManager.db.close();
                this.idbManager.db = null;
            }
            
            // Request deletion of the entire database
            const dbName = this.idbManager ? this.idbManager.dbName : 'MinetestWasmWorldsDB';
            await new Promise((resolve, reject) => {
                const request = indexedDB.deleteDatabase(dbName);
                request.onsuccess = () => {
                    console.log(`StorageManager: Successfully deleted database ${dbName}`);
                    resolve();
                };
                request.onerror = (event) => {
                    console.error(`StorageManager: Error deleting database ${dbName}`, event.target.error);
                    reject(event.target.error);
                };
            });
            
            // Recreate the database and manager
            this.idbManager = new IDBManager();
            await this.idbManager.initDB();
            
            // Recreate base directories
            await this.idbManager.storeDirectory(this.WORLDS_SYNC_BASE_PATH);
            await this.idbManager.storeDirectory(this.MODS_SYNC_BASE_PATH);
            
            // Clear memory map
            this.lastKnownMtimesIDB.clear();
            
            // Update stats
            await this.updateStorageStats();
            
            console.log('StorageManager: Database completely reset');
            return true;
        } catch (e) {
            console.error('StorageManager: Error force clearing storage', e);
            showError('Failed to force clear storage: ' + e.message);
            return false;
        }
    }

    /**
     * Clear storage data
     * @param {string} area - 'worlds', 'mods', or 'all'
     * @param {boolean} force - Whether to use force deletion (recreates database) when area is 'all'
     */
    async clearStorage(area = 'all', force = false) {
        if (!this.idbManager && this.storagePolicy === 'indexeddb') {
            console.error('StorageManager: Cannot clear storage without initialized IDBManager');
            return false;
        }
        
        try {
            // If force is true and we're clearing all, use forceClearStorage
            if (force && area === 'all') {
                return await this.forceClearStorage();
            }
            
            console.log(`StorageManager: Clearing storage area: ${area}`);
            
            if (area === 'worlds' || area === 'all') {
                if (this.storagePolicy === 'indexeddb') {
                    // Use deleteDirectory to properly clean up both files and directories
                    await this.idbManager.deleteDirectory(this.WORLDS_SYNC_BASE_PATH);
                    
                    // Recreate the base directory
                    await this.idbManager.storeDirectory(this.WORLDS_SYNC_BASE_PATH);
                    
                    console.log('StorageManager: Deleted all world files and directories from IndexedDB');
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
                    // Use deleteDirectory to properly clean up both files and directories
                    await this.idbManager.deleteDirectory(this.MODS_SYNC_BASE_PATH);
                    
                    // Recreate the base directory
                    await this.idbManager.storeDirectory(this.MODS_SYNC_BASE_PATH);
                    
                    console.log('StorageManager: Deleted all mod files and directories from IndexedDB');
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
}
