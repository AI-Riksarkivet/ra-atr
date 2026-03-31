import * as ort from 'onnxruntime-web';
import { downloadAndCacheModel } from './lib/model-cache';
import { preprocessTrOCR, decodeImage, cropImageData } from './lib/preprocessing';
import { BpeTokenizer } from './lib/tokenizer';

// Transcription worker: encoder + decoder, share CPU with siblings
const hasSharedBuffer = typeof SharedArrayBuffer !== 'undefined';
const cores = navigator.hardwareConcurrency || 4;
const DEV = self.location?.hostname === 'localhost';

// ORT recommends: min(cores/2, 4). Budget 4 threads for transcribe (the heavy worker).
// Must be set before any InferenceSession.create() — cannot be changed after.
ort.env.wasm.numThreads = hasSharedBuffer ? Math.min(4, Math.max(1, Math.floor(cores / 2))) : 1;
// Use CDN for WASM files to avoid HF LFS CORS issues
if (!DEV) ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';
console.log(
	`[transcribe] threads: ${ort.env.wasm.numThreads}, cores: ${cores}, SAB: ${hasSharedBuffer}, isolated: ${self.crossOriginIsolated}`,
);

let workerId = '0';
let poolSize = 1;

let modelUrls = {
	encoder: '/models/encoder.onnx',
	decoder: '/models/decoder.onnx',
	tokenizer: '/models/tokenizer.json',
};

let encoderSession: ort.InferenceSession | null = null;
let decoderSession: ort.InferenceSession | null = null;
let tokenizer: BpeTokenizer | null = null;
let ready = false;
let useKVCache = false;
let numLayers = 0;
let numHeads = 0;
let headDim = 0;

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
			case 'config': {
				workerId = e.data.payload?.id ?? '0';
				poolSize = parseInt(e.data.payload?.pool ?? '1', 10);
				// Note: numThreads cannot be changed after session creation, so we don't update it here
				if (DEV) console.log(`[transcribe-${workerId}] pool: ${poolSize}`);
				break;
			}

			case 'load_models': {
				if (e.data.payload?.modelUrls) modelUrls = { ...modelUrls, ...e.data.payload.modelUrls };
				const headers: Record<string, string> = e.data.payload?.headers ?? {};
				const progress = (p: { model: string; percent: number }) => {
					self.postMessage({
						type: 'model_status',
						payload: {
							model: p.model,
							status: 'downloading',
							progress: p.percent,
						},
					});
				};

				const [encoderBytes, decoderBytes, tokenizerBytes] = await Promise.all([
					downloadAndCacheModel(modelUrls.encoder, 'trocr-encoder', progress, headers),
					downloadAndCacheModel(modelUrls.decoder, 'trocr-decoder', progress, headers),
					downloadAndCacheModel(modelUrls.tokenizer, 'tokenizer', progress, headers),
				]);

				const sessionOpts: ort.InferenceSession.SessionOptions = {
					executionProviders: ['wasm'],
					graphOptimizationLevel: 'all',
				};

				encoderSession = await ort.InferenceSession.create(encoderBytes, sessionOpts);
				self.postMessage({
					type: 'model_status',
					payload: { model: 'trocr-encoder', status: 'loaded' },
				});

				decoderSession = await ort.InferenceSession.create(decoderBytes, sessionOpts);
				useKVCache = decoderSession.inputNames.some((n) => n.startsWith('past.'));
				if (useKVCache) {
					numLayers = decoderSession.inputNames.filter((n) => n.endsWith('.key')).length;
				}
				console.log(
					`[transcribe-${workerId}] decoder: ${useKVCache ? 'KV cache' : 'no cache'}, inputs:`,
					decoderSession.inputNames,
				);
				self.postMessage({
					type: 'model_status',
					payload: { model: 'trocr-decoder', status: 'loaded' },
				});

				tokenizer = new BpeTokenizer(new TextDecoder().decode(tokenizerBytes));
				self.postMessage({
					type: 'model_status',
					payload: { model: 'tokenizer', status: 'loaded' },
				});

				ready = true;
				self.postMessage({ type: 'ready' });
				break;
			}

			case 'add_image': {
				const { imageId, imageData } = e.data.payload;
				const decoded = await decodeImage(imageData);
				imageStore.set(imageId, decoded);
				if (DEV) console.log(`[transcribe-${workerId}] image added: ${imageId}`);
				break;
			}

			case 'transcribe_line': {
				lineQueue.push(e.data.payload);
				processNext();
				break;
			}

			case 'remove_image': {
				const { imageId } = e.data.payload;
				imageStore.delete(imageId);
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
	} catch (err: unknown) {
		self.postMessage({
			type: 'error',
			payload: { message: err instanceof Error ? err.message : String(err) },
		});
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
		const t0 = performance.now();
		const pixelValues = new ort.Tensor('float32', encoderInput, [1, 3, 384, 384]);
		const encResult = await encoderSession.run({
			[encoderSession.inputNames[0]]: pixelValues,
		});
		const hiddenStates = encResult[encoderSession.outputNames[0]];
		const encTime = performance.now() - t0;

		// Greedy decoding
		const decodeStart = performance.now();
		const maxLength = 256;
		const tokenIds: number[] = [0]; // BOS

		// KV cache: stores decoder self-attention keys/values between steps
		let pastKV: ort.Tensor[] | null = null;
		if (useKVCache) {
			// Initialize empty cache (zero-length sequence dimension)
			pastKV = [];
			for (let i = 0; i < numLayers; i++) {
				pastKV.push(new ort.Tensor('float32', new Float32Array(0), [1, 1, 0, 1]));
				pastKV.push(new ort.Tensor('float32', new Float32Array(0), [1, 1, 0, 1]));
			}
		}

		for (let step = 0; step < maxLength; step++) {
			if (cancelledRegions.has(regionId)) break;

			let decResult;
			try {
				if (useKVCache && pastKV) {
					// KV cache path: only feed the last token on steps 1+
					const token = step === 0 ? tokenIds : [tokenIds[tokenIds.length - 1]];
					const inputIds = new ort.Tensor(
						'int64',
						BigInt64Array.from(token.map((id) => BigInt(id))),
						[1, token.length],
					);
					const decFeeds: Record<string, ort.Tensor> = {
						input_ids: inputIds,
						encoder_hidden_states: hiddenStates,
					};
					for (let i = 0; i < numLayers; i++) {
						decFeeds[`past.${i}.key`] = pastKV[i * 2];
						decFeeds[`past.${i}.value`] = pastKV[i * 2 + 1];
					}
					decResult = await decoderSession.run(decFeeds);
					// Update KV cache from outputs
					for (let i = 0; i < numLayers; i++) {
						pastKV[i * 2] = decResult[`present.${i}.key`];
						pastKV[i * 2 + 1] = decResult[`present.${i}.value`];
					}
					// Detect dims from first output (once)
					if (step === 0 && numHeads === 0) {
						const shape = decResult['present.0.key'].dims;
						numHeads = shape[1];
						headDim = shape[3];
						console.log(
							`[transcribe-${workerId}] detected: layers=${numLayers}, heads=${numHeads}, headDim=${headDim}`,
						);
					}
				} else {
					// No-cache path: feed full sequence every step
					const seqLen = tokenIds.length;
					const inputIds = new ort.Tensor(
						'int64',
						BigInt64Array.from(tokenIds.map((id) => BigInt(id))),
						[1, seqLen],
					);
					const attentionMask = new ort.Tensor('int64', new BigInt64Array(seqLen).fill(1n), [
						1,
						seqLen,
					]);
					const decFeeds: Record<string, ort.Tensor> = {};
					for (const name of decoderSession.inputNames) {
						if (name === 'input_ids') decFeeds[name] = inputIds;
						else if (name === 'attention_mask') decFeeds[name] = attentionMask;
						else if (name === 'encoder_hidden_states') decFeeds[name] = hiddenStates;
					}
					decResult = await decoderSession.run(decFeeds);
				}
			} catch (decErr: unknown) {
				console.error(
					`[transcribe-${workerId} line ${lineIndex}] decoder step ${step} failed:`,
					decErr instanceof Error ? decErr.message : String(decErr),
				);
				break;
			}

			const logitsRaw = decResult['logits'];
			const logitsData = logitsRaw.data as Float32Array;
			const vocabSize = logitsRaw.dims[2];
			// With KV cache, logits has seq_len=1 on steps 1+; without cache, use last position
			const seqLen = logitsRaw.dims[1];
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

			// Decode full sequence so far to handle multi-byte UTF-8 chars (å, ä, ö)
			// that may span token boundaries
			const fullText = tokenizer.decode(tokenIds.slice(1));
			self.postMessage({
				type: 'token',
				payload: { imageId, regionId, lineIndex, token: fullText },
			});
		}

		if (!cancelledRegions.has(regionId)) {
			const fullText = tokenizer.decode(tokenIds.slice(1));
			const totalTime = performance.now() - t0;
			const decodeTime = performance.now() - decodeStart;
			const tokens = tokenIds.length - 1;
			console.log(
				`[transcribe-${workerId} line ${lineIndex}] ${tokens} tokens, enc=${encTime.toFixed(0)}ms, dec=${decodeTime.toFixed(0)}ms (${tokens > 0 ? (decodeTime / tokens).toFixed(0) : 0}ms/tok), total=${totalTime.toFixed(0)}ms | "${fullText}"`,
			);
			self.postMessage({
				type: 'line_done',
				payload: { imageId, regionId, lineIndex, text: fullText, confidence },
			});
		}
	} catch (err: unknown) {
		self.postMessage({
			type: 'error',
			payload: { message: err instanceof Error ? err.message : String(err) },
		});
	}

	cancelledRegions.delete(regionId);
	processing = false;
	processNext();
}
