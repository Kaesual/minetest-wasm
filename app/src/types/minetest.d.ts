declare interface EmscriptenFS {
  mkdir: (path: string) => void;
  mkdirTree: (path: string) => void;
  writeFile: (path: string, data: Uint8Array, opts?: any) => void;
  readFile: (path: string, opts?: any) => Uint8Array | string;
  analyzePath: (path: string, dontResolveLastLink?: boolean) => {
    exists: boolean;
    isFolder: boolean;
  };
  stat: (path: string) => {
    mode: number;
    size: number;
    mtime: Date;
    atime: Date;
  };
  readdir: (path: string) => string[];
  unlink: (path: string) => void;
  rmdir: (path: string) => void;
}

declare interface MinetestModule {
  FS: EmscriptenFS;
  canvas: HTMLCanvasElement;
  callMain: (args: string[]) => void;
  cwrap: (name: string, returnType: string | null, argTypes: string[], opts?: any) => Function;
}

// Using any for global references to keep it simple
declare const Module: any; 