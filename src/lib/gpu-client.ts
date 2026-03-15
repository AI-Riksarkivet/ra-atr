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
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const data = await res.json();
      _gpuName = data.gpu?.name ?? '';
      return true;
    }
    return false;
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

export async function gpuDetectLayout(imageData: ArrayBuffer): Promise<{
  regions: { label: string; confidence: number; x: number; y: number; w: number; h: number }[];
}> {
  const form = new FormData();
  form.append('image', new Blob([imageData], { type: 'image/jpeg' }), 'page.jpg');
  const res = await fetch(`${baseUrl()}/detect-layout`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`GPU layout detection failed: ${res.status}`);
  return res.json();
}

export async function gpuDetectLines(
  imageData: ArrayBuffer,
  region?: { x: number; y: number; w: number; h: number },
): Promise<{ lines: { x: number; y: number; w: number; h: number; confidence: number }[] }> {
  const form = new FormData();
  form.append('image', new Blob([imageData], { type: 'image/jpeg' }), 'page.jpg');
  if (region) {
    form.append('x', String(region.x));
    form.append('y', String(region.y));
    form.append('w', String(region.w));
    form.append('h', String(region.h));
  }
  const res = await fetch(`${baseUrl()}/detect-lines`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`GPU line detection failed: ${res.status}`);
  return res.json();
}

export async function gpuTranscribe(
  imageData: ArrayBuffer,
  bbox: { x: number; y: number; w: number; h: number },
): Promise<{ text: string; confidence: number }> {
  const form = new FormData();
  form.append('image', new Blob([imageData], { type: 'image/jpeg' }), 'page.jpg');
  form.append('x', String(bbox.x));
  form.append('y', String(bbox.y));
  form.append('w', String(bbox.w));
  form.append('h', String(bbox.h));
  const res = await fetch(`${baseUrl()}/transcribe`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`GPU transcription failed: ${res.status}`);
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
