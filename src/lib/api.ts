const API_BASE = import.meta.env.VITE_API_URL || '';
export const BACKEND_ENABLED = import.meta.env.VITE_DISABLE_BACKEND !== 'true';

function getToken(): string {
  return sessionStorage.getItem('hf_token') || 'local';
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${getToken()}` };
}

export interface TranscriptionGroup {
  page_number: number;
  group_name: string;
  group_rect: { x: number; y: number; w: number; h: number };
  lines: {
    line_index: number;
    bbox: { x: number; y: number; w: number; h: number };
    text: string;
    confidence: number;
    source: string;
    contributor: string;
  }[];
}

export async function fetchTranscriptions(manifestId: string, query?: string): Promise<TranscriptionGroup[]> {
  const params = query ? `?q=${encodeURIComponent(query)}` : '';
  const res = await fetch(`${API_BASE}/transcriptions/${manifestId}${params}`, {
    headers: authHeaders(),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.groups ?? [];
}

export async function saveTranscriptions(
  manifestId: string,
  referenceCode: string,
  groups: TranscriptionGroup[],
): Promise<{ lines_added: number; contributor: string }> {
  const res = await fetch(`${API_BASE}/transcriptions/${manifestId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ reference_code: referenceCode, groups }),
  });
  if (!res.ok) throw new Error(`Save failed: ${res.status}`);
  return res.json();
}

export interface SavedManifest {
  manifest_id: string;
  reference_code: string;
  lines: number;
  groups: number;
  pages: number;
  last_saved: string;
}

export async function listTranscriptions(query?: string): Promise<SavedManifest[]> {
  const params = query ? `?q=${encodeURIComponent(query)}` : '';
  const res = await fetch(`${API_BASE}/transcriptions${params}`, {
    headers: authHeaders(),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.manifests ?? [];
}

export async function deleteTranscriptions(manifestId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/transcriptions/${manifestId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

export interface CatalogResult {
  reference_code: string;
  archive_code: string;
  fonds_title: string;
  fonds_description: string;
  creator: string;
  series_title: string;
  volume_id: string;
  date_text: string;
  description: string;
  digitized: boolean;
}

export async function searchCatalog(params: {
  q?: string;
  digitized?: boolean;
  date_start?: number;
  date_end?: number;
  archive?: string;
  mode?: 'fts' | 'vector' | 'hybrid';
  limit?: number;
  offset?: number;
}): Promise<{ results: CatalogResult[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set('q', params.q);
  if (params.digitized !== undefined) searchParams.set('digitized', String(params.digitized));
  if (params.date_start !== undefined) searchParams.set('date_start', String(params.date_start));
  if (params.date_end !== undefined) searchParams.set('date_end', String(params.date_end));
  if (params.archive) searchParams.set('archive', params.archive);
  if (params.mode) searchParams.set('mode', params.mode);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  const res = await fetch(`${API_BASE}/catalog/search?${searchParams}`, {
    headers: authHeaders(),
  });
  if (!res.ok) return { results: [], total: 0 };
  return res.json();
}

export interface RandomVolume {
  reference_code: string;
  archive_code: string;
  fonds_title: string;
  series_title: string;
  volume_id: string;
  date_text: string;
  description: string;
}

export async function fetchRandomVolume(): Promise<RandomVolume> {
  const res = await fetch(`${API_BASE}/catalog/random`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch random volume');
  return res.json();
}
