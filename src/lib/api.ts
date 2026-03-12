const API_BASE = import.meta.env.VITE_API_URL || '';

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

export async function fetchTranscriptions(manifestId: string): Promise<TranscriptionGroup[]> {
  if (!API_BASE) return [];
  const res = await fetch(`${API_BASE}/transcriptions/${manifestId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.groups ?? [];
}

export async function contributeTranscriptions(
  manifestId: string,
  referenceCode: string,
  groups: TranscriptionGroup[],
  token: string,
): Promise<{ lines_added: number; contributor: string }> {
  if (!API_BASE) throw new Error('API not configured');
  const res = await fetch(`${API_BASE}/transcriptions/${manifestId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ reference_code: referenceCode, groups }),
  });
  if (!res.ok) throw new Error(`Contribute failed: ${res.status}`);
  return res.json();
}
