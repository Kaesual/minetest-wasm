import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { StorageManager } from './storageManager';

interface GlobalContextType {
  storageManager: StorageManager | null;
  prefetch: {
    result: {
      base: Uint8Array | null;
      voxelibre: Uint8Array | null;
    };
    status: {
      base: number | 'done' | 'error';
      voxelibre: number | 'done' | 'error';
    };
  };
}

const initialPrefetchStatus: GlobalContextType["prefetch"] = {
  result: {
    base: null,
    voxelibre: null
  },
  status: {
    base: 0,
    voxelibre: 0
  }
};

// Create the context with appropriate type
const GlobalContext = createContext<GlobalContextType>({
  storageManager: null,
  prefetch: initialPrefetchStatus
});

export const useStorageManager = () => {
  const context = useContext(GlobalContext);
  if (!context) {
    throw new Error('useStorageManager must be used within a GlobalProvider');
  }
  return context.storageManager;
};

export const usePrefetchData = () => {
  const context = useContext(GlobalContext);
  if (!context) {
    throw new Error('usePrefetchData must be used within a GlobalProvider');
  }
  return context.prefetch;
};

export const GlobalProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  // Use ref to maintain a single instance of StorageManager across renders
  const storageManagerRef = useRef<StorageManager | null>(null);
  const [prefetchStatus, setPrefetchStatus] = useState<GlobalContextType["prefetch"]>(initialPrefetchStatus);
    
  const prefetch = useCallback(async (name: 'base' | 'voxelibre') => {
    const packUrl = `minetest/packs/${name}.pack`;
    try {
      console.log(`Prefetching pack: ${packUrl}`);
      const response = await fetch(packUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch pack ${name}: ${response.status} ${response.statusText}`);
      }
      
      const contentLength = response.headers.get('Content-Length');
      let totalSize = contentLength ? parseInt(contentLength, 10) : 0;
      
      setPrefetchStatus(prev => ({
        ...prev,
        status: {
          ...prev.status,
          [name]: 0
        }
      }));
      
      // Read the response body
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error(`Cannot read response body for pack ${name}`);
      }
      
      const chunks: Uint8Array[] = [];
      let receivedLength = 0;
      
      while (true) {
        const {done, value} = await reader.read();
        
        if (done) {
          break;
        }
        
        chunks.push(value);
        receivedLength += value.length;
        
        setPrefetchStatus(prev => ({
          ...prev,
          status: {
            ...prev.status,
            [name]: receivedLength / (totalSize || 1)
          }
        }));
      }
      
      // Combine all chunks into a single Uint8Array
      const allData = new Uint8Array(receivedLength);
      let position = 0;
      
      for (const chunk of chunks) {
        allData.set(chunk, position);
        position += chunk.length;
      }

      setPrefetchStatus(prev => ({
        result: {
          ...prev.result,
          [name]: allData
        },
        status: {
          ...prev.status,
          [name]: 'done'
        }
      }));
    } catch (error) {
      setPrefetchStatus(prev => ({
        ...prev,
        status: {
          ...prev.status,
          [name]: 'error'
        }
      }));
    }
  }, []);

  useEffect(() => {
    prefetch('base');
    prefetch('voxelibre');
  }, []);
  
  // Create the instance if it doesn't exist
  if (!storageManagerRef.current) {
    storageManagerRef.current = new StorageManager();
  }

  return (
    <GlobalContext.Provider value={{
      storageManager: storageManagerRef.current,
      prefetch: prefetchStatus
    }}>
      {children}
    </GlobalContext.Provider>
  );
};

export default GlobalProvider; 