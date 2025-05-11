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

            const request = indexedDB.open(this.dbName, 1);

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
            };
        });
    }

    async saveFile(path, content, mtime, atime) {
        if (!this.db) {
            console.error('IDBManager: Database not initialized. Call initDB() first.');
            return Promise.reject('Database not initialized');
        }
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);
            const fileRecord = {
                path: path,
                content: content, // Should be Uint8Array or Blob
                mtime: (mtime instanceof Date) ? mtime.getTime() : ((typeof mtime === 'number' && mtime < 100000000000) ? mtime * 1000 : mtime),
                atime: (atime instanceof Date) ? atime.getTime() : ((typeof atime === 'number' && atime < 100000000000) ? atime * 1000 : atime)
            };

            const request = objectStore.put(fileRecord);

            request.onsuccess = () => {
                // console.log('IDBManager: File saved successfully:', path);
                resolve();
            };

            request.onerror = (event) => {
                console.error('IDBManager: Error saving file:', path, event.target.error);
                reject('Error saving file: ' + event.target.error);
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
}

// For use in launcher.js
// const idbManager = new IDBManager(); 