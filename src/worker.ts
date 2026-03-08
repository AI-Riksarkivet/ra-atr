import init, { greet } from '../crates/htr-wasm/pkg/htr_wasm.js';

self.onmessage = async (e: MessageEvent) => {
  if (e.data.type === 'load_models') {
    await init();
    const msg = greet();
    self.postMessage({ type: 'ready' });
  }
};
