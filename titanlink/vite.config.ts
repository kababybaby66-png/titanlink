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
                        // [SECURITY] No source maps in production — prevents source reconstruction
                        sourcemap: process.env.NODE_ENV === 'development',
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
                        // [SECURITY] No source maps in production
                        sourcemap: process.env.NODE_ENV === 'development',
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
        // [SECURITY] No source maps in production — prevents source reconstruction
        sourcemap: process.env.NODE_ENV === 'development',
        rollupOptions: {
            output: {
                manualChunks: {
                    // Split Three.js ecosystem into separate chunk (only loaded when enable3D=true)
                    'three-vendor': ['three', '@react-three/fiber', '@react-three/drei'],
                },
            },
        },
    },
    server: {
        port: 5173,
        strictPort: true,
    },
});
