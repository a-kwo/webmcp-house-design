import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // three must resolve to a single copy: drei and postprocessing each pull it
  // in, and duplicate instances break instanceof checks and double the bundle.
  resolve: {
    dedupe: ['three'],
  },
  build: {
    rollupOptions: {
      output: {
        // Everything from node_modules in one chunk, so app code gets its own
        // cache entry and editing it does not invalidate the dependencies.
        //
        // Giving three a chunk separate from the rest was tried and made the
        // two import each other -- Rollup reports "Circular chunk: three ->
        // vendor -> three", and circular chunks can evaluate out of order at
        // runtime. Naming packages instead of matching on path was also tried
        // and pulls in whole libraries, defeating tree-shaking.
        manualChunks(id) {
          return id.includes('node_modules') ? 'vendor' : undefined;
        },
      },
    },
    // three plus the postprocessing stack is most of the bundle and nothing
    // here can shrink it, so the limit reflects what a 3D app actually costs.
    chunkSizeWarningLimit: 1500,
  },
});
