import Dexie from 'dexie';

interface FileRecord {
  path: string;
  content: Uint8Array;
  stats: FileStats;
}

interface DirectoryRecord {
  path: string;
}

export interface FileStats {
  // relevant
  mtime: number;
  size: number;
  mode: number;
  // not relevant, but present in Module.FS.stat result
  atime?: number;
  ctime?: number;
  ino?: number;
  uid?: number;
  gid?: number;
  nlink?: number;
  dev?: number;
  rdev?: number;
}

class MinetestDatabase extends Dexie {
  files: Dexie.Table<FileRecord, string>;
  directories: Dexie.Table<DirectoryRecord, string>;

  constructor(dbName: string) {
    super(dbName);
    
    this.version(3).stores({
      files: 'path, stats.mtime',
      directories: 'path'
    });
    
    this.files = this.table('files');
    this.directories = this.table('directories');
  }
}

export class IDBManagerDexie {
  private db: MinetestDatabase | null = null;
  private dbName: string;
  private closed: boolean = false;

  constructor(dbName: string = 'MinetestWasmWorldsDB') {
    this.dbName = dbName;
  }

  async initDB(): Promise<MinetestDatabase> {
    if (this.closed) {
      throw new Error('Database has been closed and cannot be reopened. Create a new instance instead.');
    }

    if (this.db) {
      return this.db;
    }

    try {
      const db = new MinetestDatabase(this.dbName);
      await db.open();
      console.log('IDBManagerDexie: Database opened successfully.');
      this.db = db;
      return this.db;
    } catch (error) {
      console.error('IDBManagerDexie: Database error:', error);
      throw new Error('Error opening database: ' + error);
    }
  }

  async close(): Promise<void> {
    if (!this.db) {
      // Already closed or never initialized
      this.closed = true;
      return;
    }

    try {
      this.db.close();
      console.log('IDBManagerDexie: Database closed successfully.');
    } catch (error) {
      console.error('IDBManagerDexie: Error closing database:', error);
      throw new Error('Error closing database: ' + error);
    } finally {
      this.db = null;
      this.closed = true;
    }
  }

  private async ensureDbInitialized(): Promise<MinetestDatabase> {
    if (this.closed) {
      throw new Error('Database has been closed. Create a new instance instead.');
    }
    
    if (!this.db) {
      throw new Error('Database not initialized. Call initDB() first.');
    }
    return this.db;
  }

  async saveFile(path: string, content: Uint8Array | ArrayBuffer | string, stats: FileStats): Promise<void> {
    try {
      const db = await this.ensureDbInitialized();
      
      // Ensure content is properly typed - this prevents serialization issues and storage doubling
      let safeContent: Uint8Array;
      if (content) {
        if (content instanceof Uint8Array) {
          // Keep as is if already a Uint8Array
          safeContent = content;
        } else if (content instanceof ArrayBuffer) {
          // Convert ArrayBuffer directly to Uint8Array
          safeContent = new Uint8Array(content);
        } else if (typeof content === 'string') {
          // Convert string to UTF-8 encoded Uint8Array
          const encoder = new TextEncoder();
          safeContent = encoder.encode(content);
        } else {
          // For other array-like objects with a buffer
          try {
            safeContent = new Uint8Array(content as ArrayBufferLike);
          } catch (e) {
            console.error(`IDBManagerDexie: Unsupported content type for ${path}:`, content);
            return Promise.reject('Unsupported content type');
          }
        }
      } else {
        // Create empty content if none provided
        safeContent = new Uint8Array(0);
      }
      
      // Create the file record
      const fileRecord: FileRecord = {
        path,
        content: safeContent,
        stats,
      };
      
      // Save to DB (this will overwrite if the path already exists)
      await db.files.put(fileRecord);
      
    } catch (error) {
      console.error('IDBManagerDexie: Error saving file:', path, error);
      throw new Error('Error saving file: ' + error);
    }
  }

  async loadFile(path: string): Promise<{ content: Uint8Array, stats: FileStats } | null> {
    try {
      const db = await this.ensureDbInitialized();
      
      const record = await db.files.get(path);
      
      if (record) {
        return {
          content: record.content,
          stats: record.stats
        };
      } else {
        return null;
      }
    } catch (error) {
      console.error('IDBManagerDexie: Error loading file:', path, error);
      throw new Error('Error loading file: ' + error);
    }
  }

  async getAllFiles(basePath: string | null = null): Promise<FileRecord[]> {
    try {
      const db = await this.ensureDbInitialized();
      
      let files;
      
      if (basePath) {
        // Create a key range for the basePath
        files = await db.files
          .where('path')
          .startsWith(basePath)
          .toArray();
      } else {
        // Get all files
        files = await db.files.toArray();
      }
      
      return files;
    } catch (error) {
      console.error('IDBManagerDexie: Error getting all files:', error);
      throw new Error('Error getting all files: ' + error);
    }
  }

  async deleteFile(path: string): Promise<void> {
    try {
      const db = await this.ensureDbInitialized();
      
      await db.files.delete(path);
      return Promise.resolve();
    } catch (error) {
      console.error('IDBManagerDexie: Error deleting file:', path, error);
      throw new Error('Error deleting file: ' + error);
    }
  }

  async getDirectSubDirectories(dirPath: string): Promise<string[]> {
    try {
      const db = await this.ensureDbInitialized();
      const dirRegex = new RegExp(`^${dirPath}/[^/]+$`);
      const directories = await db.directories.where('path').startsWith(dirPath).filter(dir => dirRegex.test(dir.path)).toArray();
      return directories.map(dir => dir.path.split('/').pop() || '');
    } catch (error) {
      console.error('IDBManagerDexie: Error getting subdirectories:', dirPath, error);
      throw new Error('Error getting subdirectories: ' + error);
    }
  }

  async storeDirectory(dirPath: string): Promise<void> {
    try {
      const db = await this.ensureDbInitialized();
      
      await db.directories.put({ path: dirPath });
      return Promise.resolve();
    } catch (error) {
      console.error('IDBManagerDexie: Error storing directory:', dirPath, error);
      throw new Error('Error storing directory: ' + error);
    }
  }

  async deleteDirectory(dirPath: string): Promise<void> {
    try {
      const db = await this.ensureDbInitialized();
      
      // Delete the directory record
      await db.directories.delete(dirPath);
      await db.directories.where('path').startsWith(dirPath.endsWith("/") ? dirPath : dirPath + "/").delete();
      
      // Delete all files that start with this directory path
      await db.files
        .where('path')
        .startsWith(dirPath.endsWith("/") ? dirPath : dirPath + "/")
        .delete();

    } catch (error) {
      console.error('IDBManagerDexie: Error deleting directory:', dirPath, error);
      throw new Error('Error deleting directory: ' + error);
    }
  }

  async deleteAllByPath(basePath: string): Promise<void> {
    try {
      const db = await this.ensureDbInitialized();
      
      // Delete all files that start with this path
      await db.files
        .where('path')
        .startsWith(basePath)
        .delete();
      
      // Delete all directories that start with this path
      await db.directories
        .where('path')
        .startsWith(basePath)
        .delete();
      
      return Promise.resolve();
    } catch (error) {
      console.error('IDBManagerDexie: Error deleting by path:', basePath, error);
      throw new Error('Error deleting by path: ' + error);
    }
  }

  async clearDatabase(): Promise<void> {
    try {
      const db = await this.ensureDbInitialized();
      
      await db.files.clear();
      await db.directories.clear();
      return Promise.resolve();
    } catch (error) {
      console.error('IDBManagerDexie: Error clearing database:', error);
      throw new Error('Error clearing database: ' + error);
    }
  }
} 