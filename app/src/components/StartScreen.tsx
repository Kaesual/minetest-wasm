import React, { useState, useEffect, useMemo } from 'react';
import { useMinetestConsole, usePrefetchData, useStorageManager } from '../utils/GlobalContext';
import { type GameOptions } from '@/App';

interface StartScreenProps {
  onStartGame: (options: GameOptions) => void;
  onUpdateOptions: (options: Partial<GameOptions>) => void;
  currentOptions: GameOptions;
}

const StartScreen: React.FC<StartScreenProps> = ({ onStartGame, onUpdateOptions, currentOptions }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(currentOptions.language);
  const [selectedProxy, setSelectedProxy] = useState<number>(0);
  const [selectedStorage, setSelectedStorage] = useState<string>(currentOptions.storagePolicy);
  const [isPreloading, setIsPreloading] = useState(true);
  const prefetchData = usePrefetchData();
  const minetestConsole = useMinetestConsole();
  
  // Language options from the original launcher.js
  const SUPPORTED_LANGUAGES: [string, string][] = useMemo(() => [
    ['be', "Беларуская [be]"],
    ['bg', "Български [bg]"],
    ['ca', "Català [ca]"],
    ['cs', "Česky [cs]"],
    ['cy', "Cymraeg [cy]"],
    ['da', "Dansk [da]"],
    ['de', "Deutsch [de]"],
    ['el', "Ελληνικά [el]"],
    ['en', "English [en]"],
    ['eo', "Esperanto [eo]"],
    ['es', "Español [es]"],
    ['et', "Eesti [et]"],
    ['eu', "Euskara [eu]"],
    ['fi', "Suomi [fi]"],
    ['fil', "Wikang Filipino [fil]"],
    ['fr', "Français [fr]"],
    ['gd', "Gàidhlig [gd]"],
    ['gl', "Galego [gl]"],
    ['hu', "Magyar [hu]"],
    ['id', "Bahasa Indonesia [id]"],
    ['it', "Italiano [it]"],
    ['ja', "日本語 [ja]"],
    ['jbo', "Lojban [jbo]"],
    ['kk', "Қазақша [kk]"],
    ['ko', "한국어 [ko]"],
    ['ky', "Kırgızca / Кыргызча [ky]"],
    ['lt', "Lietuvių [lt]"],
    ['lv', "Latviešu [lv]"],
    ['mn', "Монгол [mn]"],
    ['mr', "मराठी [mr]"],
    ['ms', "Bahasa Melayu [ms]"],
    ['nb', "Norsk Bokmål [nb]"],
    ['nl', "Nederlands [nl]"],
    ['nn', "Norsk Nynorsk [nn]"],
    ['oc', "Occitan [oc]"],
    ['pl', "Polski [pl]"],
    ['pt', "Português [pt]"],
    ['pt_BR', "Português do Brasil [pt_BR]"],
    ['ro', "Română [ro]"],
    ['ru', "Русский [ru]"],
    ['sk', "Slovenčina [sk]"],
    ['sl', "Slovenščina [sl]"],
    ['sr_Cyrl', "Српски [sr_Cyrl]"],
    ['sr_Latn', "Srpski (Latinica) [sr_Latn]"],
    ['sv', "Svenska [sv]"],
    ['sw', "Kiswahili [sw]"],
    ['tr', "Türkçe [tr]"],
    ['tt', "Tatarça [tt]"],
    ['uk', "Українська [uk]"],
    ['vi', "Tiếng Việt [vi]"],
    ['zh_CN', "中文 (简体) [zh_CN]"],
    ['zh_TW', "正體中文 (繁體) [zh_TW]"],
  ], []);
  
  // Proxy options from the original index.html
  const proxies: [string, string][] = useMemo(() => [
    ["wss://na1.dustlabs.io/mtproxy", "North America"],
    ["wss://sa1.dustlabs.io/mtproxy", "South America"],
    ["wss://eu1.dustlabs.io/mtproxy", "Europe"],
    ["wss://ap1.dustlabs.io/mtproxy", "Asia"],
    ["wss://ap2.dustlabs.io/mtproxy", "Australia"],
  ], []);

  // Find the initial proxy index based on currentOptions
  useEffect(() => {
    const index = proxies.findIndex(proxy => proxy[0] === currentOptions.proxy);
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
    onUpdateOptions({ proxy: proxies[index][0] });
  };
  
  // Handle storage policy change
  const handleStoragePolicyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newPolicy = e.target.value;
    setSelectedStorage(newPolicy);
    onUpdateOptions({ storagePolicy: newPolicy });
  };
  
  const handleStartGame = async () => {
    setIsLoading(true);
    try {
      // Get the selected proxy URL from the array
      const proxyUrl = proxies[selectedProxy][0];
      
      console.log('Starting game with options:', {
        language: selectedLanguage,
        proxy: proxyUrl,
        storagePolicy: selectedStorage
      });
      
      // Pass the selected options to the parent component
      onStartGame({
        language: selectedLanguage,
        proxy: proxyUrl,
        storagePolicy: selectedStorage
      });
      
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
      
      <div id="start_screen_right" className="flex flex-col gap-5 p-5 rounded-xl">
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
                {proxies.map(([url, region], index) => (
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
              <option value="indexeddb">IndexedDB (Save worlds and mods)</option>
              <option value="no-storage">No Storage (Nothing saved)</option>
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
          
          <button 
            onClick={handleStartGame}
            disabled={isLoading || isPreloading}
            className={`w-full p-4 rounded-lg text-white font-bold shadow-md transition transform hover:translate-y-[-2px] ${
              isLoading ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isLoading || isPreloading ? 'Loading...' : 'Start Game'}
          </button>
        </div>
        
        <div className="bg-black bg-opacity-75 p-4 rounded-xl h-64 overflow-y-auto thin_scrollbar">
          <pre className="text-green-400 font-mono text-sm whitespace-pre-wrap">
            {minetestConsole.messages.length > 0 ? minetestConsole.messages.join('\n') : 'Console output will appear here...'}
          </pre>
        </div>
        
        <div className="text-xs text-center text-gray-300 mt-2">
          Minetest for the Web - WebAssembly Build
        </div>
      </div>
    </div>
  );
};

export default StartScreen; 