/**
 * GPU inference server client.
 * Stores the server URL in localStorage and provides inference functions.
 */

const STORAGE_KEY = 'lejonet-gpu-server-url';

export const gpuServerUrl = {
  get(): string {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(STORAGE_KEY) || '';
  },
  set(url: string) {
    if (typeof localStorage === 'undefined') return;
    if (url) {
      localStorage.setItem(STORAGE_KEY, url);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  },
};

export function isGpuServerEnabled(): boolean {
  return !!gpuServerUrl.get();
}

/**
 * Try to connect to a GPU server at the given URL.
 * Returns true if the server is healthy.
 */
let _gpuName = '';

export function getGpuName(): string {
  return _gpuName;
}

export async function probeGpuServer(url: string): Promise<boolean> {
  const base = url.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const data = await res.json();
    _gpuName = data.gpu?.name ?? '';

    // Check if all deployments are healthy via /status
    try {
      const statusRes = await fetch(`${base}/status`, { signal: AbortSignal.timeout(3000) });
      if (statusRes.ok) {
        const status = await statusRes.json();
        const allHealthy = Object.values(status.deployments as Record<string, { status: string }>)
          .every(d => d.status === 'HEALTHY');
        if (!allHealthy) return false;
      }
    } catch {
      // /status not available (simple mode) — that's fine
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-detect GPU server on common local addresses.
 * Tries localhost:8080 first (Docker default).
 * Returns the URL if found, empty string if not.
 */
export async function autoDetectGpuServer(): Promise<string> {
  // Try proxy path first (avoids COEP/CORS issues)
  if (await probeGpuServer('/gpu')) {
    return '/gpu';
  }
  // Try direct connections
  const candidates = [
    'http://localhost:8080',
    'http://127.0.0.1:8080',
  ];
  for (const url of candidates) {
    if (await probeGpuServer(url)) {
      return url;
    }
  }
  return '';
}

function baseUrl(): string {
  return gpuServerUrl.get().replace(/\/$/, '');
}

export interface GpuStatus {
  deployments: Record<string, { status: string; message?: string; replicas?: number }>;
  gpu: { name: string; runtime: string };
  cluster: { cpu_available: number; gpu_available: number; memory_gb: number };
}

export async function fetchGpuStatus(): Promise<GpuStatus | null> {
  if (!isGpuServerEnabled()) return null;
  try {
    const res = await fetch(`${baseUrl()}/status`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// Server-side image cache — upload once, reference by ID
const _imageIdCache = new Map<string, string>(); // localImageId → serverImageId

async function _ensureUploaded(imageData: ArrayBuffer, localId?: string): Promise<string> {
  const cacheKey = localId || `buf-${imageData.byteLength}`;
  const cached = _imageIdCache.get(cacheKey);
  if (cached) return cached;

  const form = new FormData();
  form.append('image', new Blob([imageData], { type: 'image/jpeg' }), 'page.jpg');
  const res = await fetch(`${baseUrl()}/upload-image`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Image upload failed: ${res.status}`);
  const { image_id } = await res.json();
  _imageIdCache.set(cacheKey, image_id);
  return image_id;
}

async function _gpuCall(
  endpoint: string,
  imageData: ArrayBuffer,
  localId: string | undefined,
  extraFields?: Record<string, string>,
): Promise<Response> {
  const imageId = await _ensureUploaded(imageData, localId);
  const form = new FormData();
  form.append('image_id', imageId);
  if (extraFields) {
    for (const [k, v] of Object.entries(extraFields)) form.append(k, v);
  }
  let res = await fetch(`${baseUrl()}${endpoint}`, { method: 'POST', body: form });

  // If 500, image_id might be stale — re-upload and retry once
  if (res.status === 500) {
    const cacheKey = localId || `buf-${imageData.byteLength}`;
    _imageIdCache.delete(cacheKey);
    const newId = await _ensureUploaded(imageData, localId);
    const retryForm = new FormData();
    retryForm.append('image_id', newId);
    if (extraFields) {
      for (const [k, v] of Object.entries(extraFields)) retryForm.append(k, v);
    }
    res = await fetch(`${baseUrl()}${endpoint}`, { method: 'POST', body: retryForm });
  }

  if (!res.ok) throw new Error(`GPU ${endpoint} failed: ${res.status}`);
  return res;
}

export async function gpuDetectLayout(imageData: ArrayBuffer, localId?: string): Promise<{
  regions: { label: string; confidence: number; x: number; y: number; w: number; h: number }[];
}> {
  const res = await _gpuCall('/detect-layout', imageData, localId);
  return res.json();
}

export async function gpuDetectLines(
  imageData: ArrayBuffer,
  region?: { x: number; y: number; w: number; h: number },
  localId?: string,
): Promise<{ lines: { x: number; y: number; w: number; h: number; confidence: number }[] }> {
  const extra: Record<string, string> = {};
  if (region) {
    extra.x = String(region.x);
    extra.y = String(region.y);
    extra.w = String(region.w);
    extra.h = String(region.h);
  }
  const res = await _gpuCall('/detect-lines', imageData, localId, extra);
  return res.json();
}

export async function gpuTranscribe(
  imageData: ArrayBuffer,
  bbox: { x: number; y: number; w: number; h: number },
  localId?: string,
): Promise<{ text: string; confidence: number }> {
  const res = await _gpuCall('/transcribe', imageData, localId, {
    x: String(bbox.x),
    y: String(bbox.y),
    w: String(bbox.w),
    h: String(bbox.h),
  });
  return res.json();
}

export async function gpuProcessPage(imageData: ArrayBuffer): Promise<{
  groups: {
    region: { label: string; confidence: number; x: number; y: number; w: number; h: number };
    lines: { bbox: { x: number; y: number; w: number; h: number }; text: string; confidence: number }[];
  }[];
}> {
  const form = new FormData();
  form.append('image', new Blob([imageData], { type: 'image/jpeg' }), 'page.jpg');
  const res = await fetch(`${baseUrl()}/process-page`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`GPU processing failed: ${res.status}`);
  return res.json();
}
