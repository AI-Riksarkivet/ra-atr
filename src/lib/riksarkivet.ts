const OAI_PMH_BASE = 'https://oai-pmh.riksarkivet.se/OAI';
const IIIF_BASE = 'https://lbiiif.riksarkivet.se';

/** Resolve a reference code to a IIIF manifest ID via OAI-PMH */
export async function resolveManifestId(referenceCode: string): Promise<string> {
  const url = `${OAI_PMH_BASE}?verb=GetRecord&identifier=${encodeURIComponent(referenceCode)}&metadataPrefix=oai_ape_ead`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OAI-PMH request failed: ${res.status}`);
  const xml = await res.text();

  // Extract manifest ID from <dao> elements
  // Look for xlink:role="MANIFEST" first, then fall back to nad_link parsing
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');

  // Check for OAI-PMH error
  const error = doc.querySelector('error');
  if (error) {
    throw new Error(`Riksarkivet: ${error.textContent || error.getAttribute('code') || 'Unknown error'}`);
  }

  // Try to find manifest URL in dao elements
  const daos = doc.querySelectorAll('dao');
  for (const dao of daos) {
    const href = dao.getAttribute('xlink:href') || dao.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
    if (href.includes('bildvisning/')) {
      // Extract manifest ID from bildvisning URL like .../bildvisning/R0001203?...
      const match = href.match(/bildvisning\/([A-Z0-9]+)/i);
      if (match) return match[1];
    }
    if (href.includes('/manifest')) {
      // Direct manifest URL — extract ID
      const match = href.match(/arkis[%!]21?([A-Z0-9]+)\/manifest/i);
      if (match) return match[1];
    }
  }

  throw new Error('Could not find IIIF manifest ID in OAI-PMH response');
}

/** Get total page count from IIIF manifest */
export async function getPageCount(manifestId: string): Promise<number> {
  const url = `${IIIF_BASE}/arkis!${manifestId}/manifest`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch IIIF manifest: ${res.status}`);
  const manifest = await res.json();
  return manifest.items?.length ?? 0;
}

/** Construct IIIF image URL for a given manifest and page number (1-based) */
export function pageImageUrl(manifestId: string, page: number): string {
  const padded = String(page).padStart(5, '0');
  return `${IIIF_BASE}/arkis!${manifestId}_${padded}/full/max/0/default.jpg`;
}

/** Fetch a single page image as ArrayBuffer + blob URL */
export async function fetchPageImage(
  manifestId: string,
  page: number,
): Promise<{ imageData: ArrayBuffer; previewUrl: string } | null> {
  const url = pageImageUrl(manifestId, page);
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const blob = new Blob([buf], { type: 'image/jpeg' });
  const previewUrl = URL.createObjectURL(blob);
  return { imageData: buf, previewUrl };
}

export interface ImportProgress {
  stage: 'resolving' | 'manifest' | 'fetching' | 'done' | 'error';
  currentPage: number;
  totalPages: number;
  manifestId: string;
  error?: string;
}

/**
 * Import all pages from a Riksarkivet volume.
 * Calls onPage for each successfully fetched page.
 * Calls onProgress for status updates.
 * Uses limited concurrency to be polite to the server.
 */
export async function importVolume(
  referenceCode: string,
  onPage: (page: { name: string; imageData: ArrayBuffer; previewUrl: string }) => void,
  onProgress: (progress: ImportProgress) => void,
  concurrency = 3,
  pageRange?: { start: number; end: number },
): Promise<void> {
  let manifestId = '';

  try {
    onProgress({ stage: 'resolving', currentPage: 0, totalPages: 0, manifestId: '' });
    manifestId = await resolveManifestId(referenceCode);

    onProgress({ stage: 'manifest', currentPage: 0, totalPages: 0, manifestId });
    const volumePages = await getPageCount(manifestId);

    if (volumePages === 0) {
      throw new Error('No pages found in this volume');
    }

    const start = pageRange ? Math.max(1, pageRange.start) : 1;
    const end = pageRange ? Math.min(pageRange.end, volumePages) : volumePages;
    const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const totalPages = pages.length;

    onProgress({ stage: 'fetching', currentPage: 0, totalPages, manifestId });

    // Fetch with limited concurrency
    let completed = 0;

    for (let i = 0; i < pages.length; i += concurrency) {
      const batch = pages.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((page) => fetchPageImage(manifestId, page)),
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result) {
          const pageNum = batch[j];
          const padded = String(pageNum).padStart(5, '0');
          onPage({
            name: `${manifestId}_${padded}.jpg`,
            imageData: result.imageData,
            previewUrl: result.previewUrl,
          });
        }
        completed++;
        onProgress({ stage: 'fetching', currentPage: completed, totalPages, manifestId });
      }
    }

    onProgress({ stage: 'done', currentPage: totalPages, totalPages, manifestId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress({ stage: 'error', currentPage: 0, totalPages: 0, manifestId, error: message });
    throw err;
  }
}
