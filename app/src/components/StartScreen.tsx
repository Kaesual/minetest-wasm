import React, { useState, useEffect, useMemo } from 'react';
import { useMinetestConsole, usePrefetchData, useStorageManager } from '../utils/GlobalContext';
import { type GameOptions } from '../App';
import { PROXIES, SUPPORTED_LANGUAGES } from '../utils/common';

// Define game modes
type GameMode = 'local' | 'host' | 'join';

interface StartScreenProps {
  onStartGame: (options: GameOptions) => void;
  onUpdateOptions: (options: Partial<GameOptions>) => void;
  currentOptions: GameOptions;
}

// Define form validation interfacesetJoinCode
interface FormValidation {
  playerName: boolean;
  joinCode: boolean;
  gameSelection: boolean;
}

const StartScreen: React.FC<StartScreenProps> = ({ onStartGame, onUpdateOptions, currentOptions }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(currentOptions.language);
  const [selectedProxy, setSelectedProxy] = useState<number>(0);
  const [selectedStorage, setSelectedStorage] = useState<string>(currentOptions.storagePolicy);
  const [isPreloading, setIsPreloading] = useState(true);
  const [gameMode, setGameMode] = useState<GameMode>('local');
  const [joinCode, setJoinCode] = useState<string>('');
  const [joinCodeError, setJoinCodeError] = useState<string>('');
  const prefetchData = usePrefetchData();
  const minetestConsole = useMinetestConsole();

  // Find the initial proxy index based on currentOptions
  useEffect(() => {
    const index = PROXIES.findIndex(proxy => proxy[0] === currentOptions.proxy);
    if (index !== -1) {
      setSelectedProxy(index);
    }
  }, [currentOptions.proxy]);

  // Set isPreloading to false when the prefetching is done
  useEffect(() => {
    if (Object.values(prefetchData.status).every(status => status === 'done')) {
      setIsPreloading(false);
    }
  }, [prefetchData.status]);

  // Set default language based on browser locale
  useEffect(() => {
    const getDefaultLanguage = () => {
      const supportedLanguageMap = new Map(SUPPORTED_LANGUAGES);
      const fuzzy: string[] = [];
  
      for (let candidate of navigator.languages) {
        candidate = candidate.replaceAll('-', '_');
  
        if (supportedLanguageMap.has(candidate)) {
          return candidate;
        }
  
        // Try stripping off the country code
        const parts = candidate.split('_');
        if (parts.length > 2) {
          const rcandidate = parts.slice(0, 2).join('_');
          if (supportedLanguageMap.has(rcandidate)) {
            return rcandidate;
          }
        }
  
        // Try just matching the language code
        if (parts.length > 1) {
          if (supportedLanguageMap.has(parts[0])) {
            return parts[0];
          }
        }
  
        // Try fuzzy match (ignore country code of both)
        for (let entry of SUPPORTED_LANGUAGES) {
          if (entry[0].split('_')[0] === parts[0]) {
            fuzzy.push(entry[0]);
          }
        }
      }
  
      if (fuzzy.length > 0) {
        return fuzzy[0];
      }
  
      return 'en';
    };
    
    // Only override with browser language if we're using the default 'en'
    if (currentOptions.language === 'en') {
      const detectedLanguage = getDefaultLanguage();
      setSelectedLanguage(detectedLanguage);
      onUpdateOptions({ language: detectedLanguage });
    }
  }, []);

  // Handle language change
  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLanguage = e.target.value;
    setSelectedLanguage(newLanguage);
    onUpdateOptions({ language: newLanguage });
  };
  
  // Handle proxy change
  const handleProxyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const index = parseInt(e.target.value);
    setSelectedProxy(index);
    onUpdateOptions({ proxy: PROXIES[index][0] });
  };
  
  // Handle storage policy change
  const handleStoragePolicyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newPolicy = e.target.value;
    setSelectedStorage(newPolicy);
    onUpdateOptions({ storagePolicy: newPolicy });
  };
  
  // Handle game mode change
  const handleGameModeChange = (mode: GameMode) => {
    setGameMode(mode);
  };
  
  const handleStartGame = async () => {
    setIsLoading(true);
    try {
      // Get the selected proxy URL from the array
      const proxyUrl = PROXIES[selectedProxy][0];
      
      // Prepare game options
      const gameOptions: GameOptions = {
        language: selectedLanguage,
        proxy: proxyUrl,
        storagePolicy: selectedStorage,
        minetestArgs: currentOptions.minetestArgs,
        mode: gameMode,
        gameId: 'mineclone2'
      };
      
      if (gameMode === 'join') {
        gameOptions.joinCode = joinCode;
      }
      
      console.log('Starting game with options:', gameOptions);
      
      // Pass the selected options to the parent component
      onStartGame(gameOptions);
      
    } catch (error) {
      console.error('Error starting game:', error);
      minetestConsole.printErr(`Error: ${error}`);
      setIsLoading(false);
    }
  };

  const startGameDisabled = isLoading || isPreloading || (gameMode === 'join' && !!joinCodeError);

  return (
    <div 
      id="start_screen" 
      className="grid grid-cols-1 md:grid-cols-2 gap-8 w-screen h-screen p-8 overflow-hidden relative"
      style={{
        backgroundImage: `url('assets/minetest_screenshot.webp')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Overlay to darken the background */}
      <div className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm -z-10"></div>
      
      <div id="start_screen_left" className="flex flex-col justify-start p-5 overflow-y-auto rounded-xl text-lg bg-black bg-opacity-70 shadow-lg my-5 h-[calc(100vh-100px)] max-h-[calc(100vh-100px)] thin_scrollbar">
        <div id="start_screen_left_caption" className="flex flex-row items-center gap-4 text-4xl font-bold mb-8">
          <img src={`assets/minetest_logo.svg`} alt="Minetest Logo" className="w-20 h-20" />
          Minetest
        </div>
        
        <p className="mb-4">
          Welcome to the web version of Minetest, a free and open-source voxel game engine.
        </p>

        <p className="mb-4">
          This is a full-featured port of Minetest to the web using WebAssembly, allowing you to play
          directly in your browser without installing anything. There are some important things to know,
          so please read to the end of this screen.
        </p>
        
        <h2 className="text-2xl font-bold mt-4 mb-2">Controls</h2>
        <ul className="ml-6 mb-4 list-disc">
          <li className="mb-2">WASD - Movement</li>
          <li className="mb-2">Space - Jump</li>
          <li className="mb-2">Shift - Sneak</li>
          <li className="mb-2">I - Inventory</li>
          <li className="mb-2">Mouse - Look around</li>
          <li className="mb-2">1-8 - Hotbar slots</li>
          <li className="mb-2">N/B - Switch through hotbar slots</li>
          <li className="mb-2">C - Switch camera mode</li>
          <li className="mb-2">V - Switch minimap mode</li>
          <li className="mb-2">T/ESC - Toggle ingame console</li>
          <li className="mb-2">+/- - Change view distance</li>
          <li className="mb-2">ESC - Menu</li>
        </ul>

        <p className="mt-4">
          When you stop playing, always leave the world by opening the menu with ESC and selecting "Main menu". Then, wait several seconds before closing the Minetest plugin, to make sure your world saves are stored in your browser.
        </p>

        <p className="mt-4">
          You can toggle the game into fullscreen mode in the CG Sidebar.
        </p>
        
        <p className="mt-4">
          Play responsibly and enjoy building in this blocky world!
        </p>

        <p className="mt-4 italic">
          Note: This Common Ground plugin is not affiliated with the Minetest project.
          It started as a showcase of community gaming by one of the Common Ground
          founders, and then went beyond that.
        </p>

        <p className="mt-4 italic">
          <b>Updates</b>
          <ul className="simple-list">
            <li>Added persistent storage support with IndexedDB to save your worlds.</li>
            <li>Enhanced local storage management with statistics and cleanup tools.</li>
          </ul>
        </p>
          
        <p className="mt-4 italic">
          <b>A Tribute to the creators</b>
          <ul className="simple-list-non-bulleted">
            <li>Thanks to the Minetest team for the great game engine!</li>
            <li>Thanks to paradust7 for the WebAssembly port!</li>
            <li>Thanks to the Creators of Voxelibre, a Minecraft-like game mode for Minetest!</li>
            <li>Thanks to TSamuel for providing the Minetest logo on Wikipedia!</li>
            <li>Thanks to everyone contributing to open source software!</li>
          </ul>
        </p>
      </div>
      
      <div id="start_screen_right" className="flex flex-col gap-5 p-5 rounded-xl overflow-y-auto thin_scrollbar h-[calc(100vh-100px)] max-h-[calc(100vh-100px)]">
        <div className="bg-black bg-opacity-50 text-white p-5 rounded-xl shadow-lg">
          <h2 className="text-2xl font-bold mb-4">Launch Options</h2>
          
          <div className="form-controls-row flex gap-5 mb-4">
            <div className="flex-1">
              <label className="block mb-2">Select language</label>
              <select 
                id="select_language" 
                className="w-full p-3 rounded-lg border-2 border-gray-300 bg-white text-black"
                value={selectedLanguage}
                onChange={handleLanguageChange}
              >
                {SUPPORTED_LANGUAGES.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>
            </div>
            
            <div className="flex-1">
              <label className="block mb-2">Select network proxy</label>
              <select 
                id="select_proxy" 
                className="w-full p-3 rounded-lg border-2 border-gray-300 bg-white text-black"
                value={selectedProxy}
                onChange={handleProxyChange}
              >
                {PROXIES.map(([url, region], index) => (
                  <option key={url} value={index}>{region}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="form_row mb-4">
            <label className="block mb-2">Storage Mode</label>
            <select 
              className="w-full p-3 rounded-lg border-2 border-gray-300 bg-white text-black"
              value={selectedStorage}
              onChange={handleStoragePolicyChange}
            >
              <option value="indexeddb">Save worlds in browser</option>
              <option value="no-storage">No Storage</option>
            </select>
          </div>
          
          {/* Display prefetching status */}
          <div className="mb-4 mt-2">
            <div className="flex justify-between items-center">
              <span>Game packs:</span>
              <span className="text-sm">
                {Object.entries(prefetchData.status).length === 0 ? 'Waiting to load' : 
                 Object.values(prefetchData.status).every(status => status === 'done') ? 
                 'All packs loaded ✓' : 'Loading...'}
              </span>
            </div>
            <div className="mt-2">
              {Object.entries(prefetchData.status).map(([file, status]) => (
                <div key={file} className="text-xs flex justify-between">
                  <span>{file.split('/').pop()}</span>
                  <span>{typeof status === 'number' ? status > 100 ? `${Math.floor(status / 1000)}kB ⏳` : `${Math.floor(status * 100)}% ⏳` : status === 'done' ? '✓' : '❌'}</span>
                </div>
              ))}
            </div>
          </div>
          
          {/* Game Mode Selection */}
          <div className="mb-5">
            <label className="block mb-2">Game Mode</label>
            <div className="flex gap-2">
              <button 
                onClick={() => handleGameModeChange('local')}
                className={`flex-1 p-3 rounded-lg transition ${gameMode === 'local' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-black hover:bg-gray-300'}`}
              >
                Local only
              </button>
              <button 
                onClick={() => handleGameModeChange('host')}
                className={`flex-1 p-3 rounded-lg transition ${gameMode === 'host' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-black hover:bg-gray-300'}`}
              >
                Host game
              </button>
              <button 
                onClick={() => handleGameModeChange('join')}
                className={`flex-1 p-3 rounded-lg transition ${gameMode === 'join' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-black hover:bg-gray-300'}`}
              >
                Join game
              </button>
            </div>
          </div>
          
          {/* Form fields for the selected game mode */}
          {gameMode === 'host' && (
            <div className="mb-5 p-4 border border-gray-300 rounded-lg">
              <h3 className="text-xl mb-3">Host Game</h3>
              
              <div className="mb-3">
                This will run the game in hosting mode, and create a join code you can share with your friends.
                <ul className="text-sm list-disc ml-4">
                  <li>Click "Start Game"</li>
                  <li>Select or create a world</li>
                  <li>Toggle the "host server" checkbox, leave the port at 30000</li>
                  <li>Choose a name and password for your own player</li>
                  <li>Hover the settings icon in the top right corner of the game</li>
                  <li>Copy the join code and share it with your friends</li>
                  <li>Also tell your friends the proxy you're using, or it won't work</li>
                  <li>Now start the game. Your friends can connect as soon as the world is loaded and running</li>
                  <li>To make sure your savegames are stored, always leave the world by opening the menu with ESC and selecting "Main menu", and then wait several seconds when back in the main menu before closing the Minetest plugin</li>
                  <li>Only share the join code with your friends, since the server will run on your own computer</li>
                </ul>
              </div>
            </div>
          )}
          
          {gameMode === 'join' && (
            <div className="mb-5 p-4 border border-gray-300 rounded-lg">
              <h3 className="text-xl mb-3">Join Game</h3>
              
              <div className="mb-3">
                This will run the game in joining mode, and allow you to connect to a game hosted by your friend.
                <ul className="text-sm list-disc ml-4">
                  <li>Enter the join code you got from your friend</li>
                  <li>Use the same proxy setting as your friend, or it won't work</li>
                  <li>Click "Start Game"</li>
                  <li>Once in the game, go to "Join Game". Enter 172.16.0.1 as the server address and leave 30000 as the port</li>
                  <li>You can also see this server address in the settings menu, which you can open by hovering the settings icon in the top right corner</li>
                  <li>If this is the first time joining your friend's world, you'll need to click "Register" and create a player name and password</li>
                  <li>If you already have a player name and password in that world, enter them and click "Login"</li>
                  <li>Tip: Use the same player name and password in all worlds, to make it easier to remember them. Don't use a password you use elsewhere</li>
                  <li>Click "Join Game" and enjoy!</li>
                </ul>
              </div>

              <div className="mb-3">
                <label className="block mb-2">Join Code</label>
                <input 
                  type="text" 
                  className="w-full p-3 rounded-lg border-2 border-gray-300 bg-white text-black"
                  value={joinCode}
                  onChange={(e) => {
                    const code = e.target.value.trim();
                    setJoinCode(code);
                    if (!/^[A-F0-9]{12}$/.test(code)) {
                      setJoinCodeError('Join code must be 12 digits (0-9, A-F)');
                    } else {
                      setJoinCodeError('');
                    }
                  }}
                />
                {joinCodeError && <p className="text-red-500 text-sm">{joinCodeError}</p>}
              </div>
            </div>
          )}
          
          <button 
            onClick={handleStartGame}
            disabled={startGameDisabled}
            className={`w-full p-4 rounded-lg text-white font-bold shadow-md transition transform hover:translate-y-[-2px] ${
              startGameDisabled ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isLoading || isPreloading ? 'Loading...' : 'Start Game'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StartScreen; 