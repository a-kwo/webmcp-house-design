import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split by where a module came from rather than by naming packages:
        // naming them pulls in whole libraries and defeats tree-shaking. Total
        // bytes are unchanged either way; the point is that three barely ever
        // changes while the app does, so it should not share a cache entry.
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }
          return id.includes('/three/') || id.includes('@react-three') ? 'three' : 'vendor';
        },
      },
    },
    // three alone is past the default 500kB. Nothing here can shrink it, so the
    // limit reflects what a 3D app actually costs.
    chunkSizeWarningLimit: 750,
  },
});
