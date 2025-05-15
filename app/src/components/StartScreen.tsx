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

// Define form validation interface
interface FormValidation {
  playerName: boolean;
  joinCode: boolean;
  newGameName: boolean;
  gameSelection: boolean;
}

const StartScreen: React.FC<StartScreenProps> = ({ onStartGame, onUpdateOptions, currentOptions }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(currentOptions.language);
  const [selectedProxy, setSelectedProxy] = useState<number>(0);
  const [selectedStorage, setSelectedStorage] = useState<string>(currentOptions.storagePolicy);
  const [isPreloading, setIsPreloading] = useState(true);
  const [gameMode, setGameMode] = useState<GameMode>('local');
  const [playerName, setPlayerName] = useState<string>('');
  const [joinCode, setJoinCode] = useState<string>('');
  const [selectedGame, setSelectedGame] = useState<string>('');
  const [newGameName, setNewGameName] = useState<string>('');
  const [existingGames, setExistingGames] = useState<string[]>([]);
  const [validationErrors, setValidationErrors] = useState<FormValidation>({
    playerName: true,
    joinCode: true,
    newGameName: true,
    gameSelection: true
  });
  const [touched, setTouched] = useState<FormValidation>({
    playerName: false,
    joinCode: false,
    newGameName: false,
    gameSelection: false
  });
  const storageManager = useStorageManager();
  const prefetchData = usePrefetchData();
  const minetestConsole = useMinetestConsole();

  useEffect(() => {
    let mounted = true;
    if (!!storageManager && storageManager?.isInitialized === false) {
      storageManager.initialize({ policy: selectedStorage }).then(() => {
        mounted && storageManager.getWorlds().then(worlds => {
          mounted && setExistingGames(worlds);
        });
      });
    }
    return () => {
      mounted = false;
    }
  }, [storageManager]);

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

  // Validate form fields
  useEffect(() => {
    const errors = {
      playerName: true,
      joinCode: true,
      newGameName: true,
      gameSelection: true
    };

    // Validate player name for host and join modes
    if ((gameMode === 'host' || gameMode === 'join') && !playerName.trim()) {
      errors.playerName = false;
    }

    // Validate join code for join mode
    if (gameMode === 'join' && !joinCode.trim()) {
      errors.joinCode = false;
    }

    // Validate game selection for host mode
    if (gameMode === 'host') {
      // If creating a new game, validate new game name
      if (selectedGame === '') {
        // Check if name is valid (a-zA-Z0-9 and spaces, 1-20 chars)
        const isValid = /^[\w\s]{1,20}$/.test(newGameName) && !existingGames.includes(newGameName);
        errors.newGameName = newGameName.trim() !== '' && isValid;
      } else {
        // If an existing game is selected, this validation is passed
        errors.newGameName = true;
      }
      
      // Validate that either an existing game is selected or a new game name is provided
      errors.gameSelection = selectedGame !== '' || (selectedGame === '' && errors.newGameName);
    }

    setValidationErrors(errors);
  }, [gameMode, playerName, joinCode, selectedGame, newGameName, existingGames]);

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
    
    // Reset touched state when changing mode
    setTouched({
      playerName: false,
      joinCode: false,
      newGameName: false,
      gameSelection: false
    });
  };

  // Mark field as touched
  const markAsTouched = (field: keyof FormValidation) => {
    setTouched(prev => ({ ...prev, [field]: true }));
  };
  
  // Check if form is valid
  const isFormValid = useMemo(() => {
    if (gameMode === 'local') return true;
    
    if (gameMode === 'host') {
      return validationErrors.playerName && validationErrors.gameSelection;
    }
    
    if (gameMode === 'join') {
      return validationErrors.playerName && validationErrors.joinCode;
    }
    
    return false;
  }, [gameMode, validationErrors]);
  
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
        mode: gameMode
      };
      
      // Add additional options based on game mode
      if (gameMode === 'host' || gameMode === 'join') {
        gameOptions.playerName = playerName;
      }
      
      if (gameMode === 'host') {
        gameOptions.selectedGame = selectedGame !== '' ? selectedGame : undefined;
        if (selectedGame === '') {
          gameOptions.newGameName = newGameName;
        }
      }
      
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
              <h3 className="text-xl mb-3">Host Game Settings</h3>
              
              <div className="mb-3">
                <label className="block mb-1">
                  Player Name {touched.playerName && !validationErrors.playerName && <span className="text-yellow-300 text-sm">*required</span>}
                </label>
                <input 
                  type="text" 
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  onBlur={() => markAsTouched('playerName')}
                  className={`w-full p-2 rounded-lg border-2 ${touched.playerName && !validationErrors.playerName ? 'border-yellow-300' : 'border-gray-300'} bg-white text-black`}
                  placeholder="Enter your player name"
                  maxLength={20}
                />
              </div>
              
              <div className="mb-3">
                <label className="block mb-1">Game Selection</label>
                <select 
                  className={`w-full p-2 rounded-lg border-2 ${touched.gameSelection && !validationErrors.gameSelection ? 'border-yellow-300' : 'border-gray-300'} bg-white text-black`}
                  value={selectedGame}
                  onChange={(e) => {
                    setSelectedGame(e.target.value);
                    markAsTouched('gameSelection');
                  }}
                >
                  <option value="" disabled>Please choose</option>
                  <option value="/">Create new game</option>
                  {existingGames.map(game => (
                    <option key={game} value={game}>{game}</option>
                  ))}
                </select>
              </div>
              
              {selectedGame === '/' && (
                <div className="mb-3">
                  <label className="block mb-1">
                    New Game Name {touched.newGameName && !validationErrors.newGameName && <span className="text-yellow-300 text-sm">*required, use only letters, numbers, and spaces (max 20 chars)</span>}
                  </label>
                  <input 
                    type="text" 
                    value={newGameName}
                    onChange={(e) => setNewGameName(e.target.value)}
                    onBlur={() => markAsTouched('newGameName')}
                    className={`w-full p-2 rounded-lg border-2 ${touched.newGameName && !validationErrors.newGameName ? 'border-yellow-300' : 'border-gray-300'} bg-white text-black`}
                    placeholder="Enter name for new game"
                    maxLength={20}
                  />
                  {touched.newGameName && newGameName.trim() !== '' && existingGames.includes(newGameName) && (
                    <div className="text-yellow-300 text-sm mt-1">This game name already exists</div>
                  )}
                </div>
              )}
              
              <div className="text-sm text-yellow-300 mt-2">
                <strong>Note:</strong> Make sure to tell your friends which proxy you're using!
              </div>
            </div>
          )}
          
          {gameMode === 'join' && (
            <div className="mb-5 p-4 border border-gray-300 rounded-lg">
              <h3 className="text-xl mb-3">Join Game Settings</h3>
              
              <div className="mb-3">
                <label className="block mb-1">
                  Player Name {touched.playerName && !validationErrors.playerName && <span className="text-yellow-300 text-sm">*required</span>}
                </label>
                <input 
                  type="text" 
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  onBlur={() => markAsTouched('playerName')}
                  className={`w-full p-2 rounded-lg border-2 ${touched.playerName && !validationErrors.playerName ? 'border-yellow-300' : 'border-gray-300'} bg-white text-black`}
                  placeholder="Enter your player name"
                  maxLength={20}
                />
              </div>
              
              <div className="mb-3">
                <label className="block mb-1">
                  Join Code {touched.joinCode && !validationErrors.joinCode && <span className="text-yellow-300 text-sm">*required</span>}
                </label>
                <input 
                  type="text" 
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  onBlur={() => markAsTouched('joinCode')}
                  className={`w-full p-2 rounded-lg border-2 ${touched.joinCode && !validationErrors.joinCode ? 'border-yellow-300' : 'border-gray-300'} bg-white text-black`}
                  placeholder="Enter the code from your friend"
                />
              </div>
              
              <div className="text-sm text-yellow-300 mt-2">
                <strong>Note:</strong> You must select the same proxy as the host!
              </div>
            </div>
          )}
          
          <button 
            onClick={handleStartGame}
            disabled={isLoading || isPreloading || !isFormValid}
            className={`w-full p-4 rounded-lg text-white font-bold shadow-md transition transform hover:translate-y-[-2px] ${
              isLoading || isPreloading || !isFormValid ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isLoading || isPreloading ? 'Loading...' : 'Start Game'}
          </button>
        </div>
        
        <div className="text-xs text-center text-gray-300 mt-2">
          Minetest for the Web - WebAssembly Build
        </div>
      </div>
    </div>
  );
};

export default StartScreen; 