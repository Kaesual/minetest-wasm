import React, { useState, useCallback } from 'react';
import StartScreen from './components/StartScreen';
import RuntimeScreen from './components/RuntimeScreen';
import GlobalProvider from './utils/GlobalContext';
import './App.css';
import MinetestArgs from './utils/MinetestArgs';
import { PROXIES } from './utils/common';

export type GameId = 'minetest_game' | 'mineclonia' | 'mineclone2' | 'glitch' | 'blockbomber';

// Define the game options interface
export interface GameOptions {
  language: string;
  proxy: string;
  storagePolicy: string;
  minetestArgs: MinetestArgs;
  mode: 'local' | 'host' | 'join';
  gameId: GameId;
  playerName?: string;
  password?: string;
  joinCode?: string;
  worldName?: string;
}

const initial_proxy = PROXIES[parseInt(localStorage.getItem('luanti_wasm_selected_proxy') || '0')];

function App() {
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [zipLoaderPromise, setZipLoaderPromise] = useState<Promise<Uint8Array> | null>(null);
  const [serverExitTimestamp, setServerExitTimestamp] = useState<Date | null>(null);
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

  const handleExitDetected = useCallback((exitCode: number) => {
    console.log('Game exited with code:', exitCode);
    window.location.reload();
  }, []);

  const handleServerExitIntentDetected = useCallback(() => {
    console.log('Server exit intent detected');
    setServerExitTimestamp(new Date());
  }, []);
  
  const handleGameStatus = useCallback((status: 'running' | 'failed') => {
    console.log('handleGameStatus called with status:', status);
    if (status === 'failed') {
      // If game fails to start, go back to start screen
      setIsGameStarted(false);
    }
  }, []);

  return (
    <div className="min-h-screen w-full bg-gray-900 text-white">
      <GlobalProvider
        onExitDetected={handleExitDetected}
        onServerExitIntentDetected={handleServerExitIntentDetected}
      >
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
            serverExitTimestamp={serverExitTimestamp}
          />
        )}
      </GlobalProvider>
    </div>
  );
}

export default App; 