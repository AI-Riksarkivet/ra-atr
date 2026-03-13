const API_BASE = import.meta.env.VITE_API_URL || '';

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
  if (!API_BASE) return [];
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
  if (!API_BASE) throw new Error('API not configured');
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
  if (!API_BASE) return [];
  const params = query ? `?q=${encodeURIComponent(query)}` : '';
  const res = await fetch(`${API_BASE}/transcriptions${params}`, {
    headers: authHeaders(),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.manifests ?? [];
}

export async function deleteTranscriptions(manifestId: string): Promise<void> {
  if (!API_BASE) return;
  const res = await fetch(`${API_BASE}/transcriptions/${manifestId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}
