import { FileStats, IDBManagerDexie } from './IDBManagerDexie';
import { type MinetestConsole } from './GlobalContext';
import { zip, unzip, type Unzipped } from 'fflate';
import dayjs from 'dayjs';

export interface StorageStats {
  fileCount: number;
  totalSize: number;
  lastUpdate: Date | null;
}

export class StorageManager {
  private idbManager: IDBManagerDexie | null = null;
  private storagePolicy: string = 'no-storage';
  private _isInitialized: boolean | Promise<boolean> = false;
  private _hasCopiedToModuleFS: boolean = false;
  private statsChangeListeners: Set<((stats: StorageStats) => void)> = new Set();
  
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
  private nextWorldSyncTime: number = 0;
  
  private readonly WORLDS_SYNC_BASE_PATH = '/minetest/worlds';
  private readonly MODS_SYNC_BASE_PATH = '/minetest/mods';

  public autoSync: boolean = true;
  public autoSyncDebounceDelay: number = 120_000;

  constructor() {
    // Empty constructor - initialization happens with initialize() 
  }
  
  // Return the current storage policy
  getStoragePolicy(): string {
    return this.storagePolicy;
  }
  
  // Initialize storage manager
  async initialize(storageOptions: { policy: string }, minetestConsole: MinetestConsole): Promise<void> {
    this._isInitialized = new Promise<boolean>(async (resolve, reject) => {
      this.minetestConsole = minetestConsole;
      if (this.storagePolicy === storageOptions.policy) {
        this.minetestConsole.print('StorageManager: Already initialized with identical policy');
        resolve(true);
        return;
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
          this.updateStorageStats();
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
  private async copyIdbPathToModuleFS(): Promise<void> {
    if (!window.Module?.FS || !this.idbManager) {
      console.error('StorageManager-IDB: Module.FS or IDBManager not available for initial load.');
      return Promise.reject('FS or IDBManager not ready for IDB load');
    }
    
    console.log('StorageManager-IDB: Starting initial load from IndexedDB');
    try {
      const files = await this.idbManager.getAllFiles();
      if (files.length === 0) {
        console.log('StorageManager-IDB: No files found in IndexedDB.');
        return;
      }
      console.log(`StorageManager-IDB: Found ${files.length} file(s) to load into WasmFS.`);

      for (const file of files) {
        try {
          // Set stats
          this.fileStats.set(file.path, file.stats);

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
      this.updateStorageStats();
      console.log('StorageManager-IDB: Finished loading files from IndexedDB into WasmFS.');
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
    } catch (e) {
      console.error('StorageManager: Error calculating IndexedDB stats:', e);
    }
    this.notifyStatsChange();
  }

  private alwaysSync: string[] = [
    '/minetest/minetest.conf',
    '/minetest/client/mod_storage.sqlite',
  ];

  private async recursiveSync(path: string, changed: boolean = false): Promise<boolean> {
    let filesAndDirectories: string[] = [];
    filesAndDirectories = window.Module.FS.readdir(path);
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
        changed = (await this.recursiveSync(filePath, changed)) || changed;
      } else {
        if (oldStats === undefined || newStats.mtime > oldStats.mtime) {
          changed = true;
          this.fileStats.set(filePath, newStats);
          await this.persistFile(filePath, window.Module.FS.readFile(filePath, { encoding: 'binary' }), newStats);
          this.minetestConsole?.print(`StorageManager: Updated file: ${filePath}`);
        }
      }
    }
    return changed;
  }

  private async syncAlwaysSync(): Promise<boolean> {
    let changed = false;
    for (const path of this.alwaysSync) {
      try {
        const newStats = window.Module.FS.stat(path);
        const isDirectory = (newStats.mode & 0x4000) === 0x4000;
        if (isDirectory) {
          changed = (await this.recursiveSync(path)) || changed;
          await this.ensureDirectoryExists(path);
        }
        else {
          const oldStats = this.fileStats.get(path);
          if (oldStats === undefined || newStats.mtime > oldStats.mtime) {
            changed = true;
            this.fileStats.set(path, newStats);
            this.minetestConsole?.print(`StorageManager: Updating file: ${path}`);
            await this.persistFile(path, window.Module.FS.readFile(path, { encoding: 'binary' }), newStats);
          }
        }
      } catch (e) {
        console.error(`StorageManager: Error syncing always sync file ${path}:`, e);
        this.minetestConsole?.printErr(`StorageManager: Error syncing always sync file ${path}: ${e}`);
      }
    }
    return changed;
  }

  private worldSyncInProgress: boolean = false;
  public async executeWorldSync() {
    if (this.storagePolicy !== 'indexeddb' || this.worldSyncInProgress) {
      return;
    }
    this.worldSyncInProgress = true;
    let changed = false;
    if (this.worldSyncTimeout !== undefined) {
      clearTimeout(this.worldSyncTimeout);
      this.worldSyncTimeout = undefined;
    }
    this.nextWorldSyncTime = 0;
    // If no worlds to sync, sync alwaysSync files, otherwise
    // syncAlwaysSync will be called in the loop belows
    if (this.worldNamesToSync.size === 0) {
      changed = (await this.syncAlwaysSync()) || changed;
      if (changed) {
        this.updateStorageStats();
      }
    }
    // Sync each world
    while (this.worldNamesToSync.size > 0) {
      changed = false;
      const worldsToSync = Array.from(this.worldNamesToSync);
      this.worldNamesToSync.clear();
      for (const worldName of worldsToSync) {
        try {
          try {
            // Recursively sync the world. Will throw if the world has been deleted
            changed = (await this.recursiveSync(this.WORLDS_SYNC_BASE_PATH + '/' + worldName)) || changed;
            await this.ensureDirectoryExists(this.WORLDS_SYNC_BASE_PATH + '/' + worldName);
          }
          catch (e) {
            if (e instanceof Error && e.message === "No such directory") {
              // World was deleted, remove from tracked worlds
              changed = true;
              this.trackedWorlds = this.trackedWorlds.filter(world => world !== worldName);
              this.minetestConsole?.print(`StorageManager: World ${worldName} deleted, removing from tracked worlds`);
              // no need to await this
              this.idbManager?.deleteDirectory(this.WORLDS_SYNC_BASE_PATH + '/' + worldName);
            }
            else {
              throw e;
            }
          }
        } catch (e) {
          console.error(`StorageManager: Error syncing world ${worldName}:`, e);
          this.minetestConsole?.printErr(`StorageManager: Error syncing world ${worldName}: ${e}`);
        }
      }
      // In every sync loop, sync alwaysSync files and ensure directories
      changed = (await this.syncAlwaysSync()) || changed;
      if (changed) {
        this.updateStorageStats();
      }
    }
    this.worldSyncInProgress = false;
  }

  private scheduleWorldSync(worldName: string): void {
    this.worldNamesToSync.add(worldName);
    if (this.worldSyncInProgress || !this.autoSync) {
      return;
    }

    this.worldSyncTimeout = setTimeout(this.executeWorldSync.bind(this), this.autoSyncDebounceDelay);
    this.nextWorldSyncTime = Date.now() + this.autoSyncDebounceDelay;
  }

  get isInitialized(): boolean | Promise<boolean> {
    return this._isInitialized;
  }

  get hasCopiedToModuleFS(): boolean {
    return this._hasCopiedToModuleFS;
  }

  get worldSyncInfo(): { nextSync: number | null, inProgress: boolean } {
    return {
      nextSync: this.nextWorldSyncTime > 0 ? this.nextWorldSyncTime : null,
      inProgress: this.worldSyncInProgress,
    };
  }

  setMinetestConsole(minetestConsole: MinetestConsole): void {
    this.minetestConsole = minetestConsole;
  }

  addStatsChangeListener(listener: (stats: StorageStats) => void): void {
    this.statsChangeListeners.add(listener);
  }

  removeStatsChangeListener(listener: (stats: StorageStats) => void): void {
    this.statsChangeListeners.delete(listener);
  }

  private notifyStatsChange(): void {
    const stats = this.getStats();
    for (const listener of Array.from(this.statsChangeListeners)) {
      listener(stats);
    }
  }

  public getStats(): StorageStats {
    let lastUpdate: Date | null = null;
    if (this.worldsStats.lastUpdate && this.modsStats.lastUpdate) {
      lastUpdate = this.worldsStats.lastUpdate > this.modsStats.lastUpdate ? this.worldsStats.lastUpdate : this.modsStats.lastUpdate;
    }
    else if (this.worldsStats.lastUpdate) {
      lastUpdate = this.worldsStats.lastUpdate;
    }
    else if (this.modsStats.lastUpdate) {
      lastUpdate = this.modsStats.lastUpdate;
    }
    const stats: StorageStats = {
      fileCount: this.worldsStats.fileCount + this.modsStats.fileCount,
      totalSize: this.worldsStats.totalSize + this.modsStats.totalSize,
      lastUpdate,
    };
    return stats;
  }

  public fileChanged(filePath: string): void {
    if (this.storagePolicy !== 'indexeddb') {
      return;
    }
    // Normalize the path
    const path = filePath.replace(/\/[^\/]+\/\.\.\//g, '/');
    if (path.startsWith('/minetest/worlds/')) {
      const worldName = path.match(/^\/minetest\/worlds\/([^\/]+)\//)?.[1];
      if (!worldName) {
        this.minetestConsole?.printErr(`StorageManager: No world name found in path: ${path}`);
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
      // If firstrun, schedule sync for all worlds
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
      // Otherwise, schedule sync for the active world
      else {
        this.scheduleWorldSync(worldName);
      }
    }
    else {
      this.minetestConsole?.print(`StorageManager: File changed (no sync): ${path}`);
    }
  }

  public fileDeleted(filePath: string): void {
    if (this.storagePolicy !== 'indexeddb') {
      return;
    }
    // Normalize the path
    const path = filePath.replace(/\/[^\/]+\/\.\.\//g, '/');
    if (path.startsWith('/minetest/worlds/')) {
      const worldName = path.match(/^\/minetest\/worlds\/([^\/]+)\//)?.[1];
      if (!worldName) {
        console.error(`StorageManager: No world name found in path: ${path}`);
        return;
      }
      // Sync will remove the world from tracked worlds and clean up the world directory in IndexedDB
      this.scheduleWorldSync(worldName);
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
    await this.copyIdbPathToModuleFS();
  }

  public async downloadAllFilesAsZip(): Promise<void> {
    if (!this.idbManager) {
      console.error('StorageManager: No IDBManager available for download operation');
      return;
    }
    
    // First, sync all files
    await this.executeWorldSync();

    const files = await this.idbManager.getAllFiles();
    const zipContent: Record<string, Uint8Array> = {};
    for (const file of files) {
      zipContent[file.path] = file.content;
    }
    const zipFile = await new Promise<Uint8Array>((resolve, reject) => {
      zip(
        zipContent,
        {
          level: 9,
          // consume: true,
        },
        (err, data) => {
          if (err) {
            reject(err);
          }
          else {
            resolve(data);
          }
        }
      );
    });
    const zipBlob = new Blob([zipFile], { type: 'application/zip' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.style.display = 'none';
    document.body.appendChild(a);
    a.href = url;
    a.download = `minetest_storage_${dayjs().format('YYYY-MM-DD_HH-mm')}.zip`;
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  public async restoreFromZip(zipFile: Uint8Array): Promise<void> {
    if (!this.idbManager) {
      console.error('StorageManager: No IDBManager available for restore operation');
      return;
    }
    console.log('StorageManager: Restoring from zip');
    const unzipped = await new Promise<Unzipped>((resolve, reject) => {
      unzip(
        zipFile,
        {},
        (err, data) => {
          if (err) {
            reject(err);
          }
          else {
            resolve(data);
          }
        }
      );
    });
    await this.idbManager.clearDatabase();
    this.fileStats.clear();
    const addedDirectories: Set<string> = new Set();
    const now = Math.floor(Date.now() / 1000);
    for (const file of Object.keys(unzipped)) {
      if (!file.startsWith('/minetest/')) {
        console.error('StorageManager: File does not start with /minetest/', file);
        continue;
      }
      const relativePath = file.slice('/minetest/'.length);
      console.log("Restoring file", file);
      const pathFragments = relativePath.split('/');
      for (let i = 1; i < pathFragments.length; i++) {
        const dirPath = '/minetest/' + pathFragments.slice(0, i).join('/');
        if (dirPath !== '/minetest/' && !addedDirectories.has(dirPath)) {
          await this.idbManager.storeDirectory(dirPath);
          addedDirectories.add(dirPath);
        }
      }
      const stats: FileStats = {
        mtime: now,
        atime: now,
        ctime: now,
        size: unzipped[file].length,
        mode: 0, // only used for directory checks
      };
      this.fileStats.set(file, stats);
      await this.idbManager.saveFile(file, unzipped[file], stats);
    }
    this.updateStorageStats();
  }

  // Clear storage
  async clearStorage(area: string = 'all'): Promise<void> {
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