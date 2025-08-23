import { GameOptions } from "../../App";
import { PROXIES } from "../../utils/common";
import { useMemo } from "react";
import { type StorageManager } from "../../utils/storageManager";

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
                const stats = storageManager.getFormattedStats();
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