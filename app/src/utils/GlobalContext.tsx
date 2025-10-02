import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StorageManager } from './storageManager';
import { GameId } from '../App';

export interface MinetestConsole {
  print: (text: string) => void;
  printErr: (text: string) => void;
  messages: string[];
}

export interface PrefetchStatus {
  result: {
    base: Uint8Array | null;
    minetest_game: Uint8Array | null;
    voxelibre: Uint8Array | null;
    mineclonia: Uint8Array | null;
    glitch: Uint8Array | null;
    blockbomber: Uint8Array | null;
  };
  status: {
    base: number | 'done' | 'error';
    minetest_game: number | 'done' | 'error';
    voxelibre: number | 'done' | 'error';
    mineclonia: number | 'done' | 'error';
    glitch: number | 'done' | 'error';
    blockbomber: number | 'done' | 'error';
  };
}

export type PackName = 'base' | 'minetest_game' | 'voxelibre' | 'mineclonia' | 'glitch' | 'blockbomber';

interface GlobalContextType {
  storageManager: StorageManager | null;
  prefetch: PrefetchStatus;
  executePrefetch: (name: GameId) => void;
  minetestConsole: MinetestConsole;
}

const initialPrefetchStatus: PrefetchStatus = {
  result: {
    base: null,
    minetest_game: null,
    voxelibre: null,
    mineclonia: null,
    glitch: null,
    blockbomber: null,
  },
  status: {
    base: 0,
    minetest_game: 0,
    voxelibre: 0,
    mineclonia: 0,
    glitch: 0,
    blockbomber: 0,
  }
};

const initialMinetestConsole: MinetestConsole = {
  print: () => {},
  printErr: () => {},
  messages: []
};

// Create the context with appropriate type
const GlobalContext = createContext<GlobalContextType>({
  storageManager: null,
  prefetch: initialPrefetchStatus,
  executePrefetch: () => {},
  minetestConsole: initialMinetestConsole
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

export const useExecutePrefetch = () => {
  const context = useContext(GlobalContext);
  if (!context) {
    throw new Error('useExecutePrefetch must be used within a GlobalProvider');
  }
  return context.executePrefetch;
};

export const useMinetestConsole = () => {
  const context = useContext(GlobalContext);
  if (!context) {
    throw new Error('useMinetestConsole must be used within a GlobalProvider');
  }
  return context.minetestConsole;
};

export const GlobalProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  // Use ref to maintain a single instance of StorageManager across renders
  const storageManagerRef = useRef<StorageManager | null>(null);
  const calledPrefetchesRef = useRef<Set<GameId>>(new Set());
  const [prefetchStatus, setPrefetchStatus] = useState<GlobalContextType["prefetch"]>(initialPrefetchStatus);

  const [messages, setMessages] = useState<GlobalContextType["minetestConsole"]["messages"]>(["Console initialized"]);

  const consolePrint = useCallback((text: string) => {
    console.log(`Minetest Console: ${text}`);
    setMessages(prev => [...prev, text]);
  }, []);

  const consolePrintErr = useCallback((text: string) => {
    console.log(`Minetest Console Error: ${text}`);
    setMessages(prev => [...prev, text]);
  }, []);

  const minetestConsole = useMemo(() => ({
    print: consolePrint,
    printErr: consolePrintErr,
    messages
  }), [consolePrint, consolePrintErr, messages]);
    
  const prefetch = useCallback(async (name: PackName) => {
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
  }, []);

  const executePrefetch = useCallback((gameId: GameId) => {
    if (calledPrefetchesRef.current.has(gameId)) {
      return;
    }
    calledPrefetchesRef.current.add(gameId);
    if (gameId === 'mineclone2') {
      prefetch('voxelibre');
    } else {
      prefetch(gameId);
    }
  }, [prefetch]);
  
  // Create the instance if it doesn't exist
  if (!storageManagerRef.current) {
    storageManagerRef.current = new StorageManager();
  }

  return (
    <GlobalContext.Provider value={{
      storageManager: storageManagerRef.current,
      prefetch: prefetchStatus,
      executePrefetch,
      minetestConsole
    }}>
      {children}
    </GlobalContext.Provider>
  );
};

export default GlobalProvider; 