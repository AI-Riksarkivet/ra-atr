import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit(), wasm()],
  worker: {
    plugins: () => [wasm()],
  },
  ssr: {
    noExternal: ['svelte-sonner', 'mode-watcher', 'svelte-toolbelt'],
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    watch: {
      ignored: ['**/target/**', '**/models/**', '**/.venv/**', '**/.export-venv/**'],
    },
  },
});
