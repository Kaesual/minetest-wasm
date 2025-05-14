import Dexie from 'dexie';

interface FileRecord {
  path: string;
  content: Uint8Array;
  mtime: number;
  atime: number;
}

interface DirectoryRecord {
  path: string;
}

class MinetestDatabase extends Dexie {
  files: Dexie.Table<FileRecord, string>;
  directories: Dexie.Table<DirectoryRecord, string>;

  constructor(dbName: string) {
    super(dbName);
    
    this.version(2).stores({
      files: 'path, mtime',
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

  async saveFile(path: string, content: Uint8Array | ArrayBuffer | string, mtime?: Date | number, atime?: Date | number): Promise<void> {
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
      
      // Process mtime and atime
      const mtimeValue = this.processTimeValue(mtime);
      const atimeValue = this.processTimeValue(atime);
      
      // Create the file record
      const fileRecord: FileRecord = {
        path,
        content: safeContent,
        mtime: mtimeValue,
        atime: atimeValue
      };
      
      // Save to DB (this will overwrite if the path already exists)
      await db.files.put(fileRecord);
      console.log("File saved:", path, "size:", safeContent.length);
      
      return Promise.resolve();
    } catch (error) {
      console.error('IDBManagerDexie: Error saving file:', path, error);
      return Promise.reject('Error saving file: ' + error);
    }
  }

  private processTimeValue(timeValue?: Date | number): number {
    if (!timeValue) {
      return Date.now();
    }
    
    if (timeValue instanceof Date) {
      return timeValue.getTime();
    }
    
    // Handle Unix timestamps in seconds (convert to milliseconds)
    if (typeof timeValue === 'number' && timeValue < 100000000000) {
      return timeValue * 1000;
    }
    
    // Already milliseconds
    return timeValue as number;
  }

  async loadFile(path: string): Promise<{ content: Uint8Array, mtime: Date, atime: Date } | null> {
    try {
      const db = await this.ensureDbInitialized();
      
      const record = await db.files.get(path);
      
      if (record) {
        return {
          content: record.content,
          mtime: new Date(record.mtime),
          atime: new Date(record.atime)
        };
      } else {
        return null;
      }
    } catch (error) {
      console.error('IDBManagerDexie: Error loading file:', path, error);
      throw new Error('Error loading file: ' + error);
    }
  }

  async getAllFiles(basePath: string | null = null): Promise<{ path: string; content: Uint8Array; mtime: Date; atime: Date }[]> {
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
      
      return files.map(file => ({
        path: file.path,
        content: file.content,
        mtime: new Date(file.mtime),
        atime: new Date(file.atime)
      }));
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
      
      // Delete all files that start with this directory path
      const filesToDelete = await db.files
        .where('path')
        .startsWith(dirPath)
        .toArray();
      
      for (const file of filesToDelete) {
        await db.files.delete(file.path);
      }
      
      return Promise.resolve();
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