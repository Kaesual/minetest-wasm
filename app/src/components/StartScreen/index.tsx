import React, { useState, useEffect, useCallback } from 'react';
import { useMinetestConsole, usePrefetchData, useStorageManager } from '../../utils/GlobalContext';
import { type GameId, type GameOptions } from '../../App';
import { GAME_IDS, PROXIES, SUPPORTED_LANGUAGES } from '../../utils/common';

// Define game modes
type GameMode = 'local' | 'host' | 'join';

interface StartScreenProps {
  onStartGame: (options: GameOptions) => void;
  updateGameOptions: (options: Partial<GameOptions>) => void;
  currentOptions: GameOptions;
  zipLoaderPromise: Promise<Uint8Array> | null;
  setZipLoaderPromise: (promise: Promise<Uint8Array> | null) => void;
}

// Define form validation interfacesetJoinCode
interface FormValidation {
  playerName: boolean;
  joinCode: boolean;
  gameSelection: boolean;
}

const StartScreen: React.FC<StartScreenProps> = ({ onStartGame, updateGameOptions, currentOptions, zipLoaderPromise, setZipLoaderPromise }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingZip, setIsLoadingZip] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(currentOptions.language);
  const [selectedProxy, _setSelectedProxy] = useState<number>(parseInt(localStorage.getItem('luanti_wasm_selected_proxy') || '0'));
  const [selectedStorage, setSelectedStorage] = useState<string>(currentOptions.storagePolicy);
  const [isPreloading, setIsPreloading] = useState(true);
  const [selectedGameId, setSelectedGameId] = useState<GameId>('mineclone2');
  const [gameMode, setGameMode] = useState<GameMode>('local');
  const [joinCodeString, setJoinCodeString] = useState<string>('');
  const [joinCode, setJoinCode] = useState<string>('');
  const [joinCodeError, setJoinCodeError] = useState<string>('');
  const [playerName, setPlayerName] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [joinProxyIndex, setJoinProxyIndex] = useState<number>(-1);
  const [joinCodeStringValid, setJoinCodeStringValid] = useState<boolean>(false);
  const prefetchData = usePrefetchData();
  const minetestConsole = useMinetestConsole();
  const storageManager = useStorageManager();

  const setSelectedProxy = (index: number) => {
    _setSelectedProxy(index);
    localStorage.setItem('luanti_wasm_selected_proxy', index.toString());
  };

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

  // Initialize the storage manager
  useEffect(() => {
    if (storageManager) {
      storageManager.initialize({ policy: selectedStorage }, minetestConsole);
    }
  }, [storageManager, selectedStorage]);

  // Keep the storage manager updated with the minetest console
  useEffect(() => {
    if (storageManager && minetestConsole) {
      storageManager.setMinetestConsole(minetestConsole);
    }
  }, [storageManager, minetestConsole]);

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
      updateGameOptions({ language: detectedLanguage });
    }
  }, []);

  // Handle language change
  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLanguage = e.target.value;
    setSelectedLanguage(newLanguage);
    updateGameOptions({ language: newLanguage });
  };
  
  // Handle proxy change
  const handleProxyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const index = parseInt(e.target.value);
    setSelectedProxy(index);
    updateGameOptions({ proxy: PROXIES[index][0] });
  };
  
  // Handle storage policy change
  const handleStoragePolicyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newPolicy = e.target.value;
    setSelectedStorage(newPolicy);
    updateGameOptions({ storagePolicy: newPolicy });
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
        gameId: selectedGameId,
      };
      
      if (gameMode === 'join') {
        if (!joinCode || !playerName || joinProxyIndex === -1) {
          throw new Error('Join code, player name and proxy are required');
        }
        gameOptions.joinCode = joinCode;
        gameOptions.playerName = playerName;
        if (Boolean(password)) {
          gameOptions.password = password;
        }
        gameOptions.proxy = PROXIES[joinProxyIndex][0];
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

  const zipFileChangeHandler = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsLoadingZip(true);
      const promise = new Promise<Uint8Array>((resolve, reject) => {
        try {
          const reader = new FileReader();
          reader.onload = (e) => {
            const arrayBuffer = e.target?.result as ArrayBuffer;
            resolve(new Uint8Array(arrayBuffer));
          };
          reader.onerror = (e) => {
            minetestConsole.printErr(`Error reading zip file: ${reader.error?.message}`);
            reject(e);
          };
          reader.readAsArrayBuffer(file);
        } catch (e) {
          reject(e);
        }
      });
      setZipLoaderPromise(promise);
      promise.finally(() => {
        setIsLoadingZip(false);
      });
    }
  }, [setZipLoaderPromise, minetestConsole]);

  const joinCodeFieldChangeHandler = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setJoinCodeString(e.target.value);
    let data = e.target.value.trim();
    try {
      if (!(/^[A-F0-9]{12}_[0-9]+_[0-9]+$/.test(data))) {
        setJoinCodeError('Invalid join code');
        return;
      }
      const [code, gameIdIndexString, proxyString] = data.split('_');
      const gameIdIndex = parseInt(gameIdIndexString);
      if (gameIdIndex < 0 || gameIdIndex >= GAME_IDS.length) {
        setJoinCodeError('Invalid game ID');
        return;
      }
      const proxyIndex = parseInt(proxyString);
      if (!proxyIndex || typeof proxyIndex !== 'number' || proxyIndex < 0 || proxyIndex >= PROXIES.length) {
        setJoinCodeError('Invalid proxy');
        return;
      }
      setSelectedGameId(GAME_IDS[gameIdIndex]);
      setJoinCode(code);
      setJoinProxyIndex(proxyIndex);
      setJoinCodeStringValid(true);
    } catch (e) {
      setJoinCodeError('Join code is invalid');
      setJoinCodeStringValid(false);
    }
  }, []);

  let startGameDisabled = isLoading || isPreloading || (gameMode === 'join' && !!joinCodeError) || isLoadingZip;
  if (gameMode === 'join' && (!playerName || joinProxyIndex === -1 || !joinCode || !joinCodeString || !joinCodeStringValid)) {
    startGameDisabled = true;
  }
  const isStandalone = window.location.href.includes('standalone');

  const smallStartGameButton = (
    <div className="text-center">
      <button 
        onClick={handleStartGame}
        disabled={startGameDisabled}
        className={`w-full px-4 py-2 mt-2 rounded-lg text-white font-bold shadow-md transition transform hover:translate-y-[-2px] ${
          startGameDisabled ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {isLoading || isPreloading ? 'Loading...' : 'Start Game'}
      </button>
    </div>
  );

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
        <div id="start_screen_left_caption" className="flex flex-row items-center gap-4 text-4xl font-bold mb-6">
          <img src={`assets/minetest_logo.svg`} alt="Minetest Logo" className="w-20 h-20" />
          Luanti
        </div>
        
        <p>
          Welcome to the experimental web version of Luanti (also known as Minetest), a free and open-source voxel game engine.
        </p>

        <p className="mt-4">
          When you stop playing, always leave the world by opening the menu with ESC and selecting "Main menu".
          Then, hover the settings icon in the top right corner of the game and select "Sync".
          You can also download your worlds as zip file, and restore them later.
        </p>

        {!isStandalone && <p className="mt-4">
          You can toggle the game into fullscreen mode in the CG Sidebar.
        </p>}
        
        <p className="mt-4">
          Play responsibly and enjoy building in this blocky world!
        </p>

        {!isStandalone && <p className="mt-4 italic">
          Note: This Common Ground plugin is not affiliated with the Minetest project.
          It acts as a showcase for gaming on app.cg. If you want to get in touch, use
          the community chat channels.
        </p>}
        {isStandalone && <p className="mt-4 italic">
          Note: This Luanti game client has been created by the Common Ground team. If 
          you enjoy the game and want to get in touch, join the 
          official <a href="https://app.cg/c/commongames" target="_blank" style={{textDecoration: 'underline', fontWeight: 'bold'}}>Common Games Community on app.cg</a>. You can 
          play the game there, too, and also chat, play and stream with other people.
        </p>}

        <h2 className="text-2xl font-bold mt-4 mb-2">New Features</h2>
        <ul className="ml-6 mb-4 list-disc">
          <li>Persistent storage support with IndexedDB to save your worlds.</li>
          <li>Back up to zip file, and restore from zip file.</li>
          <li>Ingame settings overlay menu.</li>
          <li>Console overlay menu.</li> 
          <li>This loader frontend.</li>
        </ul>

        <h2 className="text-2xl font-bold my-2">Controls</h2>
        <ul className="ml-6 mb-4 list-disc">
          <li>WASD - Movement</li>
          <li>Space - Jump</li>
          <li>Shift - Sneak</li>
          <li>I - Inventory</li>
          <li>Mouse - Look around</li>
          <li>1-8 - Hotbar slots</li>
          <li>N/B - Switch through hotbar slots</li>
          <li>C - Switch camera mode</li>
          <li>V - Switch minimap mode</li>
          <li>T/ESC - Toggle ingame console</li>
          <li>+/- - Change view distance</li>
          <li>ESC - Menu</li>
        </ul>
          
        <p className="mt-4 italic">
          <b>A Tribute to the Creators</b>
          <ul className="simple-list-non-bulleted">
            <li>Thanks to the Minetest team for the great game engine!</li>
            <li>Thanks to paradust7 for the amazing WebAssembly port and the proxies!</li>
            <li>Thanks to the Creators of Voxelibre, a Minecraft-like game mode for Minetest!</li>
            <li>Thanks to TSamuel for providing the Minetest logo on Wikipedia!</li>
            <li>Thanks to everyone contributing to open source software!</li>
          </ul>
        </p>
      </div>
      
      <div id="start_screen_right" className="flex flex-col gap-5 p-5 rounded-xl overflow-y-auto thin_scrollbar h-[calc(100vh-100px)] max-h-[calc(100vh-100px)]">
        <div className="bg-black bg-opacity-50 text-white p-5 rounded-xl shadow-lg">
          <button 
            onClick={handleStartGame}
            disabled={startGameDisabled}
            className={`w-full px-4 py-8 mb-2 rounded-lg text-white text-2xl font-bold shadow-md transition transform hover:translate-y-[-2px] ${
              startGameDisabled ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isLoading || isPreloading ? 'Loading...' : 'Start Game'}
          </button>

          <div className="mb-4 text-xs text-gray-300 flex justify-between items-center">
            <span className="text-sm">
              {Object.entries(prefetchData.status).length === 0 ? 'preparing ' : 
                Object.values(prefetchData.status).every(status => status === 'done') ? 
                'all loaded ✓ ' : 'loading '}
            </span>
            <span className="text-sm flex flex-row gap-1">
              {Object.entries(prefetchData.status).map(([file, status]) => (
                <div key={file} className="text-xs flex gap-1">
                  <span>{file.split('/').pop()}</span>
                  <span>{typeof status === 'number' ? status > 100 ? `${Math.floor(status / 1000)}kB` : `${Math.floor(status * 100)}%` : status === 'done' ? '✓' : '❌'}</span>
                </div>
              ))}
            </span>
          </div>

          <h2 className="text-2xl font-bold mb-2">Launch Options</h2>
          
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

          <div className="form_row mb-4">
            <label className="block mb-2">Select Game to pre-load</label>
            <select 
              className="w-full p-3 rounded-lg border-2 border-gray-300 bg-white text-black"
              value={selectedGameId}
              onChange={(ev) => {
                setSelectedGameId(ev.target.value as GameOptions['gameId']);
              }}
            >
              <option value="mineclone2">VoxeLibre 0.90.1 (rich minecraft-like game, recommended)</option>
              <option value="glitch">Glitch 1.3.2 (story mode game, recommended)</option>
              <option value="mineclonia">Mineclonia 0.116.1 (currently broken, some LUA error)</option>
              <option value="minetest_game">Minetest Game (only building, no mobs)</option>
            </select>
          </div>

          <div className="form_row mb-4">
            <label className="block mb-2">Restore worlds from zip file</label>
            {!!zipLoaderPromise && <div>
              <p className="text-yellow-500 mb-2">
                ⚠️ The zip file will be applied when you start the game.
                Your current worlds will be LOST!
              </p>
            </div>}
            <div className="flex flex-row gap-2">
              <input
                type="file"
                accept=".zip"
                disabled={isLoadingZip}
                onChange={zipFileChangeHandler}
              />
              {!!zipLoaderPromise && <button
                className="bg-blue-600 hover:bg-blue-700 text-white rounded p-1 px-3 text-sm"
                onClick={(ev) => {
                  setZipLoaderPromise(null);
                  // Hacky: clear the file input field
                  const input = ev.currentTarget.previousElementSibling as HTMLInputElement;
                  if (input && input.files) {
                    input.value = '';
                  }
                }}
              >Clear selected file</button>}
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
                Normal
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
          {gameMode === 'local' && (
            <div className="mb-5 p-4 border border-gray-300 rounded-lg">
              <h3 className="text-xl mb-3">Normal Game Mode</h3>

              <div className="mb-3">
                This will run the game in normal mode, and allow you to play alone or with others on public servers.
                <ul className="text-sm list-disc ml-4">
                  <li>You can join public servers and play with other people on them</li>
                  <li>If you want to play with your friends directly, use "Host game" or "Join game" instead</li>
                </ul>
              </div>

              {smallStartGameButton}
            </div>
          )}

          {gameMode === 'host' && (
            <div className="mb-5 p-4 border border-gray-300 rounded-lg">
              <h3 className="text-xl mb-3">Host Game Mode (read this!)</h3>
              
              <div className="mb-3">
                This will run the game in hosting mode, and create a join code you can share with your friends.
                <ul className="text-sm list-disc ml-4">
                  <li>Click "Start Game" and select or create a world</li>
                  <li>Enable the <b>host server</b> and <b>publish server</b> checkboxes, leave the port at 30000</li>
                  <li>Choose a <b>name</b> and <b>password</b> for your own player, and start the game</li>
                  <li><b>AFTER the game has loaded</b>, hover the settings icon in the top right corner of the game</li>
                  <li>There, copy the join code and share it with your friends</li>
                  <li>Do not leave the game browser tab for long while you're hosting, otherwise your players will encounter network errors</li>
                  <li>Player names and passwords are <b>per-world</b>, so you'll have to remember them per-world</li>
                  <li>Tip: Always use the same name and password, but don't use a sensitive one</li>
                  <li>To make sure your savegames are saved correctly, always leave the world by opening the menu with ESC and selecting "Main menu". When you're back in the main menu, open the settings menu again and click "Sync Now" or "Sync & Download"</li>
                </ul>
              </div>

              {smallStartGameButton}
            </div>
          )}
          
          {gameMode === 'join' && (
            <div className="mb-5 p-4 border border-gray-300 rounded-lg">
              <h3 className="text-xl mb-3">Join Game Mode (read this!)</h3>
              
              <div className="mb-3">
                This will run the game in joining mode, and allow you to connect to a game hosted by your friend.
                <ul className="text-sm list-disc ml-4">
                  <li>Enter the join code you got from your friend</li>
                  <li>Choose a player name and password for your own player, and click "Start Game"</li>
                  <li>Player names and passwords are <b>per-world</b>, so you'll have to remember them per-world</li>
                  <li>Tip: Always use the same name and password, but be aware that when you join someone else's world, they might have access to that password, so don't use a sensitive one</li>
                  <li>To leave the game, open the menu with ESC and select "Main menu". The exit screen will get stuck in "Shutting down...", hover the settings icon in the top right corner and click "Force reload" then</li>
                </ul>
              </div>

              <div className="mb-3">
                <label className="block mb-2">Join Code *</label>
                <input 
                  type="text" 
                  className="w-full p-3 rounded-lg border-2 border-gray-300 bg-white text-black"
                  value={joinCodeString}
                  onChange={joinCodeFieldChangeHandler}
                />
                {joinCodeError && <p className="text-red-500 text-sm">{joinCodeError}</p>}
              </div>

              <div className="mb-3">
                <label className="block mb-2">Player Name *</label>
                <input 
                  type="text" 
                  className="w-full p-3 rounded-lg border-2 border-gray-300 bg-white text-black"
                  value={playerName}
                  onChange={(e) => {
                    setPlayerName(e.target.value);
                  }}
                />
              </div>

              <div className="mb-3">
                <label className="block mb-2">Password</label>
                <input 
                  type="text" 
                  className="w-full p-3 rounded-lg border-2 border-gray-300 bg-white text-black"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                  }}
                />
              </div>

              {smallStartGameButton}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StartScreen; 