/**
 * Letterbox-resize image to target size for YOLO.
 * Returns Float32Array in NCHW format plus scale/padding info.
 */
export function preprocessYolo(
	imageData: ImageData,
	targetSize: number,
): { tensor: Float32Array; scale: number; padX: number; padY: number } {
	const { width: origW, height: origH } = imageData;
	const scale = Math.min(targetSize / origW, targetSize / origH);
	const newW = Math.round(origW * scale);
	const newH = Math.round(origH * scale);
	const padX = (targetSize - newW) / 2;
	const padY = (targetSize - newH) / 2;

	// Use OffscreenCanvas for resize
	const canvas = new OffscreenCanvas(targetSize, targetSize);
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#808080'; // gray padding (YOLO convention)
	ctx.fillRect(0, 0, targetSize, targetSize);

	// Draw resized image onto canvas
	const srcCanvas = new OffscreenCanvas(origW, origH);
	const srcCtx = srcCanvas.getContext('2d')!;
	srcCtx.putImageData(imageData, 0, 0);
	ctx.drawImage(srcCanvas, padX, padY, newW, newH);

	const resized = ctx.getImageData(0, 0, targetSize, targetSize);
	const pixels = resized.data; // RGBA uint8

	// Convert to NCHW float32, normalized to [0, 1]
	const chw = new Float32Array(3 * targetSize * targetSize);
	for (let i = 0; i < targetSize * targetSize; i++) {
		chw[i] = pixels[i * 4] / 255.0; // R
		chw[targetSize * targetSize + i] = pixels[i * 4 + 1] / 255.0; // G
		chw[2 * targetSize * targetSize + i] = pixels[i * 4 + 2] / 255.0; // B
	}

	return { tensor: chw, scale, padX, padY };
}

/**
 * Resize and normalize image for TrOCR encoder.
 * Returns Float32Array in NCHW [1, 3, 384, 384] normalized with mean=0.5, std=0.5.
 */
export function preprocessTrOCR(imageData: ImageData): Float32Array {
	const size = 384;
	const canvas = new OffscreenCanvas(size, size);
	const ctx = canvas.getContext('2d')!;

	// Draw source image resized to 384x384
	const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height);
	const srcCtx = srcCanvas.getContext('2d')!;
	srcCtx.putImageData(imageData, 0, 0);
	ctx.drawImage(srcCanvas, 0, 0, size, size);

	const resized = ctx.getImageData(0, 0, size, size);
	const pixels = resized.data;

	// NCHW, normalize: (pixel/255 - 0.5) / 0.5 = pixel/127.5 - 1.0
	const chw = new Float32Array(3 * size * size);
	for (let i = 0; i < size * size; i++) {
		chw[i] = pixels[i * 4] / 127.5 - 1.0;
		chw[size * size + i] = pixels[i * 4 + 1] / 127.5 - 1.0;
		chw[2 * size * size + i] = pixels[i * 4 + 2] / 127.5 - 1.0;
	}

	return chw;
}

/**
 * Decode an image ArrayBuffer into ImageData using OffscreenCanvas.
 */
export async function decodeImage(buffer: ArrayBuffer): Promise<ImageData> {
	const blob = new Blob([buffer]);
	const bitmap = await createImageBitmap(blob);
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const ctx = canvas.getContext('2d')!;
	ctx.drawImage(bitmap, 0, 0);
	return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

/**
 * Crop a region from ImageData.
 */
export function cropImageData(
	imageData: ImageData,
	x: number,
	y: number,
	w: number,
	h: number,
): ImageData {
	const canvas = new OffscreenCanvas(imageData.width, imageData.height);
	const ctx = canvas.getContext('2d')!;
	ctx.putImageData(imageData, 0, 0);
	return ctx.getImageData(x, y, w, h);
}
