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
    proxy: {
      '/catalog': 'http://localhost:8000',
      '/transcriptions': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/debug': 'http://localhost:8000',
      '/gpu': {
        target: process.env.GPU_SERVER_URL || 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
        rewrite: (path: string) => path.replace(/^\/gpu/, ''),
      },
    },
    watch: {
      ignored: ['**/target/**', '**/models/**', '**/.venv/**', '**/.export-venv/**'],
    },
  },
});
