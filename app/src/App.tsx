import React, { useState, useCallback } from 'react';
import StartScreen from './components/StartScreen';
import RuntimeScreen from './components/RuntimeScreen';
import GlobalProvider from './utils/GlobalContext';
import './App.css';
import MinetestArgs from './utils/MinetestArgs';
import { PROXIES } from './utils/common';

// Define the game options interface
export interface GameOptions {
  language: string;
  proxy: string;
  storagePolicy: string;
  minetestArgs: MinetestArgs;
  mode: 'local' | 'host' | 'join';
  gameId: 'minetest_game' | 'mineclonia' | 'mineclone2' | 'glitch';
  playerName?: string;
  joinCode?: string;
  worldName?: string;
}

const initial_proxy = PROXIES[parseInt(localStorage.getItem('luanti_wasm_selected_proxy') || '0')];

function App() {
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [zipLoaderPromise, setZipLoaderPromise] = useState<Promise<Uint8Array> | null>(null);
  const [gameOptions, setGameOptions] = useState<GameOptions>({
    language: 'en',
    proxy: initial_proxy[0],
    storagePolicy: 'indexeddb',
    minetestArgs: new MinetestArgs(),
    mode: 'local',
    gameId: 'minetest_game'
  });

  const handleStartGame = useCallback((options: GameOptions) => {
    setGameOptions(options);
    setIsGameStarted(true);
  }, []);
  
  const updateGameOptions = useCallback((options: Partial<GameOptions>) => {
    setGameOptions(prevOptions => ({
      ...prevOptions,
      ...options
    }));
  }, []);
  
  const handleGameStatus = useCallback((status: 'running' | 'failed') => {
    if (status === 'failed') {
      // If game fails to start, go back to start screen
      setIsGameStarted(false);
    }
  }, []);

  return (
    <div className="min-h-screen w-full bg-gray-900 text-white">
      <GlobalProvider>
        {!isGameStarted ? (
          <StartScreen 
            onStartGame={handleStartGame}
            updateGameOptions={updateGameOptions}
            currentOptions={gameOptions}
            zipLoaderPromise={zipLoaderPromise}
            setZipLoaderPromise={setZipLoaderPromise}
          />
        ) : (
          <RuntimeScreen
            gameOptions={gameOptions}
            onGameStatus={handleGameStatus}
            zipLoaderPromise={zipLoaderPromise}
          />
        )}
      </GlobalProvider>
    </div>
  );
}

export default App; 