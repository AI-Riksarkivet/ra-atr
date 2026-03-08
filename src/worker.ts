import init, { load_yolo, load_trocr, run_pipeline } from '../crates/htr-wasm/pkg/htr_wasm.js';
import { downloadAndCacheModel } from './lib/model-cache';

const MODEL_URLS = {
  yolo: 'https://huggingface.co/Riksarkivet/yolov9-lines-within-regions-1/resolve/main/yolo-lines-int8.onnx',
  trOcrEncoder: 'https://huggingface.co/Riksarkivet/trocr-base-handwritten-hist-swe-2/resolve/main/encoder-int8.onnx',
  trOcrDecoder: 'https://huggingface.co/Riksarkivet/trocr-base-handwritten-hist-swe-2/resolve/main/decoder-int8.onnx',
  tokenizer: 'https://huggingface.co/Riksarkivet/trocr-base-handwritten-hist-swe-2/resolve/main/tokenizer.json',
};

let wasmReady = false;

self.onmessage = async (e: MessageEvent) => {
  try {
    switch (e.data.type) {
      case 'load_models': {
        await init();

        const progress = (p: { model: string; percent: number }) => {
          self.postMessage({
            type: 'model_status',
            payload: { model: p.model, status: 'downloading', progress: p.percent },
          });
        };

        const [yoloBytes, encoderBytes, decoderBytes, tokenizerBytes] = await Promise.all([
          downloadAndCacheModel(MODEL_URLS.yolo, 'yolo', progress),
          downloadAndCacheModel(MODEL_URLS.trOcrEncoder, 'trocr-encoder', progress),
          downloadAndCacheModel(MODEL_URLS.trOcrDecoder, 'trocr-decoder', progress),
          downloadAndCacheModel(MODEL_URLS.tokenizer, 'tokenizer', progress),
        ]);

        load_yolo(new Uint8Array(yoloBytes));
        self.postMessage({ type: 'model_status', payload: { model: 'yolo', status: 'loaded' } });

        const tokenizerJson = new TextDecoder().decode(tokenizerBytes);
        load_trocr(new Uint8Array(encoderBytes), new Uint8Array(decoderBytes), tokenizerJson);
        self.postMessage({ type: 'model_status', payload: { model: 'trocr', status: 'loaded' } });

        wasmReady = true;
        self.postMessage({ type: 'ready' });
        break;
      }

      case 'run_pipeline': {
        if (!wasmReady) throw new Error('Models not loaded');

        const imageBytes = new Uint8Array(e.data.payload.imageData);
        run_pipeline(
          imageBytes,
          (json: string) => self.postMessage({ type: 'segmentation', payload: { lines: JSON.parse(json) } }),
          (lineIdx: number, token: string) => self.postMessage({ type: 'token', payload: { lineIndex: lineIdx, token } }),
          (lineIdx: number, text: string, confidence: number) => self.postMessage({ type: 'line_done', payload: { lineIndex: lineIdx, text, confidence } }),
          () => self.postMessage({ type: 'pipeline_done' }),
        );
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', payload: { message: err.message ?? String(err) } });
  }
};
