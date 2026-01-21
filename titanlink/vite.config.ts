import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        electron([
            {
                // Main process entry file
                entry: 'electron/main.ts',
                vite: {
                    build: {
                        outDir: 'dist-electron',
                        sourcemap: true,
                        rollupOptions: {
                            external: ['electron', 'vigemclient', 'ws'],
                        },
                    },
                },
            },
            {
                // Preload scripts
                entry: 'electron/preload.ts',
                vite: {
                    build: {
                        outDir: 'dist-electron',
                        sourcemap: true,
                    },
                },
                onstart(options) {
                    // Notify the Renderer-process to reload the page when the Preload-Scripts build is complete,
                    // instead of restarting the entire Electron App.
                    options.reload();
                },
            },
        ]),
        renderer(),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@main': path.resolve(__dirname, './electron'),
            '@shared': path.resolve(__dirname, './shared'),
        },
    },
    base: './',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: true,
    },
    server: {
        port: 5173,
        strictPort: true,
    },
});
