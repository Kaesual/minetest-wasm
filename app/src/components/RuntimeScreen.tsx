import React, { useEffect, useRef, useState, useLayoutEffect, useCallback, useMemo } from 'react';
import { MinetestConsole, useMinetestConsole, usePrefetchData, useStorageManager } from '../utils/GlobalContext';
import SnackBar from './SnackBar';
import { type GameOptions } from '../App';
import { PROXIES } from '../utils/common';


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
    HEAPU32: Uint32Array;
  }
}

function queryProxy(cmd: string, proxy: string) {
  return new Promise<[string, string, string]>((resolve, reject) => {
    let finished = false;
    const ws = new WebSocket(proxy);
    ws.addEventListener('open', (event) => {
      ws.send(cmd);
    });
    ws.addEventListener('error', (event) => {
      alert('Error initiating proxy connection');
      finished = true;
      reject(new Error('Received error'));
    });
    ws.addEventListener('close', (event) => {
      if (!finished) {
        alert('Proxy connection closed unexpectedly');
        finished = true;
        reject(new Error('Received close'));
      }
    });
    ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        alert('Invalid message received from proxy');
        finished = true;
        reject(new Error('Invalid message'));
        return;
      }
      finished = true;
      ws.close();
      resolve(event.data.split(' ') as [string, string, string]);
    });
  });
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
  const [vpnServerCode, setVpnServerCode] = useState<string | null>(null);
  const [vpnClientCode, setVpnClientCode] = useState<string | null>(null);

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
    switch (resolutionRef.current) {
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
    else {
      minetestConsole.printErr("RuntimeScreen: setMinetestConf failed");
    }
  }, []);

  // Apply proxy setting
  const setProxy = useCallback((proxyUrl: string) => {
    if (window.emsocket_set_proxy && window.stringToNewUTF8) {
      const proxyBuf = window.stringToNewUTF8(proxyUrl);
      window.emsocket_set_proxy(proxyBuf);
      window._free(proxyBuf);
      minetestConsole.print(`RuntimeScreen: setProxy ${proxyUrl}`);
    }
    else {
      minetestConsole.printErr("RuntimeScreen: setProxy failed");
    }
  }, []);

  // Apply VPN settings
  const setVpn = useCallback((serverCode: string | null, clientCode: string | null) => {
    console.log('setVpn', serverCode, clientCode);
    setVpnServerCode(serverCode);
    setVpnClientCode(clientCode);
    // Use serverCode when available, otherwise use clientCode
    const code = serverCode || clientCode;
    if (code !== null) {
      const vpnBuf = window.stringToNewUTF8(code);
      window.emsocket_set_vpn(vpnBuf);
      window._free(vpnBuf);
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
    for (i = 0; i < args.length; i++) {
      window.HEAPU32[(argv >>> 2) + i] = window.stringToNewUTF8(args[i]);
    }
    window.HEAPU32[(argv >>> 2) + i] = 0; // argv[argc] == NULL
    return [i, argv];
  }, []);

  // Launch the game with the current settings
  const launchGameRef = useRef<(() => Promise<void>) | null>(null);
  launchGameRef.current = (async () => {
    try {
      if (!storageManager) {
        throw new Error('StorageManager does not exist');
      }
      if (await storageManager.isInitialized) {
        if (!storageManager.hasCopiedToModuleFS) {
          await storageManager.copyToModuleFS();
        }
      }
      else {
        // Initialize the storage manager with the selected storage policy
        await storageManager!.initialize(
          { policy: gameOptions.storagePolicy },
          minetestConsole,
          true
        );
      }
      minetestConsole.print(`Storage initialized with policy: ${gameOptions.storagePolicy}`);

      // Always install the base and voxelibre packs
      minetestConsole.print("Installing required game packs...");
      await packManager.addPack('base', prefetchData.result.base!);
      // await packManager.addPack('minetest_game', prefetchData.result.minetest_game!);
      await packManager.addPack('voxelibre', prefetchData.result.voxelibre!);

      // Set canvas size
      if (canvasRef.current) fixGeometry();

      // Create config
      const conf = {
        'viewing_range': '140',
        'max_block_send_distance': '10',
        'max_block_generate_distance': '10',
        'block_send_optimize_distance': '10',
        'client_mapblock_limit': '8000',
        'no_mtg_notification': 'true',
        'language': gameOptions.language
      };
      if (gameOptions.mode === 'host' || gameOptions.mode === 'join') {
        conf['viewing_range'] = '90';
        conf['max_block_send_distance'] = '5';
        conf['max_block_generate_distance'] = '5';
        conf['block_send_optimize_distance'] = '5';
        conf['client_mapblock_limit'] = '5000';
      }
      setMinetestConf(conf);

      // Initialize sound
      if (window.emloop_init_sound) window.emloop_init_sound();

      // Initialize emsocket after setting proxy and VPN
      if (window.emsocket_init) {
        window.emsocket_init();
        minetestConsole.print("emsocket initialized");
      }

      // Set up network - do this before initializing emsocket
      setProxy(gameOptions.proxy);
      
      // Handle game mode specific settings and VPN setup
      // Do this before emsocket_init
      if (gameOptions.mode === 'join') {
        if (!gameOptions.joinCode) {
          throw new Error('RuntimeScreen: Join code is required');
        }
        setVpn(null, gameOptions.joinCode);
      }
      else if (gameOptions.mode === 'host') {
        const [cmd, serverCode, clientCode] = await queryProxy(`MAKEVPN ${gameOptions.gameId}`, gameOptions.proxy);
        if (cmd != 'NEWVPN') {
          throw new Error('Invalid response from proxy');
        }
        console.log('serverCode', serverCode);
        console.log('clientCode', clientCode);
        setVpn(serverCode, clientCode);
      }

      // Set up minetest args
      const { minetestArgs } = gameOptions;
      minetestArgs.clear();

      // NOTE: With --go the server seems to load too slowly for the client to connect,
      // at least for big games like voxelibre

      // if (gameOptions.mode === 'join') {
      //   minetestArgs.go = true;
      //   minetestArgs.gameid = gameOptions.gameId;
      //   minetestArgs.address = '172.16.0.1';
      //   minetestArgs.port = 30000;
      //   // playerName is guaranteed to exist here due to the check above
      //   minetestArgs.name = gameOptions.playerName!;
      // }
      // else if (gameOptions.mode === 'host') {
      //   minetestArgs.go = true;
      //   minetestArgs.gameid = gameOptions.gameId;
      //   minetestArgs.address = '127.0.0.1';
      //   minetestArgs.port = 30000;
      //   // playerName is guaranteed to exist here due to the check above
      //   minetestArgs.name = gameOptions.playerName!;
      //   minetestArgs.worldname = gameOptions.worldName!;
      //   minetestArgs.extra.push('--withserver');
      // }

      if (minetestArgs.go && window.irrlicht_force_pointerlock) {
        window.irrlicht_force_pointerlock();
      }

      console.log("GAME OPTIONS", gameOptions);

      // Launch the game
      if (window.emloop_invoke_main) {
        const fullArgs = ['./minetest', ...minetestArgs.toArray()];

        // NOTE: While this approach does not work, pre-warming the game cache
        // somehow could still be the right strategy to fix the issue with --go
        
        // const withServerIndex = fullArgs.indexOf('--withserver');
        // if (withServerIndex > -1) {
        //   const tempArgs = ['./minetest', '--gameid', 'minetest_game', '--warm'];
        //   const [argc, argv] = makeArgv(tempArgs);
        //   console.log("Pre-warming game cache...");
        //   const invokeMainResult = window.emloop_invoke_main(argc, argv);
        //   console.log("Pre-warming game cache result:", invokeMainResult);
        // }

        minetestConsole.print("Starting: " + fullArgs.join(' '));
        const [argc, argv] = makeArgv(fullArgs);
        window.emloop_invoke_main(argc, argv);
        window.emloop_request_animation_frame?.();

        onGameStatus('running');
      }
    } catch (error) {
      minetestConsole.printErr(`Error launching game: ${error}`);
      setIsLoading(false);
      onGameStatus('failed');
    } finally {
      setIsLoading(false);
    }
  });

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

        launchGameRef.current?.();
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
        if (storageManager) {
          storageManager.fileChanged(path);
        }
      },
      onFileDelete: (path: string) => {
        if (storageManager) {
          storageManager.fileDeleted(path);
        }
      }
    };

    Module['mainScriptUrlOrBlob'] = 'minetest/worker.js';
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

  useEffect(() => {
    if (storageManager) {
      storageManager.setMinetestConsole(minetestConsole);
    }
  }, [storageManager, minetestConsole]);

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
    }, 300);
  }, []);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (settingsTimeoutRef.current !== null) {
        window.clearTimeout(settingsTimeoutRef.current);
      }
    };
  }, []);

  const helpListItems = useMemo(() => {
    const items: string[] = ["You can see and change the keys in the menu by pressing ESC"];
    if (gameOptions.mode === 'host' || gameOptions.mode === 'join') {
      items.push(`The join code is: ${vpnClientCode}`);
      items.push(`The proxy is: ${PROXIES.find(p => p[0] === gameOptions.proxy)?.[1]}`);
    }
    if (gameOptions.mode === 'join') {
      items.push(`The host server address is: 172.16.0.1`);
      items.push(`The host server port is: 30000`);
    }
    if (gameOptions.mode === 'host' || gameOptions.mode === 'local') {
      items.push(`To save your game, always press ESC and go back to the main menu`);
      items.push(`There, wait a few seconds before closing the game, otherwise your game might be lost or corrupted`);
    }
    return items;
  }, [gameOptions.mode, vpnClientCode]);

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
            style={{
              opacity: 0.4
            }}
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

            <ul className="text-sm list-disc ml-4">
              {helpListItems.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>

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
        className="m-0 p-0"
        style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}
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