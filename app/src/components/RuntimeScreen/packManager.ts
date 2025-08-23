import { type MinetestConsole } from "../../utils/GlobalContext";

// Class to handle resource packs similar to the original launcher
export default class PackManager {
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