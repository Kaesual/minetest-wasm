import React, { useEffect, useRef, useState, useLayoutEffect, useCallback } from 'react';
import { MinetestConsole, useMinetestConsole, usePrefetchData, useStorageManager } from '../utils/GlobalContext';
import SnackBar from './SnackBar';
import { type GameOptions } from '@/App';

// Define global types to match the original launcher.js
interface Window {
  emloop_ready: () => void;
  emloop_request_animation_frame: () => void;
  Module: any;
}

interface RuntimeScreenProps {
  gameOptions: GameOptions;
  onGameStatus: (status: 'running' | 'failed') => void;
}

declare global {
  interface Window {
    emloop_ready?: () => void;
    emloop_request_animation_frame?: () => void;
    Module: any;
    emloop_pause: any;
    emloop_unpause: any;
    emloop_init_sound: any;
    emloop_invoke_main: any;
    emloop_install_pack: any;
    emloop_set_minetest_conf: any;
    irrlicht_want_pointerlock: any;
    irrlicht_force_pointerlock: any;
    irrlicht_resize: any;
    emsocket_init: any;
    emsocket_set_proxy: any;
    emsocket_set_vpn: any;
    cwrap: (name: string, returnType: string | null, argTypes: string[]) => any;
    stringToNewUTF8: (text: string) => number;
    _malloc: (size: number) => number;
    _free: (ptr: number) => void;
    HEAPU8: Uint8Array;
  }
}

// Class to handle resource packs similar to the original launcher
class PackManager {
  private addedPacks = new Set<string>();
  private installedPacks = new Set<string>();
  private packPromises = new Map<string, Promise<void>>();
  private minetestConsole: MinetestConsole;
  
  constructor(minetestConsole: MinetestConsole) {
    this.minetestConsole = minetestConsole;
  }
  
  async addPack(name: string, prefetchData: Uint8Array): Promise<void> {
    if (name === 'devtest' || this.addedPacks.has(name)) {
      return;
    }
    
    this.addedPacks.add(name);
    
    if (this.packPromises.has(name)) {
      return this.packPromises.get(name);
    }
    
    const promise = this.installPrefetchedPack(name, prefetchData);
    this.packPromises.set(name, promise);
    return promise;
  }
  
  async installPrefetchedPack(name: string, prefetchData: Uint8Array): Promise<void> {
    if (!window._malloc || !window.stringToNewUTF8 || !window.emloop_install_pack || !window._free) {
      this.minetestConsole.printErr(`Required WASM functions not available to install pack: ${name}`);
      return Promise.reject(`Required WASM functions not available`);
    }
    try {
      const receivedLength = prefetchData.length;
      
      // Allocate memory and copy the data
      const dataPtr = window._malloc(receivedLength);
      window.HEAPU8.set(prefetchData, dataPtr);
      
      // Install the pack
      const namePtr = window.stringToNewUTF8(name);
      window.emloop_install_pack(namePtr, dataPtr, receivedLength);
      
      // Free the memory
      window._free(namePtr);
      window._free(dataPtr);
      
      this.installedPacks.add(name);
      
      this.minetestConsole.print(`Successfully installed pack: ${name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.minetestConsole.printErr(`Error installing pack ${name}:` + errorMessage);
      return Promise.reject(error);
    }
  }
  
  isPackInstalled(name: string): boolean {
    return this.installedPacks.has(name);
  }
}

const RuntimeScreen: React.FC<RuntimeScreenProps> = ({ gameOptions, onGameStatus }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [showConsole, setShowConsole] = useState(false);
  const [resolution, setResolution] = useState('high');
  const [aspectRatio, setAspectRatio] = useState('any');
  const storageManager = useStorageManager();
  const prefetchData = usePrefetchData();
  const minetestConsole = useMinetestConsole();
  const [isLoading, setIsLoading] = useState(true);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const settingsTimeoutRef = useRef<number | null>(null);
  const [packManager] = useState(() => new PackManager(minetestConsole));
  
  // Function to fix canvas geometry based on selected options
  const resolutionRef = useRef(resolution);
  const aspectRatioRef = useRef(aspectRatio);
  resolutionRef.current = resolution;
  aspectRatioRef.current = aspectRatio;
  const fixGeometry = useCallback(() => {
    if (!canvasRef.current || !canvasContainerRef.current) return;
    
    const canvas = canvasRef.current;
    const container = canvasContainerRef.current;
    
    // Get container dimensions
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    let targetWidth = containerWidth;
    let targetHeight = containerHeight;
    
    // Apply resolution setting
    let resolutionFactor = 1.0;
    switch(resolutionRef.current) {
      case 'low':
        resolutionFactor = 0.5;
        break;
      case 'medium':
        resolutionFactor = 0.75;
        break;
      case 'high':
      default:
        resolutionFactor = 1.0;
        break;
    }
    
    targetWidth *= resolutionFactor;
    targetHeight *= resolutionFactor;
    
    // Apply aspect ratio constraint if needed
    if (aspectRatioRef.current !== 'any') {
      const ratioValues = aspectRatioRef.current.split(':').map(Number);
      if (ratioValues.length === 2 && !ratioValues.includes(NaN)) {
        const targetRatio = ratioValues[0] / ratioValues[1];
        const currentRatio = targetWidth / targetHeight;
        
        if (currentRatio > targetRatio) {
          // Too wide, adjust width
          targetWidth = targetHeight * targetRatio;
        } else if (currentRatio < targetRatio) {
          // Too tall, adjust height
          targetHeight = targetWidth / targetRatio;
        }
      }
    }
    
    // Set canvas dimensions
    canvas.width = Math.floor(targetWidth);
    canvas.height = Math.floor(targetHeight);
    
    // Set CSS dimensions to handle any scaling
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    
    // Notify the Module if it exists
    if (window.Module && window.irrlicht_resize) {
      window.irrlicht_resize(canvas.width, canvas.height);
    }
  }, []);
  
  // Handle aspect ratio change
  const handleAspectRatioChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setAspectRatio(e.target.value);
  }, []);
  
  // Handle resolution change
  const handleResolutionChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setResolution(e.target.value);
  }, []);
  
  // Toggle console visibility
  const toggleConsole = useCallback(() => {
    setShowConsole(prev => !prev);
  }, []);

  // Set minetest.conf options
  const setMinetestConf = useCallback((config: Record<string, string>) => {
    if (window.emloop_set_minetest_conf && window.stringToNewUTF8) {
      const confLines = [];
      for (const [key, value] of Object.entries(config)) {
        const confLine = `${key} = ${value}`;
        confLines.push(confLine);
      }
      if (confLines.length > 0) {
        const confTxt = confLines.join('\n') + '\n';
        const confBuf = window.stringToNewUTF8(confTxt);
        window.emloop_set_minetest_conf(confBuf);
        window._free(confBuf);
        minetestConsole.print(`Set config:\n${confTxt}`);
      }
    }
  }, []);

  // Apply proxy setting
  const setProxy = useCallback((proxyUrl: string) => {
    if (window.emsocket_set_proxy && window.stringToNewUTF8) {
      const proxyBuf = window.stringToNewUTF8(proxyUrl);
      window.emsocket_set_proxy(proxyBuf);
      window._free(proxyBuf);
      minetestConsole.print(`Set proxy: ${proxyUrl}`);
    }
  }, []);

  // Function to create argv for main
  const makeArgv = useCallback((args: string[]) => {
    if (!window._malloc || !window.HEAPU8 || !window.stringToNewUTF8) {
      minetestConsole.printErr("Error: Required Emscripten functions not available");
      return [0, 0];
    }
    
    // Allocate memory for pointers (4 bytes per pointer)
    const argv = window._malloc((args.length + 1) * 4);
    let i;
    
    // Set up the argument pointers
    for (i = 0; i < args.length; i++) {
      // Convert JS string to UTF8, get pointer, and store in argv array
      const ptr = window.stringToNewUTF8(args[i]);
      // HEAPU32[(argv >> 2) + i] = ptr;
      // Since we don't have direct access to HEAPU32, we use Uint32Array view
      const view = new Uint32Array(window.HEAPU8.buffer, argv + i * 4, 1);
      view[0] = ptr;
    }
    
    // Set the last element to null (C standard)
    const view = new Uint32Array(window.HEAPU8.buffer, argv + i * 4, 1);
    view[0] = 0;
    
    return [i, argv];
  }, []);

  // Launch the game with the current settings
  const launchGame = async () => {
    try {
      // Initialize the storage manager with the selected storage policy
      await storageManager!.initialize(
        { policy: gameOptions.storagePolicy }, 
        window.Module.FS
      );
      
      minetestConsole.print(`Storage initialized with policy: ${gameOptions.storagePolicy}`);
      
      // Initialize other subsystems
      if (window.emloop_init_sound) window.emloop_init_sound();
      if (window.emsocket_init) window.emsocket_init();
      
      // Set canvas size
      if (canvasRef.current) fixGeometry();

      minetestConsole.print("Installing required game packs...");
      
      // Always install the base pack first
      await packManager.addPack('base', prefetchData.result.base!);

      // Install the minetest_game pack, very basic game, but it's a good test
      // await packManager.addPack('minetest_game');

      // Install the voxelibre pack
      await packManager.addPack('voxelibre', prefetchData.result.voxelibre!);

      // Set graphics/performance settings
      const conf = {
        // 'viewing_range': '140',
        // 'max_block_send_distance': '10',
        // 'max_block_generate_distance': '10',
        // 'block_send_optimize_distance': '10',
        // 'client_mapblock_limit': '8000',
        'no_mtg_notification': 'true',
        'language': gameOptions.language
      };

      setMinetestConf(conf);
      
      // Set up arguments - don't use --go flag to start in menu mode
      const args = ['./minetest'];
      const [argc, argv] = makeArgv(args);

      // Set proxy
      if (window.emsocket_set_proxy) {
        setProxy(gameOptions.proxy);
      }
      
      // Launch the game
      if (window.emloop_invoke_main) {
        minetestConsole.print("Starting Minetest...");
        window.emloop_invoke_main(argc, argv);
        
        // Need to pause/unpause to let the browser redraw the DOM
        if (window.emloop_pause && window.emloop_unpause) {
          window.emloop_pause();
          window.requestAnimationFrame(() => { 
            window.emloop_unpause();
            // Signal that the game is running
            onGameStatus('running');
          });
        }
      }
    } catch (error) {
      minetestConsole.printErr(`Error launching game: ${error}`);
      setIsLoading(false);
      onGameStatus('failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Setup the global functions needed by the WASM module
  useLayoutEffect(() => {
    // Define the emloop_ready function that will be called by the WASM module
    window.emloop_ready = () => {
      minetestConsole.print("emloop_ready called. Setting up functions...");
      
      try {
        // Setup cwrapped functions - copied from original launcher.js
        window.emloop_pause = window.cwrap("emloop_pause", null, []);
        window.emloop_unpause = window.cwrap("emloop_unpause", null, []);
        window.emloop_init_sound = window.cwrap("emloop_init_sound", null, []);
        window.emloop_invoke_main = window.cwrap("emloop_invoke_main", null, ["number", "number"]);
        window.emloop_install_pack = window.cwrap("emloop_install_pack", null, ["number", "number", "number"]);
        window.emloop_set_minetest_conf = window.cwrap("emloop_set_minetest_conf", null, ["number"]);
        window.irrlicht_want_pointerlock = window.cwrap("irrlicht_want_pointerlock", "number", []);
        window.irrlicht_force_pointerlock = window.cwrap("irrlicht_force_pointerlock", null, []);
        window.irrlicht_resize = window.cwrap("irrlicht_resize", null, ["number", "number"]);
        window.emsocket_init = window.cwrap("emsocket_init", null, []);
        window.emsocket_set_proxy = window.cwrap("emsocket_set_proxy", null, ["number"]);
        window.emsocket_set_vpn = window.cwrap("emsocket_set_vpn", null, ["number"]);

        minetestConsole.print("Successfully wrapped Emscripten functions");

        launchGame();
      } catch (err) {
        minetestConsole.printErr(`Error setting up game: ${err}`);
        setIsLoading(false);
      }
    };

    // Define emloop_request_animation_frame function
    window.emloop_request_animation_frame = () => {
      if (window.emloop_pause) window.emloop_pause();
      window.requestAnimationFrame(() => { 
        if (window.emloop_unpause) window.emloop_unpause(); 
      });
    };

    return () => {
      // Cleanup global functions
      delete window.emloop_ready;
      delete window.emloop_request_animation_frame;
    };
  }, []);

  // Initialize the WASM module
  useEffect(() => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const modulePath = `minetest/minetest.js`;
    
    // Set up Module configuration for Emscripten
    window.Module = {
      preRun: [],
      postRun: [],
      print: minetestConsole.print,
      printErr: minetestConsole.printErr,
      canvas: canvas,
      onAbort: () => {
        minetestConsole.printErr('Fatal error: Emscripten module aborted');
        onGameStatus('failed');
      },
      totalDependencies: 0,
      monitorRunDependencies: (left: number) => {
        const deps = Math.max(window.Module.totalDependencies, left);
        window.Module.totalDependencies = deps;
        const progress = (deps - left) / deps;
        minetestConsole.print(`Loading progress: ${Math.round(progress * 100)}%`);
      },
      setStatus: (text: string) => {
        if (text) minetestConsole.print('[wasm module status] ' + text);
      },
      onRuntimeInitialized: () => {
        minetestConsole.print('Runtime initialized, waiting for emloop_ready...');
      },
      // Add handlers for file operations to sync with IndexedDB
      onFileChange: (path: string) => {
        // Normalize the path
        path = path.replace(/\/[^\/]+\/\.\.\//g, '/');
        if (path.startsWith('/minetest/worlds/') && storageManager) {
          minetestConsole.print(`File changed: ${path}`);
          try {
            const statResult = window.Module.FS.stat(path);
            let isDirectory = (statResult.mode & 0x4000) === 0x4000;
            if (isDirectory) {
              storageManager.ensureDirectoryExists(path);
            } else {
              const content = window.Module.FS.readFile(path, { encoding: 'binary' });
              storageManager.persistFile(path, content);
            }
          } catch (e) {
            minetestConsole.printErr(`Error persisting file: ${path}, ${e}`);
          }
        }
        else {
          minetestConsole.print(`File changed (no sync): ${path}`);
        }
      },
      onFileDelete: (path: string) => {
        path = path.replace(/\/[^\/]+\/\.\.\//g, '/');
        minetestConsole.print(`File deleted: ${path}`);
        if (storageManager) {
          storageManager.deleteDirectory(path);
        }
      }
    };

    // Add worker injection script for proper thread communication
    const workerInject = `
      Module['print'] = (text) => {
        postMessage({cmd: 'callHandler', handler: 'print', args: [text], threadId: Module['_pthread_self']()});
      };
      Module['printErr'] = (text) => {
        postMessage({cmd: 'callHandler', handler: 'printErr', args: [text], threadId: Module['_pthread_self']()});
      };
      importScripts('minetest.js');
    `;
    window.Module['mainScriptUrlOrBlob'] = new Blob([workerInject], { type: "text/javascript" });
    window.Module['onFullScreen'] = () => { fixGeometry(); };
    
    // Function to load the script
    const loadScript = () => {
      minetestConsole.print(`Loading WebAssembly module from ${modulePath}...`);
      const script = document.createElement('script');
      script.src = modulePath;
      script.async = true;
      script.onerror = () => {
        minetestConsole.printErr(`Error loading WebAssembly module from ${modulePath}`);
        onGameStatus('failed');
      };
      script.onload = () => {
        minetestConsole.print('WebAssembly module loaded successfully');
      };
      document.body.appendChild(script);
    };
    
    // Load the module
    loadScript();

    // Set up resize handling
    const handleResize = () => fixGeometry();
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [onGameStatus]);
  
  // Update geometry when resolution or aspect ratio changes
  useEffect(() => {
    fixGeometry();
  }, [resolution, aspectRatio]);

  // Handle settings panel expansion
  const expandSettings = useCallback(() => {
    setSettingsExpanded(true);
    // Clear any existing timeout
    if (settingsTimeoutRef.current !== null) {
      window.clearTimeout(settingsTimeoutRef.current);
      settingsTimeoutRef.current = null;
    }
  }, []);
  
  // Handle settings panel collapse with delay
  const collapseSettingsWithDelay = useCallback(() => {
    // Set a timeout to collapse after 1 second
    if (settingsTimeoutRef.current !== null) {
      window.clearTimeout(settingsTimeoutRef.current);
    }
    
    settingsTimeoutRef.current = window.setTimeout(() => {
      setSettingsExpanded(false);
      settingsTimeoutRef.current = null;
    }, 1000);
  }, []);
  
  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (settingsTimeoutRef.current !== null) {
        window.clearTimeout(settingsTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="h-[100vh] w-[100vw] flex flex-col bg-black relative overflow-hidden">
      {/* Floating settings panel */}
      <div 
        className={`absolute top-2 right-2 z-10 transition-all duration-300 ${
          settingsExpanded ? 'opacity-100' : 'opacity-90 hover:opacity-100'
        }`}
        onMouseEnter={expandSettings}
        onMouseLeave={collapseSettingsWithDelay}
      >
        {/* Collapsed state - just the cogwheel */}
        {!settingsExpanded && (
          <button 
            onClick={expandSettings}
            className="bg-gray-800 hover:bg-gray-700 text-white rounded-full p-2 shadow-lg"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
        
        {/* Expanded state - full settings panel */}
        {settingsExpanded && (
          <div className="bg-gray-800 rounded-lg shadow-lg p-3 max-w-md animate-fadeIn">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-white font-semibold">Settings</h3>
              <button 
                onClick={() => setSettingsExpanded(false)}
                className="text-gray-400 hover:text-white"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label htmlFor="resolution" className="text-gray-300 text-sm block mb-1">Resolution</label>
                <select 
                  id="resolution" 
                  className="bg-gray-700 text-white rounded p-1 w-full"
                  value={resolution}
                  onChange={handleResolutionChange}
                >
                  <option value="high">High Res</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low Res</option>
                </select>
              </div>
              
              <div>
                <label htmlFor="aspectRatio" className="text-gray-300 text-sm block mb-1">Aspect Ratio</label>
                <select 
                  id="aspectRatio" 
                  className="bg-gray-700 text-white rounded p-1 w-full"
                  value={aspectRatio}
                  onChange={handleAspectRatioChange}
                >
                  <option value="any">Fit Screen</option>
                  <option value="4:3">4:3</option>
                  <option value="16:9">16:9</option>
                  <option value="5:4">5:4</option>
                  <option value="21:9">21:9</option>
                  <option value="32:9">32:9</option>
                  <option value="1:1">1:1</option>
                </select>
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <button 
                className="bg-blue-600 hover:bg-blue-700 text-white rounded p-1 px-3 text-sm"
                onClick={toggleConsole}
              >
                {showConsole ? 'Hide Console' : 'Show Console'}
              </button>
              
              {gameOptions.storagePolicy === 'indexeddb' && (
                <div className="flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-400 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                  <span className="text-gray-300 text-sm">
                    {(() => {
                      const stats = storageManager!.getFormattedStats();
                      const extractMB = (str: string) => {
                        const match = str.match(/\(([\d\.]+)\s*([KMG]B)\)/i);
                        if (match) {
                          const value = parseFloat(match[1]);
                          const unit = match[2].toUpperCase();
                          if (unit === 'KB') return value / 1024;
                          if (unit === 'MB') return value;
                          if (unit === 'GB') return value * 1024;
                        }
                        return 0;
                      };
                      
                      const worldsMB = extractMB(stats.worlds);
                      const modsMB = extractMB(stats.mods);
                      const totalMB = worldsMB + modsMB;
                      
                      if (totalMB < 1) {
                        return `${Math.round(totalMB * 1024)} KB`;
                      } else {
                        return `${totalMB.toFixed(2)} MB`;
                      }
                    })()}
                  </span>
                </div>
              )}
            </div>
            
            {isLoading && (
              <div className="mt-2 flex items-center gap-2">
                <div className="h-2 w-full bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-600 animate-pulse" style={{ width: '100%' }}></div>
                </div>
                <span className="text-gray-300 text-sm whitespace-nowrap">Loading...</span>
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Canvas container */}
      <div 
        ref={canvasContainerRef}
        className="flex-1 flex items-center justify-center bg-black"
      >
        <canvas 
          ref={canvasRef}
          id="canvas" 
          className="emscripten"
          onContextMenu={(e) => e.preventDefault()}
          tabIndex={-1}
        ></canvas>
      </div>
      
      {/* Floating Console */}
      {showConsole && (
        <div className="absolute bottom-4 left-4 right-4 h-[30vh] z-10 bg-gray-900/85 backdrop-blur-sm border border-gray-700 rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center justify-between bg-gray-800/90 px-3 py-1.5">
            <h3 className="text-white text-sm font-medium">Console Output</h3>
            <button 
              onClick={toggleConsole}
              className="text-gray-400 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <textarea 
            id="console_output" 
            className="w-full h-[calc(100%-32px)] bg-transparent text-green-400 font-mono p-3 resize-none focus:outline-none"
            readOnly
            value={minetestConsole.messages.join('\n')}
          ></textarea>
        </div>
      )}
      
      <SnackBar />
    </div>
  );
};

export default RuntimeScreen; 