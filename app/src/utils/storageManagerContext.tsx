import React, { createContext, useContext, useRef } from 'react';
import { StorageManager } from './storageManager';

// Create the context with appropriate type
const StorageManagerContext = createContext<StorageManager | null>(null);

export const useStorageManager = () => {
  const context = useContext(StorageManagerContext);
  if (!context) {
    throw new Error('useStorageManager must be used within a StorageManagerProvider');
  }
  return context;
};

export const StorageManagerProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  // Use ref to maintain a single instance of StorageManager across renders
  const storageManagerRef = useRef<StorageManager | null>(null);
  
  // Create the instance if it doesn't exist
  if (!storageManagerRef.current) {
    storageManagerRef.current = new StorageManager();
  }

  return (
    <StorageManagerContext.Provider value={storageManagerRef.current}>
      {children}
    </StorageManagerContext.Provider>
  );
};

export default StorageManagerProvider; 