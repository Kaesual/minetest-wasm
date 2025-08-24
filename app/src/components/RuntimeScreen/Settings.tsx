import { GameOptions } from "../../App";
import { PROXIES } from "../../utils/common";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type StorageStats, type StorageManager } from "../../utils/storageManager";

interface SettingsProps {
  gameOptions: GameOptions;
  vpnClientCode: string | null;
  isLoading: boolean;
  resolution: string;
  handleResolutionChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  aspectRatio: string;
  handleAspectRatioChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  showConsole: boolean;
  toggleConsole: () => void;
  storageManager: StorageManager;
}

export function SettingsComponent({
  gameOptions,
  vpnClientCode,
  isLoading,
  resolution,
  handleResolutionChange,
  aspectRatio,
  handleAspectRatioChange,
  showConsole,
  toggleConsole,
  storageManager,
}: SettingsProps) {
  const [storageStats, setStorageStats] = useState<StorageStats>(storageManager.getStats());
  const [secondsToSync, setSecondsToSync] = useState<number | null>(null);
  const [syncInProgress, setSyncInProgress] = useState<boolean>(false);
  const [downloadInProgress, setDownloadInProgress] = useState<boolean>(false);
  const [restartClicked, setRestartClicked] = useState<boolean>(false);
  const [syncDelay, setSyncDelay] = useState<number>(Math.floor(storageManager.autoSyncDebounceDelay / 1000));

  useEffect(() => {
    const listener = (stats: StorageStats) => {
      setStorageStats(stats);
    };
    storageManager.addStatsChangeListener(listener);
    return () => {
      storageManager.removeStatsChangeListener(listener);
    };
  }, [storageManager]);

  // Refresh the sync info every second
  useEffect(() => {
    const refreshNextUpdate = () => {
      const syncInfo = storageManager.worldSyncInfo;
      if (syncInfo.nextSync) {
        const now = Date.now();
        const secondsToSync = Math.floor((syncInfo.nextSync - now) / 1000);
        setSecondsToSync(secondsToSync);
      }
      else {
        setSecondsToSync(null);
      }
      setSyncInProgress(syncInfo.inProgress);
    };
    refreshNextUpdate();
    const interval = setInterval(refreshNextUpdate, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [storageManager]);

  // Sync now button
  const syncNow = useCallback(async () => {
    setSyncInProgress(true);
    setSecondsToSync(null);
    try {
      await storageManager.executeWorldSync();
    }
    finally {
      setSyncInProgress(false);
    }
  }, [storageManager]);

  // Download all files as zip button
  const downloadAllFilesAsZip = useCallback(async () => {
    // Storage Manager syncs automatically when downloading
    setSyncInProgress(true);
    setDownloadInProgress(true);
    setSecondsToSync(null);
    try {
      await storageManager.downloadAllFilesAsZip();
    }
    finally {
      setSyncInProgress(false);
      setDownloadInProgress(false);
    }
  }, [storageManager]);

  // Format the stats for display
  const formattedStats = useMemo(() => {
    if (storageStats.totalSize === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(storageStats.totalSize) / Math.log(k));
    const size = parseFloat((storageStats.totalSize / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    return `${storageStats.fileCount} files (${size})`;
  }, [storageStats]);

  // Help list items
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

        <div>
          <button
            className="bg-blue-600 hover:bg-blue-700 text-white rounded p-1 px-3 text-sm w-full h-full"
            onClick={toggleConsole}
          >
            {showConsole ? 'Hide Console' : 'Show Console'}
          </button>
        </div>
        <div>
          <button
            className="bg-blue-600 hover:bg-blue-700 text-white rounded p-1 px-3 text-sm w-full h-full"
            onClick={() => {
              if (restartClicked) {
                window.location.reload();
              }
              else {
                setRestartClicked(true);
              }
            }}
          >
            {restartClicked ? '⚠️ CONFIRM reload (will not sync worlds!)' : '⚠️ Force reload (will not sync worlds!)'}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between my-2">
        <h3 className="text-white font-semibold">Storage</h3>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        {gameOptions.storagePolicy === 'indexeddb' && <>
          <div>
            {syncInProgress ? (
              <span className="text-green-400 text-sm">
                ⌛ Synchronizing...
              </span>
            ) : secondsToSync !== null ? (
              <span className="text-gray-300 text-sm">
                ⏱️ Files changed, syncing in {secondsToSync}s
              </span>
            ) : (
              <span className="text-gray-300 text-sm">
                ✅ Synchronized
              </span>
            )}
          </div>
          <div className="flex items-center justify-end gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <span className="text-gray-300 text-sm">
              {formattedStats}
            </span>
          </div>

          <div className="flex items-center">
            <p className="text-gray-300 text-sm">
              Sync delay (10-300s) {Math.floor(storageManager.autoSyncDebounceDelay / 1000)}s
            </p>
          </div>
          <div>
            <input
              type="range"
              min={10}
              max={300}
              step={1}
              className="bg-gray-700 text-white rounded p-1 w-full"
              value={syncDelay}
              onChange={(e) => {
                storageManager.autoSyncDebounceDelay = parseInt(e.target.value) * 1000;
                setSyncDelay(parseInt(e.target.value));
              }}
            />
          </div>

          <div>
            <button
              className="bg-blue-600 hover:bg-blue-700 text-white rounded p-1 px-3 text-sm w-full h-full"
              onClick={syncNow}
              disabled={syncInProgress}
            >
              {syncInProgress ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
          <div>
            <button
              className="bg-blue-600 hover:bg-blue-700 text-white rounded p-1 px-3 text-sm w-full h-full"
              onClick={downloadAllFilesAsZip}
              disabled={syncInProgress || downloadInProgress}
            >
              Sync &amp; Download
            </button>
          </div>
        </>}
        {gameOptions.storagePolicy === 'no-storage' && <>
          <div className="col-span-2 text-center">
            <span className="text-gray-300 text-sm">
              Storage is disabled.
            </span>
          </div>
        </>}
      </div>

      <div className="flex items-center justify-between my-2">
        <h3 className="text-white font-semibold">Help</h3>
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
  );
}

export function SettingsButton({
  expandSettings,
}: {
  expandSettings: () => void;
}) {
  return (
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
  );
}