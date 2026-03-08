import * as ort from 'onnxruntime-web';
import { downloadAndCacheModel } from './lib/model-cache';
import { preprocessYolo, preprocessTrOCR, decodeImage, cropImageData } from './lib/preprocessing';
import { parseYoloOutput } from './lib/yolo';
import { BpeTokenizer } from './lib/tokenizer';

// Let ort-web resolve wasm/mjs files relative to its own module in node_modules
// Use multiple threads if SharedArrayBuffer is available (requires COOP/COEP headers)
const hasSharedBuffer = typeof SharedArrayBuffer !== 'undefined';
ort.env.wasm.numThreads = hasSharedBuffer ? navigator.hardwareConcurrency || 4 : 1;
console.log(`[ort-web] SharedArrayBuffer: ${hasSharedBuffer}, threads: ${ort.env.wasm.numThreads}`);

const MODEL_URLS = {
  yolo: '/models/yolo-lines.onnx',
  trOcrEncoder: '/models/encoder.onnx',
  trOcrDecoder: '/models/decoder.onnx',
  tokenizer: '/models/tokenizer.json',
};

let yoloSession: ort.InferenceSession | null = null;
let encoderSession: ort.InferenceSession | null = null;
let decoderSession: ort.InferenceSession | null = null;
let tokenizer: BpeTokenizer | null = null;
let ready = false;

self.onmessage = async (e: MessageEvent) => {
  try {
    switch (e.data.type) {
      case 'load_models': {
        console.log('[ort-web] Using execution provider: wasm');
        self.postMessage({
          type: 'model_status',
          payload: { model: 'backend', status: 'WASM' },
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

        const wasmOpts: ort.InferenceSession.SessionOptions = {
          executionProviders: ['wasm'],
        };

        yoloSession = await ort.InferenceSession.create(yoloBytes, wasmOpts);
        console.log('[models] YOLO inputs:', yoloSession.inputNames, 'outputs:', yoloSession.outputNames);
        self.postMessage({ type: 'model_status', payload: { model: 'yolo', status: 'loaded' } });

        encoderSession = await ort.InferenceSession.create(encoderBytes, wasmOpts);
        console.log('[models] Encoder inputs:', encoderSession.inputNames, 'outputs:', encoderSession.outputNames);
        self.postMessage({ type: 'model_status', payload: { model: 'trocr-encoder', status: 'loaded' } });

        decoderSession = await ort.InferenceSession.create(decoderBytes, wasmOpts);
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
        const yoloOutput = yoloResult[yoloSession.outputNames[0]];

        // Get prototype masks if available (seg model output1: [1, 32, 160, 160])
        const protoOutput = yoloSession.outputNames.length > 1
          ? yoloResult[yoloSession.outputNames[1]]
          : null;

        let detections = parseYoloOutput(
          yoloOutput.data as Float32Array,
          yoloOutput.dims,
          protoOutput ? protoOutput.data as Float32Array : null,
          protoOutput ? protoOutput.dims : null,
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
        for (let i = 0; i < Math.min(3, detections.length); i++) {
          const d = detections[i];
          console.log(`[line ${i}] bbox: (${d.x.toFixed(0)}, ${d.y.toFixed(0)}, ${d.w.toFixed(0)}, ${d.h.toFixed(0)})`,
            `polygon: ${d.polygon ? d.polygon.length + ' points' : 'none'}`,
            d.polygon ? `first: (${d.polygon[0].x.toFixed(0)}, ${d.polygon[0].y.toFixed(0)})` : '');
        }
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
          const hiddenStatesRaw = encResult[encoderSession.outputNames[0]];

          // Force encoder output to CPU so decoder can read it
          // (GPU tensors from one session may not transfer to another)
          let hiddenStates: ort.Tensor;
          if (hiddenStatesRaw.location === 'gpu-buffer') {
            const cpuData = await hiddenStatesRaw.getData();
            hiddenStates = new ort.Tensor('float32', cpuData as Float32Array, hiddenStatesRaw.dims);
            console.log(`[line ${i}] encoder output copied from GPU to CPU`);
          } else {
            hiddenStates = hiddenStatesRaw;
          }

          const hData = hiddenStates.data as Float32Array;
          console.log(`[line ${i}] encoder output shape:`, hiddenStates.dims,
            'location:', hiddenStatesRaw.location,
            'first 5 values:', Array.from(hData.slice(0, 5)).map(v => v.toFixed(4)));
          console.timeEnd(`[line ${i}] encoder`);

          // Greedy decoding
          console.time(`[line ${i}] decoder`);
          const maxLength = 256;

          // decoder_start_token_id = 0 (BOS) per generation_config.json
          const tokenIds: number[] = [0];

          for (let step = 0; step < maxLength; step++) {
            const seqLen = tokenIds.length;

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

            // Build decoder feeds dynamically from model's expected inputs
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
              console.error(`[line ${i}] decoder step ${step} failed:`, decErr.message);
              break;
            }

            // logits is the first output
            const logitsRaw = decResult['logits'];
            let logitsData: Float32Array;
            if (logitsRaw.location === 'gpu-buffer') {
              logitsData = (await logitsRaw.getData()) as Float32Array;
            } else {
              logitsData = logitsRaw.data as Float32Array;
            }
            const vocabSize = logitsRaw.dims[2];
            const offset = (seqLen - 1) * vocabSize;

            // Apply no_repeat_ngram_size=3: ban tokens that would create a repeated trigram
            const noRepeatNgramSize = 3;
            const bannedTokens = new Set<number>();
            bannedTokens.add(1); // always suppress PAD
            if (tokenIds.length >= noRepeatNgramSize - 1) {
              const prefix = tokenIds.slice(-(noRepeatNgramSize - 1));
              for (let j = 0; j <= tokenIds.length - noRepeatNgramSize; j++) {
                let match = true;
                for (let k = 0; k < noRepeatNgramSize - 1; k++) {
                  if (tokenIds[j + k] !== prefix[k]) { match = false; break; }
                }
                if (match) bannedTokens.add(tokenIds[j + noRepeatNgramSize - 1]);
              }
            }

            // Argmax over non-banned tokens
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
                payload: { lineIndex: i, token: tokenText },
              });
            }
          }

          console.timeEnd(`[line ${i}] decoder`);
          const fullText = tokenizer.decode(tokenIds.slice(1)); // skip BOS start token
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
