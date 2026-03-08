import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import wasm from 'vite-plugin-wasm';
import path from 'path';

export default defineConfig({
  plugins: [svelte(), wasm()],
  worker: {
    plugins: () => [wasm()],
  },
  resolve: {
    alias: {
      $lib: path.resolve('./src/lib'),
    },
  },
});
