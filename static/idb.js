class IDBManager {
    constructor(dbName = 'MinetestWasmWorldsDB', storeName = 'files') {
        this.dbName = dbName;
        this.storeName = storeName;
        this.db = null;
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                resolve(this.db);
                return;
            }

            const request = indexedDB.open(this.dbName, 2);

            request.onerror = (event) => {
                console.error('IDBManager: Database error:', event.target.error);
                reject('Error opening database: ' + event.target.errorCode);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('IDBManager: Database opened successfully.');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                console.log('IDBManager: Database upgrade needed.');
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const objectStore = db.createObjectStore(this.storeName, { keyPath: 'path' });
                    objectStore.createIndex('mtime', 'mtime', { unique: false });
                    console.log('IDBManager: Object store "' + this.storeName + '" created.');
                }
                if (!db.objectStoreNames.contains('directories')) {
                    const dirStore = db.createObjectStore('directories', { keyPath: 'path' });
                    dirStore.createIndex('path', 'path', { unique: true });
                }
            };
        });
    }

    async saveFile(path, content, mtime, atime) {
        if (!this.db) {
            console.error('IDBManager: Database not initialized. Call initDB() first.');
            return Promise.reject('Database not initialized');
        }
        
        // Ensure content is properly typed - this prevents serialization issues and storage doubling
        let safeContent;
        if (content) {
            if (content instanceof Uint8Array) {
                // Keep as is if already a Uint8Array
                safeContent = content;
            } else if (content.buffer && content.buffer instanceof ArrayBuffer) {
                // Convert to Uint8Array if it's an array-like with a buffer
                safeContent = new Uint8Array(content.buffer);
            } else if (typeof content === 'string') {
                // Convert string to UTF-8 encoded Uint8Array
                const encoder = new TextEncoder();
                safeContent = encoder.encode(content);
            } else if (content instanceof ArrayBuffer) {
                // Convert ArrayBuffer directly to Uint8Array
                safeContent = new Uint8Array(content);
            } else {
                console.error(`IDBManager: Unsupported content type for ${path}:`, content);
                return Promise.reject('Unsupported content type');
            }
        } else {
            // Create empty content if none provided
            safeContent = new Uint8Array(0);
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);
            
            // Use setItem to first remove any existing record
            objectStore.delete(path).onsuccess = () => {
                // Then create a new record with the proper content
                const fileRecord = {
                    path: path,
                    content: safeContent,
                    mtime: (mtime instanceof Date) ? mtime.getTime() : ((typeof mtime === 'number' && mtime < 100000000000) ? mtime * 1000 : mtime || Date.now()),
                    atime: (atime instanceof Date) ? atime.getTime() : ((typeof atime === 'number' && atime < 100000000000) ? atime * 1000 : atime || Date.now())
                };
                
                const request = objectStore.add(fileRecord);
                
                request.onsuccess = () => {
                    resolve();
                };
                
                request.onerror = (event) => {
                    console.error('IDBManager: Error saving file:', path, event.target.error);
                    reject('Error saving file: ' + event.target.error);
                };
            };
            
            transaction.onerror = (event) => {
                console.error('IDBManager: Transaction error when saving file:', path, event.target.error);
                reject('Transaction error: ' + event.target.error);
            };
        });
    }

    async loadFile(path) {
        if (!this.db) {
            console.error('IDBManager: Database not initialized. Call initDB() first.');
            return Promise.reject('Database not initialized');
        }
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.get(path);

            request.onsuccess = (event) => {
                if (event.target.result) {
                    const record = event.target.result;
                    // console.log('IDBManager: File loaded successfully:', path);
                    resolve({
                        content: record.content,
                        mtime: new Date(record.mtime),
                        atime: new Date(record.atime)
                    });
                } else {
                    // console.log('IDBManager: File not found:', path);
                    resolve(null);
                }
            };

            request.onerror = (event) => {
                console.error('IDBManager: Error loading file:', path, event.target.error);
                reject('Error loading file: ' + event.target.error);
            };
        });
    }

    async getAllFiles(basePath = null) {
        if (!this.db) {
            console.error('IDBManager: Database not initialized. Call initDB() first.');
            return Promise.reject('Database not initialized');
        }
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);
            const files = [];
            
            // If basePath is provided, create a key range
            const range = basePath ? IDBKeyRange.bound(basePath, basePath + '\\uffff') : null;
            const cursorRequest = range ? objectStore.openCursor(range) : objectStore.openCursor();

            cursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    // Log the first few files to debug content format
                    if (files.length < 2) {
                        console.log('IDBManager debug - File content type:', {
                            path: cursor.value.path,
                            contentType: cursor.value.content ? typeof cursor.value.content : 'null',
                            isArrayBuffer: cursor.value.content instanceof ArrayBuffer,
                            isUint8Array: cursor.value.content instanceof Uint8Array,
                            hasLength: cursor.value.content && typeof cursor.value.content.length === 'number',
                            hasByteLength: cursor.value.content && typeof cursor.value.content.byteLength === 'number',
                            length: cursor.value.content ? (cursor.value.content.length || cursor.value.content.byteLength || 0) : 0
                        });
                    }
                    
                    files.push({
                        path: cursor.value.path,
                        content: cursor.value.content,
                        mtime: new Date(cursor.value.mtime),
                        atime: new Date(cursor.value.atime)
                    });
                    cursor.continue();
                } else {
                    if (files.length > 0) {
                        console.log('IDBManager: Loaded all files' + (basePath ? ' under ' + basePath : '') + '.', files.length);
                    }
                    resolve(files);
                }
            };

            cursorRequest.onerror = (event) => {
                console.error('IDBManager: Error getting all files:', event.target.error);
                reject('Error getting all files: ' + event.target.error);
            };
        });
    }

    async deleteFile(path) {
        if (!this.db) {
            console.error('IDBManager: Database not initialized. Call initDB() first.');
            return Promise.reject('Database not initialized');
        }
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.delete(path);

            request.onsuccess = () => {
                // console.log('IDBManager: File deleted successfully:', path);
                resolve();
            };

            request.onerror = (event) => {
                console.error('IDBManager: Error deleting file:', path, event.target.error);
                reject('Error deleting file: ' + event.target.error);
            };
        });
    }

    /**
     * Stores a directory reference in IndexedDB
     * @param {string} dirPath - Path to the directory
     * @returns {Promise} - Promise that resolves when the directory is stored
     */
    storeDirectory(dirPath) {
        return this.initDB().then(() => {
            return new Promise((resolve, reject) => {
                // Create a transaction and get the directories object store
                const tx = this.db.transaction(['directories'], 'readwrite');
                const store = tx.objectStore('directories');
                
                // Create a simple record with the directory path
                const record = {
                    path: dirPath,
                    timestamp: Date.now()
                };
                
                // Add or update the directory record
                const request = store.put(record);
                
                request.onerror = (event) => {
                    console.error('Error storing directory in IndexedDB:', event.target.error);
                    reject(event.target.error);
                };
                
                request.onsuccess = (event) => {
                    resolve();
                };
                
                tx.oncomplete = () => {
                    // Transaction completed successfully
                };
            });
        }).catch(err => {
            console.error('Failed to store directory:', dirPath, err);
            throw err;
        });
    }

    /**
     * Deletes a directory and all files contained within it from IndexedDB
     * @param {string} dirPath - Path to the directory to delete
     * @returns {Promise} - Promise that resolves when the directory and its contents are deleted
     */
    async deleteDirectory(dirPath) {
        if (!this.db) {
            console.error('IDBManager: Database not initialized. Call initDB() first.');
            return Promise.reject('Database not initialized');
        }
        
        console.log(`IDBManager: Attempting to delete directory: ${dirPath}`);
        
        try {
            // Normalize directory path to ensure consistent matching
            const dirNormalized = dirPath.endsWith('/') ? dirPath : dirPath + '/';
            
            // Step 1: Get all files from the database
            const allFiles = await this.getAllFiles();
            
            // Step 2: Filter files that belong to this directory or subdirectories
            const filesToDelete = allFiles.filter(file => 
                file.path === dirPath || // The directory itself as a file
                file.path.startsWith(dirNormalized) // Files within the directory
            );
            
            console.log(`IDBManager: Found ${filesToDelete.length} files to delete in directory ${dirPath}`);
            
            // Step 3: Delete each file
            let deleteCount = 0;
            for (const file of filesToDelete) {
                try {
                    await this.deleteFile(file.path);
                    deleteCount++;
                    console.log(`IDBManager: Deleted file ${deleteCount}/${filesToDelete.length}: ${file.path}`);
                } catch (err) {
                    console.error(`IDBManager: Failed to delete file: ${file.path}`, err);
                }
            }
            
            // Step 4: Delete directory entries
            // Get directory transaction
            const dirPromise = new Promise((resolve, reject) => {
                try {
                    const transaction = this.db.transaction('directories', 'readwrite');
                    const store = transaction.objectStore('directories');
                    
                    // Delete main directory
                    store.delete(dirPath);
                    
                    // Get all entries
                    const allDirRequest = store.getAll();
                    allDirRequest.onsuccess = (event) => {
                        const allDirs = event.target.result;
                        const dirsToDelete = allDirs.filter(dir => 
                            dir.path.startsWith(dirNormalized)
                        );
                        
                        console.log(`IDBManager: Found ${dirsToDelete.length} subdirectories to delete`);
                        
                        // Delete each subdirectory
                        dirsToDelete.forEach(dir => {
                            store.delete(dir.path);
                        });
                    };
                    
                    transaction.oncomplete = () => {
                        resolve();
                    };
                    
                    transaction.onerror = (event) => {
                        console.error('IDBManager: Error deleting directories', event.target.error);
                        // Still resolve to continue the process
                        resolve();
                    };
                } catch (err) {
                    console.error('IDBManager: Error in directory transaction', err);
                    // Still resolve to continue the process
                    resolve();
                }
            });
            
            // Wait for directory deletion to complete
            await dirPromise;
            
            console.log(`IDBManager: Successfully deleted ${deleteCount} files from ${dirPath}`);
            return true;
        } catch (err) {
            console.error('IDBManager: Error deleting directory:', err);
            throw err;
        }
    }
}

// For use in launcher.js
// const idbManager = new IDBManager(); 