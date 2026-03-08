const CACHE_NAME = 'htr-models-v3';

export interface DownloadProgress {
  model: string;
  loaded: number;
  total: number;
  percent: number;
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage?.persist) {
    return navigator.storage.persist();
  }
  return false;
}

export async function getStorageEstimate(): Promise<{ used: number; quota: number }> {
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    return { used: est.usage ?? 0, quota: est.quota ?? 0 };
  }
  return { used: 0, quota: 0 };
}

export async function getCachedModel(url: string): Promise<ArrayBuffer | null> {
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(url);
  if (response) {
    return response.arrayBuffer();
  }
  return null;
}

export async function downloadAndCacheModel(
  url: string,
  modelName: string,
  onProgress: (p: DownloadProgress) => void
): Promise<ArrayBuffer> {
  const cached = await getCachedModel(url);
  if (cached) {
    onProgress({ model: modelName, loaded: cached.byteLength, total: cached.byteLength, percent: 100 });
    return cached;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${modelName}: ${response.status}`);
  }

  const contentLength = Number(response.headers.get('Content-Length') ?? 0);
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress({
      model: modelName,
      loaded,
      total: contentLength,
      percent: contentLength > 0 ? Math.round((loaded / contentLength) * 100) : 0,
    });
  }

  const blob = new Blob(chunks);
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url, new Response(blob.slice(0)));
  } catch (e) {
    console.warn(`[model-cache] Failed to cache ${modelName}, continuing without cache:`, e);
  }

  return blob.arrayBuffer();
}

export async function isModelCached(url: string): Promise<boolean> {
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(url);
  return response !== null;
}

export async function areAllModelsCached(urls: string[]): Promise<boolean> {
  const cache = await caches.open(CACHE_NAME);
  const results = await Promise.all(urls.map((url) => cache.match(url)));
  return results.every((r) => r !== null);
}

export async function clearModelCache(): Promise<void> {
  await caches.delete(CACHE_NAME);
}
