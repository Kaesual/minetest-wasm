import React, { useState, useEffect } from 'react';
import StartScreen from './components/StartScreen';
import RuntimeScreen from './components/RuntimeScreen';
import GlobalProvider from './utils/GlobalContext';
import './App.css';

// Define the game options interface
export interface GameOptions {
  language: string;
  proxy: string;
  storagePolicy: string;
  prefetchResponse_base?: Response;
  prefetchResponse_voxelibre?: Response;
}

function App() {
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [gameOptions, setGameOptions] = useState<GameOptions>({
    language: 'en',
    proxy: 'wss://na1.dustlabs.io/mtproxy',
    storagePolicy: 'indexeddb'
  });

  const handleStartGame = (options: GameOptions) => {
    setGameOptions(options);
    setIsGameStarted(true);
  };
  
  const handleUpdateOptions = (options: Partial<GameOptions>) => {
    setGameOptions(prevOptions => ({
      ...prevOptions,
      ...options
    }));
  };
  
  const handleGameStatus = (status: 'running' | 'failed') => {
    if (status === 'failed') {
      // If game fails to start, go back to start screen
      setIsGameStarted(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-gray-900 text-white">
      <GlobalProvider>
        {!isGameStarted ? (
          <StartScreen 
            onStartGame={handleStartGame}
            onUpdateOptions={handleUpdateOptions}
            currentOptions={gameOptions}
          />
        ) : (
          <RuntimeScreen
            gameOptions={gameOptions}
            onGameStatus={handleGameStatus}
          />
        )}
      </GlobalProvider>
    </div>
  );
}

export default App; 