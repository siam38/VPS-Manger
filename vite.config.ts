import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

// Single source of truth for the version shown in the sidebar, the login card
// and the footer. These used to be hand-typed strings that drifted: package.json
// said 2.0.0 while the login screen said v3.1.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3847',
      '/socket.io': { target: 'http://localhost:3847', ws: true }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
