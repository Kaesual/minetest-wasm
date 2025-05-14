import { IDBManagerDexie } from './IDBManagerDexie';

interface StorageStats {
  fileCount: number;
  totalSize: number;
  lastUpdate: Date | null;
}

export class StorageManager {
  private idbManager: IDBManagerDexie | null = null;
  private fs: any = null;
  private storagePolicy: string = 'no-storage';
  
  private worldsStats: StorageStats = {
    fileCount: 0,
    totalSize: 0,
    lastUpdate: null
  };
  
  private modsStats: StorageStats = {
    fileCount: 0,
    totalSize: 0,
    lastUpdate: null
  };
  
  private readonly WORLDS_SYNC_BASE_PATH = '/minetest/worlds';
  private readonly MODS_SYNC_BASE_PATH = '/minetest/mods';
  
  constructor() {
    // Empty constructor - initialization happens with initialize()
  }
  
  // Return the current storage policy
  getStoragePolicy(): string {
    return this.storagePolicy;
  }
  
  // Initialize storage manager
  async initialize(storageOptions: { policy: string }, moduleFS: any): Promise<void> {
    if (this.storagePolicy === storageOptions.policy && this.fs === moduleFS) {
      console.log('StorageManager: Already initialized with identical policy and moduleFS');
      return;
    }

    this.storagePolicy = storageOptions.policy;
    this.fs = moduleFS;

    console.log(`StorageManager: Initializing with policy - ${storageOptions.policy}`);

    if (!moduleFS && storageOptions.policy === 'indexeddb') {
      console.error('StorageManager: Module.FS is required for IndexedDB storage but not provided.');
      this.storagePolicy = 'no-storage';
      return Promise.reject('Module.FS not available');
    }

    if (storageOptions.policy === 'indexeddb') {
      try {
        if (!this.idbManager) {
          const idbManagerInstance = new IDBManagerDexie();
          await idbManagerInstance.initDB();
          this.idbManager = idbManagerInstance;
          console.log('StorageManager: IndexedDB initialized for persistence.');
        }
        
        // Load worlds data from IndexedDB
        await this.copyIdbToFs(this.WORLDS_SYNC_BASE_PATH);
        
        // Also load mods data from IndexedDB
        await this.copyIdbToFs(this.MODS_SYNC_BASE_PATH);
        
        this.updateStorageStats(this.idbManager);
      } catch (e) {
        console.error('StorageManager: Failed to initialize IndexedDB backend.', e);
        this.storagePolicy = 'no-storage';
        return Promise.reject(e);
      }
    }
  }

  // Load files from IndexedDB to the filesystem
  private async copyIdbToFs(
    basePath: string
  ): Promise<void> {
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
          if (file.content) {
            const content = file.content instanceof Uint8Array ? 
              file.content : 
              new Uint8Array(file.content);
              
            this.fs.writeFile(file.path, content);
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

  // Update storage statistics
  private async updateStorageStats(idbManager: IDBManagerDexie): Promise<void> {
    try {
      // Get all worlds files from IndexedDB
      const worldFiles = await idbManager.getAllFiles(this.WORLDS_SYNC_BASE_PATH); 
      let worldsSize = 0;
      
      // Calculate total size of world files
      for (const file of worldFiles) {
        worldsSize += file.content ? file.content.byteLength : 0;
      }
      
      this.worldsStats = {
        fileCount: worldFiles.length,
        totalSize: worldsSize,
        lastUpdate: new Date()
      };
      
      // Get all mods files from IndexedDB
      const modFiles = await idbManager.getAllFiles(this.MODS_SYNC_BASE_PATH);
      let modsSize = 0;
      
      // Calculate total size of mod files
      for (const file of modFiles) {
        modsSize += file.content ? file.content.byteLength : 0;
      }
      
      this.modsStats = {
        fileCount: modFiles.length,
        totalSize: modsSize,
        lastUpdate: new Date()
      };
    } catch (e) {
      console.error('StorageManager: Error calculating IndexedDB stats:', e);
    }
  }

  // Get formatted stats for display
  getFormattedStats(): { worlds: string, mods: string } {
    const formatSize = (bytes: number): string => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };
    
    return {
      worlds: `${this.worldsStats.fileCount} files (${formatSize(this.worldsStats.totalSize)})`,
      mods: `${this.modsStats.fileCount} files (${formatSize(this.modsStats.totalSize)})`
    };
  }

  // Clear storage
  async clearStorage(area: string = 'all', force: boolean = false): Promise<void> {
    if (!this.idbManager) {
      console.error('StorageManager: No IDBManager available for clear operation');
      return;
    }
    
    try {
      if (area === 'all' || area === 'worlds') {
        await this.idbManager.deleteAllByPath(this.WORLDS_SYNC_BASE_PATH);
        this.worldsStats = {
          fileCount: 0,
          totalSize: 0,
          lastUpdate: new Date()
        };
      }
      
      if (area === 'all' || area === 'mods') {
        await this.idbManager.deleteAllByPath(this.MODS_SYNC_BASE_PATH);
        this.modsStats = {
          fileCount: 0,
          totalSize: 0,
          lastUpdate: new Date()
        };
      }
      
      console.log(`StorageManager: Cleared ${area} storage`);
    } catch (e) {
      console.error(`StorageManager: Error clearing ${area} storage:`, e);
    }
  }

  // Force clear all storage
  async forceClearStorage(): Promise<void> {
    if (!this.idbManager) {
      console.error('StorageManager: No IDBManager available for clear operation');
      return;
    }
    
    try {
      await this.idbManager.clearDatabase();
      this.worldsStats = {
        fileCount: 0,
        totalSize: 0,
        lastUpdate: new Date()
      };
      this.modsStats = {
        fileCount: 0,
        totalSize: 0,
        lastUpdate: new Date()
      };
      console.log('StorageManager: Force cleared all storage');
    } catch (e) {
      console.error('StorageManager: Error force clearing storage:', e);
    }
  }

  // Ensures a directory exists in IndexedDB
  ensureDirectoryExists(dirPath: string): void {
    if (!this.idbManager || this.storagePolicy !== 'indexeddb') {
      console.log("StorageManager: No IndexedDB manager or not using IndexedDB storage");
      return;
    }
    
    try {
      this.idbManager.storeDirectory(dirPath);
      console.log(`StorageManager: Ensured directory exists: ${dirPath}`);
    } catch (e) {
      console.error(`StorageManager: Error ensuring directory exists: ${dirPath}`, e);
    }
  }

  // Persists a file to IndexedDB
  persistFile(filePath: string, content: Uint8Array): void {
    if (!this.idbManager || this.storagePolicy !== 'indexeddb') {
      console.log("StorageManager: No IndexedDB manager or not using IndexedDB storage");
      return;
    }
    
    try {
      this.idbManager.saveFile(filePath, content);
      console.log(`StorageManager: Persisted file: ${filePath}`);
      
      // Update stats if this is a world or mod file
      if (filePath.startsWith(this.WORLDS_SYNC_BASE_PATH) || filePath.startsWith(this.MODS_SYNC_BASE_PATH)) {
        setTimeout(() => {
          if (this.idbManager) this.updateStorageStats(this.idbManager);
        }, 1000);
      }
    } catch (e) {
      console.error(`StorageManager: Error persisting file: ${filePath}`, e);
    }
  }

  // Deletes a directory from IndexedDB
  deleteDirectory(dirPath: string): void {
    if (!this.idbManager || this.storagePolicy !== 'indexeddb') {
      console.log("StorageManager: No IndexedDB manager or not using IndexedDB storage");
      return;
    }
    
    try {
      this.idbManager.deleteDirectory(dirPath);
      console.log(`StorageManager: Deleted directory: ${dirPath}`);
      
      // Update stats if this is a world or mod directory
      if (dirPath.startsWith(this.WORLDS_SYNC_BASE_PATH) || dirPath.startsWith(this.MODS_SYNC_BASE_PATH)) {
        setTimeout(() => {
          if (this.idbManager) this.updateStorageStats(this.idbManager);
        }, 1000);
      }
    } catch (e) {
      console.error(`StorageManager: Error deleting directory: ${dirPath}`, e);
    }
  }
} 