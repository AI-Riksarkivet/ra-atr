import * as ort from 'onnxruntime-web';
import { downloadAndCacheModel } from './lib/model-cache';
import { preprocessTrOCR, decodeImage, cropImageData } from './lib/preprocessing';
import { BpeTokenizer } from './lib/tokenizer';

// Transcription worker: encoder + decoder, share CPU with siblings
const hasSharedBuffer = typeof SharedArrayBuffer !== 'undefined';
const cores = navigator.hardwareConcurrency || 4;
// Thread count passed via URL search param, fallback to reasonable default
const params = new URL(import.meta.url).searchParams;
const poolSize = parseInt(params.get('pool') ?? '2', 10);
ort.env.wasm.numThreads = hasSharedBuffer ? Math.max(1, Math.floor(cores / (poolSize + 1))) : 1;

const workerId = params.get('id') ?? '0';
console.log(`[transcribe-${workerId}] threads: ${ort.env.wasm.numThreads}, pool: ${poolSize}`);

const MODEL_URLS = {
  encoder: '/models/encoder.onnx',
  decoder: '/models/decoder.onnx',
  tokenizer: '/models/tokenizer.json',
};

let encoderSession: ort.InferenceSession | null = null;
let decoderSession: ort.InferenceSession | null = null;
let tokenizer: BpeTokenizer | null = null;
let ready = false;

const imageStore = new Map<string, ImageData>();

type LineRequest = {
  imageId: string;
  regionId: string;
  lineIndex: number;
  bbox: { x: number; y: number; w: number; h: number };
  confidence: number;
};
const lineQueue: LineRequest[] = [];
let processing = false;
const cancelledRegions = new Set<string>();

self.onmessage = async (e: MessageEvent) => {
  try {
    switch (e.data.type) {
      case 'load_models': {
        const progress = (p: { model: string; percent: number }) => {
          self.postMessage({
            type: 'model_status',
            payload: { model: p.model, status: 'downloading', progress: p.percent },
          });
        };

        const [encoderBytes, decoderBytes, tokenizerBytes] = await Promise.all([
          downloadAndCacheModel(MODEL_URLS.encoder, 'trocr-encoder', progress),
          downloadAndCacheModel(MODEL_URLS.decoder, 'trocr-decoder', progress),
          downloadAndCacheModel(MODEL_URLS.tokenizer, 'tokenizer', progress),
        ]);

        const wasmOpts: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'] };

        encoderSession = await ort.InferenceSession.create(encoderBytes, wasmOpts);
        self.postMessage({ type: 'model_status', payload: { model: 'trocr-encoder', status: 'loaded' } });

        decoderSession = await ort.InferenceSession.create(decoderBytes, wasmOpts);
        self.postMessage({ type: 'model_status', payload: { model: 'trocr-decoder', status: 'loaded' } });

        tokenizer = new BpeTokenizer(new TextDecoder().decode(tokenizerBytes));
        self.postMessage({ type: 'model_status', payload: { model: 'tokenizer', status: 'loaded' } });

        ready = true;
        self.postMessage({ type: 'ready' });
        break;
      }

      case 'add_image': {
        const { imageId, imageData } = e.data.payload;
        const decoded = await decodeImage(imageData);
        imageStore.set(imageId, decoded);
        console.log(`[transcribe-${workerId}] image added: ${imageId}`);
        break;
      }

      case 'transcribe_line': {
        lineQueue.push(e.data.payload);
        processNext();
        break;
      }

      case 'cancel_region': {
        const { regionId } = e.data.payload;
        cancelledRegions.add(regionId);
        // Remove queued lines for this region
        for (let i = lineQueue.length - 1; i >= 0; i--) {
          if (lineQueue[i].regionId === regionId) lineQueue.splice(i, 1);
        }
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', payload: { message: err.message ?? String(err) } });
  }
};

async function processNext() {
  if (processing || lineQueue.length === 0) return;
  processing = true;

  const req = lineQueue.shift()!;
  const { imageId, regionId, lineIndex, bbox, confidence } = req;

  if (cancelledRegions.has(regionId)) {
    processing = false;
    processNext();
    return;
  }

  try {
    if (!ready || !encoderSession || !decoderSession || !tokenizer) {
      throw new Error('Models not loaded');
    }

    const imgData = imageStore.get(imageId);
    if (!imgData) throw new Error(`No image data for ${imageId}`);

    const origW = imgData.width;
    const origH = imgData.height;
    const lx = Math.max(0, Math.round(bbox.x));
    const ly = Math.max(0, Math.round(bbox.y));
    const lw = Math.max(1, Math.min(Math.round(bbox.w), origW - lx));
    const lh = Math.max(1, Math.min(Math.round(bbox.h), origH - ly));

    const lineCrop = cropImageData(imgData, lx, ly, lw, lh);
    const encoderInput = preprocessTrOCR(lineCrop);

    // Encoder
    const pixelValues = new ort.Tensor('float32', encoderInput, [1, 3, 384, 384]);
    const encResult = await encoderSession.run({
      [encoderSession.inputNames[0]]: pixelValues,
    });
    const hiddenStatesRaw = encResult[encoderSession.outputNames[0]];

    let hiddenStates: ort.Tensor;
    if (hiddenStatesRaw.location === 'gpu-buffer') {
      const cpuData = await hiddenStatesRaw.getData();
      hiddenStates = new ort.Tensor('float32', cpuData as Float32Array, hiddenStatesRaw.dims);
    } else {
      hiddenStates = hiddenStatesRaw;
    }

    // Greedy decoding
    const maxLength = 256;
    const tokenIds: number[] = [0]; // BOS

    for (let step = 0; step < maxLength; step++) {
      if (cancelledRegions.has(regionId)) break;

      const seqLen = tokenIds.length;
      const inputIds = new ort.Tensor('int64', BigInt64Array.from(tokenIds.map(id => BigInt(id))), [1, seqLen]);
      const attentionMask = new ort.Tensor('int64', new BigInt64Array(seqLen).fill(1n), [1, seqLen]);

      const decFeeds: Record<string, ort.Tensor> = {};
      for (const name of decoderSession.inputNames) {
        if (name === 'input_ids') decFeeds[name] = inputIds;
        else if (name === 'attention_mask') decFeeds[name] = attentionMask;
        else if (name === 'encoder_hidden_states') decFeeds[name] = hiddenStates;
      }

      let decResult;
      try {
        decResult = await decoderSession.run(decFeeds);
      } catch (decErr: any) {
        console.error(`[transcribe-${workerId} line ${lineIndex}] decoder step ${step} failed:`, decErr.message);
        break;
      }

      const logitsRaw = decResult['logits'];
      let logitsData: Float32Array;
      if (logitsRaw.location === 'gpu-buffer') {
        logitsData = (await logitsRaw.getData()) as Float32Array;
      } else {
        logitsData = logitsRaw.data as Float32Array;
      }
      const vocabSize = logitsRaw.dims[2];
      const offset = (seqLen - 1) * vocabSize;

      // no_repeat_ngram_size=3
      const bannedTokens = new Set<number>();
      bannedTokens.add(1); // suppress PAD
      if (tokenIds.length >= 2) {
        const prefix = tokenIds.slice(-2);
        for (let j = 0; j <= tokenIds.length - 3; j++) {
          if (tokenIds[j] === prefix[0] && tokenIds[j + 1] === prefix[1]) {
            bannedTokens.add(tokenIds[j + 2]);
          }
        }
      }

      let bestToken = 0;
      let bestScore = -Infinity;
      for (let v = 0; v < vocabSize; v++) {
        if (bannedTokens.has(v)) continue;
        if (logitsData[offset + v] > bestScore) {
          bestScore = logitsData[offset + v];
          bestToken = v;
        }
      }

      if (bestToken === tokenizer.eosTokenId) break;
      tokenIds.push(bestToken);

      const tokenText = tokenizer.decodeToken(bestToken);
      if (tokenText !== null) {
        self.postMessage({
          type: 'token',
          payload: { imageId, lineIndex, token: tokenText },
        });
      }
    }

    if (!cancelledRegions.has(regionId)) {
      const fullText = tokenizer.decode(tokenIds.slice(1));
      console.log(`[transcribe-${workerId} line ${lineIndex}] "${fullText}"`);
      self.postMessage({
        type: 'line_done',
        payload: { imageId, lineIndex, text: fullText, confidence },
      });
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', payload: { message: (err as Error).message ?? String(err) } });
  }

  cancelledRegions.delete(regionId);
  processing = false;
  processNext();
}
