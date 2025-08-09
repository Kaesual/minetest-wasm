import { FileStats, IDBManagerDexie } from './IDBManagerDexie';
import { type MinetestConsole } from './GlobalContext';

interface StorageStats {
  fileCount: number;
  totalSize: number;
  lastUpdate: Date | null;
}

export class StorageManager {
  private idbManager: IDBManagerDexie | null = null;
  private storagePolicy: string = 'no-storage';
  private _isInitialized: boolean | Promise<boolean> = false;
  private _hasCopiedToModuleFS: boolean = false;
  
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

  private minetestConsole!: MinetestConsole;
  private activeWorld: string | null = null;
  private trackedWorlds: string[] = [];
  private worldSyncTimeout: any = undefined;
  private worldNamesToSync: Set<string> = new Set();
  private fileStats: Map<string, FileStats> = new Map();
  
  private readonly SYNC_DEBOUNCE_DELAY = 10_000;
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
  async initialize(storageOptions: { policy: string }, minetestConsole: MinetestConsole, copyToModuleFS: boolean = false): Promise<void> {
    this._isInitialized = new Promise<boolean>(async (resolve, reject) => {
      this.minetestConsole = minetestConsole;
      if (this.storagePolicy === storageOptions.policy) {
        this.minetestConsole.print('StorageManager: Already initialized with identical policy');
        resolve(true);
        return;
      }
  
      // If copyToModuleFS is set (and only then), Module.FS will be used
      if (copyToModuleFS) {
        if (!window.Module?.FS) {
          throw new Error('Module.FS is required for copyToModuleFS, but not available. This can happen if the Emscripten Module is not loaded yet.');
        }
        if (storageOptions.policy !== 'indexeddb') {
          throw new Error('Module.FS and policy indexeddb is required for copyToModuleFS, but not provided.');
        }
      }
  
      this.storagePolicy = storageOptions.policy;
      this.minetestConsole.print(`StorageManager: Initializing with policy - ${storageOptions.policy}`);
  
      if (storageOptions.policy === 'indexeddb') {
        try {
          if (!this.idbManager) {
            const idbManagerInstance = new IDBManagerDexie();
            await idbManagerInstance.initDB();
            this.idbManager = idbManagerInstance;
            this.minetestConsole.print('StorageManager: IndexedDB initialized for persistence.');
          }
          if (copyToModuleFS) {
            await this.copyToModuleFS();
          }
          await this.updateStorageStats();
        } catch (e) {
          console.error('StorageManager: Failed to initialize IndexedDB backend.', e);
          this.minetestConsole.printErr('StorageManager: Failed to initialize IndexedDB backend.');
          this.storagePolicy = 'no-storage';
          reject(e);
          return;
        }
      }
      resolve(true);
    });
    await this._isInitialized;
  }

  // Load files from IndexedDB to the filesystem
  private async copyIdbPathToModuleFS(
    basePath: string
  ): Promise<void> {
    if (!window.Module?.FS || !this.idbManager) {
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
          if (dir && !window.Module.FS.analyzePath(dir).exists) {
            window.Module.FS.mkdirTree(dir);
          }
          
          // Ensure content is properly typed for writing to filesystem
          if (file.content) {
            const content = file.content instanceof Uint8Array ? 
              file.content : 
              new Uint8Array(file.content);
              
            window.Module.FS.writeFile(file.path, content);
          } else {
            console.log(`StorageManager-IDB: Empty content for file ${file.path}, skipping`);
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
  private updateStorageStats(): void {
    try {
      // Get all worlds files from IndexedDB
      const worldFiles = Array.from(this.fileStats.entries());
      let worldsSize = 0;
      
      // Calculate total size of world files
      for (const file of worldFiles) {
        const isDirectory = (file[1].mode & 0x4000) === 0x4000;
        if (isDirectory) {
          continue;
        }
        worldsSize += file[1].size;
      }
      
      this.worldsStats = {
        fileCount: worldFiles.length,
        totalSize: worldsSize,
        lastUpdate: new Date()
      };
      
      // // Get all mods files from IndexedDB
      // const modFiles = await idbManager.getAllFiles(this.MODS_SYNC_BASE_PATH);
      // let modsSize = 0;
      
      // // Calculate total size of mod files
      // for (const file of modFiles) {
      //   modsSize += file.content ? file.content.byteLength : 0;
      // }
      
      // this.modsStats = {
      //   fileCount: modFiles.length,
      //   totalSize: modsSize,
      //   lastUpdate: new Date()
      // };
    } catch (e) {
      console.error('StorageManager: Error calculating IndexedDB stats:', e);
    }
  }

  private alwaysSync: string[] = [
    '/minetest/minetest.conf',
  ];

  private scheduleWorldSync(worldName: string): void {
    this.worldNamesToSync.add(worldName);
    if (this.worldSyncTimeout !== undefined) {
      return;
    }
    this.worldSyncTimeout = setTimeout(async () => {
      let changed = false;
      const recursiveSync = async (path: string) => {
        const filesAndDirectories = window.Module.FS.readdir(path);
        for (const name of filesAndDirectories) {
          if (name === "." || name === "..") {
            continue;
          }
          const filePath = path + '/' + name;
          const oldStats = this.fileStats.get(filePath);
          const newStats = window.Module.FS.stat(filePath);
          this.fileStats.set(filePath, newStats);
          let isDirectory = (newStats.mode & 0x4000) === 0x4000;
          if (isDirectory) {
            await this.ensureDirectoryExists(filePath);
            await recursiveSync(filePath);
          } else {
            if (oldStats === undefined || newStats.mtime > oldStats.mtime) {
              changed = true;
              this.fileStats.set(filePath, newStats);
              await this.persistFile(filePath, window.Module.FS.readFile(filePath, { encoding: 'binary' }), newStats);
              this.minetestConsole?.print(`StorageManager: Updated file: ${filePath}`);
            }
          }
        }
      }
      // Sync each world
      while (this.worldNamesToSync.size > 0) {
        changed = false;
        const worldsToSync = Array.from(this.worldNamesToSync);
        this.worldNamesToSync.clear();
        for (const worldName of worldsToSync) {
          try {
            await this.ensureDirectoryExists(this.WORLDS_SYNC_BASE_PATH + '/' + worldName);
            await recursiveSync(this.WORLDS_SYNC_BASE_PATH + '/' + worldName);
          } catch (e) {
            console.error(`StorageManager: Error syncing world ${worldName}:`, e);
            this.minetestConsole?.printErr(`StorageManager: Error syncing world ${worldName}: ${e}`);
          }
        }
        // In every sync loop, sync always sync files and ensure directories
        for (const path of this.alwaysSync) {
          try {
            const newStats = window.Module.FS.stat(path);
            const isDirectory = (newStats.mode & 0x4000) === 0x4000;
            if (isDirectory) {
              await this.ensureDirectoryExists(path);
              await recursiveSync(path);
            }
            else {
              const oldStats = this.fileStats.get(path);
              if (oldStats === undefined || newStats.mtime > oldStats.mtime) {
                changed = true;
                this.fileStats.set(path, newStats);
                await this.persistFile(path, window.Module.FS.readFile(path, { encoding: 'binary' }), newStats);
                this.minetestConsole?.print(`StorageManager: Updated file: ${path}`);
              }
            }
          } catch (e) {
            console.error(`StorageManager: Error syncing always sync file ${path}:`, e);
            this.minetestConsole?.printErr(`StorageManager: Error syncing always sync file ${path}: ${e}`);
          }
        }
        if (changed) {
          this.updateStorageStats();
        }
      }
      this.worldSyncTimeout = undefined;
    }, this.SYNC_DEBOUNCE_DELAY);
  }

  get isInitialized(): boolean | Promise<boolean> {
    return this._isInitialized;
  }

  get hasCopiedToModuleFS(): boolean {
    return this._hasCopiedToModuleFS;
  }

  setMinetestConsole(minetestConsole: MinetestConsole): void {
    this.minetestConsole = minetestConsole;
  }

  public fileChanged(filePath: string): void {
    // Normalize the path
    const path = filePath.replace(/\/[^\/]+\/\.\.\//g, '/');
    if (path.startsWith('/minetest/worlds/')) {
      const worldName = path.match(/^\/minetest\/worlds\/([^\/]+)\//)?.[1];
      if (!worldName) {
        console.error(`StorageManager: No world name found in path: ${path}`);
        return;
      }
      let firstrun = false;
      if (!this.trackedWorlds.includes(worldName)) {
        this.trackedWorlds.push(worldName);
        firstrun = true;
      }
      if (this.activeWorld !== worldName) {
        this.activeWorld = worldName;
        this.minetestConsole?.print(`StorageManager: Active world changed to ${worldName}`);
      }
      if (firstrun) {
        const worlds = window.Module.FS.readdir(this.WORLDS_SYNC_BASE_PATH);
        for (const world of worlds) {
          if (world !== "." && world !== "..") {
            const stats = window.Module.FS.stat(this.WORLDS_SYNC_BASE_PATH + '/' + world);
            const isDirectory = (stats.mode & 0x4000) === 0x4000;
            if (isDirectory) {
              this.scheduleWorldSync(world);
            }
          }
        }
      }
      else {
        this.scheduleWorldSync(worldName);
      }
    }
  }

  public fileDeleted(filePath: string): void {
    // Normalize the path
    const path = filePath.replace(/\/[^\/]+\/\.\.\//g, '/');
    if (path.startsWith('/minetest/worlds/')) {
      this.deleteDirectory(path);
    }
  }

  async copyToModuleFS(): Promise<void> {
    if (!window.Module?.FS) {
      console.error('StorageManager: Module.FS is not available for initialization.');
      return Promise.reject('Module.FS not available');
    }

    if (this._hasCopiedToModuleFS) {
      console.log('StorageManager: Module.FS has already been copied to WasmFS, skipping.');
      return;
    }

    this._hasCopiedToModuleFS = true;
    // Load worlds and mods data from IndexedDB
    await this.copyIdbPathToModuleFS(this.WORLDS_SYNC_BASE_PATH);
    await this.copyIdbPathToModuleFS(this.MODS_SYNC_BASE_PATH);
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

  async getWorlds(): Promise<string[]> {
    if (!this.idbManager) {
      console.error('StorageManager: No IDBManager available for getWorlds operation');
      return [];
    }
    return this.idbManager.getDirectSubDirectories(this.WORLDS_SYNC_BASE_PATH);
  }

  // Ensures a directory exists in IndexedDB
  async ensureDirectoryExists(dirPath: string): Promise<void> {
    if (!this.idbManager || this.storagePolicy !== 'indexeddb') {
      console.log("StorageManager: No IndexedDB manager or not using IndexedDB storage");
      return;
    }
    
    try {
      await this.idbManager.storeDirectory(dirPath);
      console.log(`StorageManager: Ensured directory exists: ${dirPath}`);
    } catch (e) {
      console.error(`StorageManager: Error ensuring directory exists: ${dirPath}`, e);
    }
  }

  // Persists a file to IndexedDB
  async persistFile(filePath: string, content: Uint8Array, stats: FileStats): Promise<void> {
    if (!this.idbManager || this.storagePolicy !== 'indexeddb') {
      console.log("StorageManager: No IndexedDB manager or not using IndexedDB storage");
      return;
    }
    
    return await this.idbManager.saveFile(filePath, content, stats);
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
          this.updateStorageStats();
        }, 1000);
      }
    } catch (e) {
      console.error(`StorageManager: Error deleting directory: ${dirPath}`, e);
    }
  }
} 