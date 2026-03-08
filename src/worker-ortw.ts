import * as ort from 'onnxruntime-web/webgpu';
import { downloadAndCacheModel } from './lib/model-cache';
import { preprocessYolo, preprocessTrOCR, decodeImage, cropImageData } from './lib/preprocessing';
import { parseYoloOutput } from './lib/yolo';
import { BpeTokenizer } from './lib/tokenizer';

// Let ort-web resolve wasm/mjs files relative to its own module in node_modules
// Use multiple threads if SharedArrayBuffer is available (requires COOP/COEP headers)
ort.env.wasm.numThreads = typeof SharedArrayBuffer !== 'undefined' ? navigator.hardwareConcurrency || 4 : 1;

// Use fp32 models for WebGPU (int8 quantized ops fall back to CPU)
// Use int8 models for WASM-only (smaller download, same CPU speed)
const useQuantized = typeof navigator !== 'undefined' && !(navigator as any).gpu;

const MODEL_URLS = {
  yolo: useQuantized ? '/models/yolo-lines-int8.onnx' : '/models/yolo-lines.onnx',
  trOcrEncoder: useQuantized ? '/models/encoder-int8.onnx' : '/models/encoder.onnx',
  trOcrDecoder: useQuantized ? '/models/decoder-int8.onnx' : '/models/decoder.onnx',
  tokenizer: '/models/tokenizer.json',
};

let yoloSession: ort.InferenceSession | null = null;
let encoderSession: ort.InferenceSession | null = null;
let decoderSession: ort.InferenceSession | null = null;
let tokenizer: BpeTokenizer | null = null;
let ready = false;

// Detect WebGPU availability
async function getExecutionProviders(): Promise<string[]> {
  try {
    const gpu = (navigator as any).gpu;
    if (gpu) {
      const adapter = await gpu.requestAdapter();
      if (adapter) return ['webgpu', 'wasm'];
    }
  } catch {}
  return ['wasm'];
}

self.onmessage = async (e: MessageEvent) => {
  try {
    switch (e.data.type) {
      case 'load_models': {
        const eps = await getExecutionProviders();
        const backend = eps[0];
        console.log(`[ort-web] Using execution provider: ${backend}`, eps);
        self.postMessage({
          type: 'model_status',
          payload: { model: 'backend', status: backend === 'webgpu' ? 'WebGPU' : 'WASM (no WebGPU)' },
        });

        const progress = (p: { model: string; percent: number }) => {
          self.postMessage({
            type: 'model_status',
            payload: { model: p.model, status: 'downloading', progress: p.percent },
          });
        };

        // Download all models in parallel
        const [yoloBytes, encoderBytes, decoderBytes, tokenizerBytes] = await Promise.all([
          downloadAndCacheModel(MODEL_URLS.yolo, 'yolo', progress),
          downloadAndCacheModel(MODEL_URLS.trOcrEncoder, 'trocr-encoder', progress),
          downloadAndCacheModel(MODEL_URLS.trOcrDecoder, 'trocr-decoder', progress),
          downloadAndCacheModel(MODEL_URLS.tokenizer, 'tokenizer', progress),
        ]);

        // Create sessions (ort-web loads from ArrayBuffer)
        const sessionOpts: ort.InferenceSession.SessionOptions = {
          executionProviders: eps,
        };

        yoloSession = await ort.InferenceSession.create(yoloBytes, sessionOpts);
        console.log('[models] YOLO inputs:', yoloSession.inputNames, 'outputs:', yoloSession.outputNames);
        self.postMessage({ type: 'model_status', payload: { model: 'yolo', status: 'loaded' } });

        encoderSession = await ort.InferenceSession.create(encoderBytes, sessionOpts);
        console.log('[models] Encoder inputs:', encoderSession.inputNames, 'outputs:', encoderSession.outputNames);
        self.postMessage({ type: 'model_status', payload: { model: 'trocr-encoder', status: 'loaded' } });

        decoderSession = await ort.InferenceSession.create(decoderBytes, sessionOpts);
        console.log('[models] Decoder inputs:', decoderSession.inputNames, 'outputs:', decoderSession.outputNames);
        self.postMessage({ type: 'model_status', payload: { model: 'trocr-decoder', status: 'loaded' } });

        tokenizer = new BpeTokenizer(new TextDecoder().decode(tokenizerBytes));
        self.postMessage({ type: 'model_status', payload: { model: 'tokenizer', status: 'loaded' } });

        ready = true;
        self.postMessage({ type: 'ready' });
        break;
      }

      case 'run_pipeline': {
        if (!ready || !yoloSession || !encoderSession || !decoderSession || !tokenizer) {
          throw new Error('Models not loaded');
        }

        const imageData = await decodeImage(e.data.payload.imageData);
        const { width: origW, height: origH } = imageData;

        // --- YOLO segmentation ---
        console.time('[pipeline] YOLO');
        const { tensor: yoloInput, scale, padX, padY } = preprocessYolo(imageData, 640);
        const yoloTensor = new ort.Tensor('float32', yoloInput, [1, 3, 640, 640]);

        const yoloInputName = yoloSession.inputNames[0];
        const yoloResult = await yoloSession.run({ [yoloInputName]: yoloTensor });
        const yoloOutputName = yoloSession.outputNames[0];
        const yoloOutput = yoloResult[yoloOutputName];

        let detections = parseYoloOutput(
          yoloOutput.data as Float32Array,
          yoloOutput.dims,
          origW,
          origH,
          scale,
          padX,
          padY,
          0.25,
          0.45,
        );

        // Sort by Y then X (reading order)
        detections.sort((a, b) => a.y - b.y || a.x - b.x);

        console.timeEnd('[pipeline] YOLO');
        console.log(`[pipeline] ${detections.length} lines detected`);
        self.postMessage({ type: 'segmentation', payload: { lines: detections } });

        // --- TrOCR transcription ---
        for (let i = 0; i < detections.length; i++) {
          const det = detections[i];
          const x = Math.max(0, Math.round(det.x));
          const y = Math.max(0, Math.round(det.y));
          const w = Math.max(1, Math.min(Math.round(det.w), origW - x));
          const h = Math.max(1, Math.min(Math.round(det.h), origH - y));

          const cropped = cropImageData(imageData, x, y, w, h);
          const encoderInput = preprocessTrOCR(cropped);

          // Run encoder
          console.time(`[line ${i}] encoder`);
          const pixelValues = new ort.Tensor('float32', encoderInput, [1, 3, 384, 384]);
          const encResult = await encoderSession.run({
            [encoderSession.inputNames[0]]: pixelValues,
          });
          const hiddenStates = encResult[encoderSession.outputNames[0]];
          console.log(`[line ${i}] encoder output shape:`, hiddenStates.dims);
          console.timeEnd(`[line ${i}] encoder`);

          // Autoregressive decoding
          console.time(`[line ${i}] decoder`);
          const decoderStartId = 2; // </s> token
          const maxLength = 256;
          const tokenIds: number[] = [decoderStartId];

          for (let step = 0; step < maxLength; step++) {
            const seqLen = tokenIds.length;

            // Build decoder inputs matching session's expected names
            const inputIds = new ort.Tensor(
              'int64',
              BigInt64Array.from(tokenIds.map(id => BigInt(id))),
              [1, seqLen],
            );
            const attentionMask = new ort.Tensor(
              'int64',
              new BigInt64Array(seqLen).fill(1n),
              [1, seqLen],
            );

            if (step === 0) {
              console.log(`[line ${i}] decoder step 0: input_ids=[1,${seqLen}], hidden=`, hiddenStates.dims);
            }

            // Use actual input names from the model
            const decFeeds: Record<string, ort.Tensor> = {};
            const decInputNames = decoderSession.inputNames;
            for (const name of decInputNames) {
              if (name.includes('input_ids') || name === 'input_ids') decFeeds[name] = inputIds;
              else if (name.includes('attention_mask') || name.includes('mask')) decFeeds[name] = attentionMask;
              else if (name.includes('hidden') || name.includes('encoder')) decFeeds[name] = hiddenStates;
              else console.warn(`[decoder] Unknown input: ${name}`);
            }
            if (step === 0) {
              console.log(`[line ${i}] decoder feeds:`, Object.keys(decFeeds));
            }

            let decResult;
            try {
              decResult = await decoderSession.run(decFeeds);
            } catch (decErr: any) {
              console.error(`[line ${i}] decoder step ${step} failed:`, decErr.message);
              break;
            }

            // Get logits: [1, seqLen, vocabSize]
            const logits = decResult[decoderSession.outputNames[0]];
            const logitsData = logits.data as Float32Array;
            const vocabSize = logits.dims[2];

            // Argmax over last token's logits
            const offset = (seqLen - 1) * vocabSize;
            let bestToken = 0;
            let bestScore = -Infinity;
            for (let v = 0; v < vocabSize; v++) {
              if (logitsData[offset + v] > bestScore) {
                bestScore = logitsData[offset + v];
                bestToken = v;
              }
            }

            if (bestToken === tokenizer.eosTokenId) break;

            const tokenText = tokenizer.decodeToken(bestToken);
            if (tokenText !== null) {
              self.postMessage({
                type: 'token',
                payload: { lineIndex: i, token: tokenText },
              });
            }

            tokenIds.push(bestToken);
          }

          console.timeEnd(`[line ${i}] decoder`);
          const fullText = tokenizer.decode(tokenIds.slice(1));
          console.log(`[line ${i}] "${fullText}" (${tokenIds.length - 1} tokens)`);
          self.postMessage({
            type: 'line_done',
            payload: { lineIndex: i, text: fullText, confidence: det.confidence },
          });
        }

        self.postMessage({ type: 'pipeline_done' });
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', payload: { message: err.message ?? String(err) } });
  }
};
