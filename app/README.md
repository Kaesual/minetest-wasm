# Minetest WASM React UI

This is a React-based UI for the Minetest WebAssembly build. It replaces the static HTML/JS interface with a modern React application.

## Features

- TypeScript for type safety
- Tailwind CSS for styling
- Dexie.js for IndexedDB handling
- Responsive design
- Modern component-based architecture

## Development

To start the development server:

```bash
npm install
npm start
```

## Building

To build the application:

```bash
npm run build
```

The build output will be in the `build` directory, which is then used by the `build_www.sh` script to create the final web deployment.

## Structure

- `src/components/` - React components
- `src/utils/` - Utility functions and classes
- `src/types/` - TypeScript type definitions

## Storage

The application uses Dexie.js for IndexedDB storage, replacing the previous custom implementation. This provides better performance and reliability for storing game worlds and mods. 