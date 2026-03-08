import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import wasm from 'vite-plugin-wasm';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

const isMcp = process.env.VITE_MCP === 'true';

export default defineConfig({
  plugins: [
    svelte(),
    wasm(),
    ...(isMcp ? [viteSingleFile()] : []),
  ],
  worker: {
    plugins: () => [wasm()],
  },
  resolve: {
    alias: {
      $lib: path.resolve('./src/lib'),
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  server: {
    watch: {
      ignored: ['**/target/**', '**/models/**'],
    },
  },
});
