import { HTRWorkerState } from '$lib/worker-state.svelte';
import type { ImageDocument, Line, LineGroup } from '$lib/types';
import type { TranscriptionGroup } from '$lib/api';

const AUTOSAVE_DELAY = 2000;
const MAX_CACHED_IMAGES = 10;

class AppState {
  htr = $state(new HTRWorkerState());
  documents = $state<ImageDocument[]>([]);
  activeDocumentId = $state<string | null>(null);
  hoveredLine = $state(-1);
  selectedLines = $state(new Set<number>());
  selectMode = $state(false);
  saving = $state(false);
  saveError = $state<string | null>(null);
  lastSaved = $state<string | null>(null);
  private docCounter = 0;
  private uploadCounter = 0;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSaveHash = '';
  private imageLoadOrder: string[] = []; // LRU tracking for loaded images

  get activeDocument(): ImageDocument | undefined {
    return this.documents.find(d => d.id === this.activeDocumentId);
  }

  /** Create a new upload volume ID for grouping uploaded images together. */
  createUploadVolumeId(): string {
    this.uploadCounter++;
    return `upload-${this.uploadCounter}`;
  }

  addDocument(name: string, imageUrl: string, imageData: ArrayBuffer, manifestId?: string, pageNumber?: number): string {
    this.docCounter++;
    const id = `doc-${this.docCounter}`;
    const doc: ImageDocument = {
      id,
      name,
      imageUrl,
      imageData,
      lines: [],
      groups: [],
      groupCounter: 0,
      manifestId,
      pageNumber,
    };
    this.documents = [...this.documents, doc];
    // Send image to worker (clone buffer since addImage transfers it)
    this.htr.addImage(id, imageData.slice(0));
    return id;
  }

  addPlaceholderDocument(name: string, manifestId: string, pageNumber: number): string {
    this.docCounter++;
    const id = `doc-${this.docCounter}`;
    const doc: ImageDocument = {
      id,
      name,
      imageUrl: '',
      imageData: new ArrayBuffer(0),
      lines: [],
      groups: [],
      groupCounter: 0,
      manifestId,
      pageNumber,
      placeholder: true,
    };
    this.documents = [...this.documents, doc];
    return id;
  }

  async loadDocumentImage(docId: string) {
    const doc = this.documents.find(d => d.id === docId);
    if (!doc || !doc.manifestId || !doc.pageNumber) return;

    // Already loaded — just move to front of LRU
    if (!doc.placeholder) {
      this.imageLoadOrder = [docId, ...this.imageLoadOrder.filter(id => id !== docId)];
      return;
    }

    const { fetchPageImage } = await import('$lib/riksarkivet');
    const result = await fetchPageImage(doc.manifestId, doc.pageNumber);
    if (result) {
      doc.imageUrl = result.previewUrl;
      doc.imageData = result.imageData;
      doc.placeholder = false;

      // Track in LRU and evict oldest if over limit
      this.imageLoadOrder = [docId, ...this.imageLoadOrder.filter(id => id !== docId)];
      this.evictOldImages();

      this.documents = [...this.documents];
      this.htr.addImage(doc.id, result.imageData.slice(0));
    }
  }

  private evictOldImages() {
    while (this.imageLoadOrder.length > MAX_CACHED_IMAGES) {
      const evictId = this.imageLoadOrder.pop()!;
      // Don't evict the active document
      if (evictId === this.activeDocumentId) {
        this.imageLoadOrder.push(evictId);
        break;
      }
      const doc = this.documents.find(d => d.id === evictId);
      if (doc && !doc.placeholder && doc.manifestId) {
        // Revoke blob URL to free memory
        if (doc.imageUrl) URL.revokeObjectURL(doc.imageUrl);
        doc.imageUrl = '';
        doc.imageData = new ArrayBuffer(0);
        doc.placeholder = true;
      }
    }
  }

  switchDocument(docId: string) {
    if (docId === this.activeDocumentId) return;
    this.activeDocumentId = docId;
    this.hoveredLine = -1;
    this.selectedLines = new Set();
    this.loadDocumentImage(docId);
  }

  /** Remove all documents belonging to a volume */
  removeVolume(manifestId: string) {
    const toRemove = new Set(this.documents.filter(d => d.manifestId === manifestId).map(d => d.id));
    // Revoke blob URLs
    for (const doc of this.documents) {
      if (toRemove.has(doc.id) && doc.imageUrl) {
        try { URL.revokeObjectURL(doc.imageUrl); } catch {}
      }
    }
    this.documents = this.documents.filter(d => !toRemove.has(d.id));
    // Clear active if it was in this volume
    if (this.activeDocumentId && toRemove.has(this.activeDocumentId)) {
      this.activeDocumentId = null;
      this.hoveredLine = -1;
      this.selectedLines = new Set();
    }
    // Clean up LRU cache
    this.imageLoadOrder = this.imageLoadOrder.filter(id => !toRemove.has(id));
  }

  /** Navigate to adjacent page within the same volume */
  navigatePage(delta: -1 | 1) {
    const doc = this.activeDocument;
    if (!doc?.manifestId) return;
    const siblings = this.documents
      .filter(d => d.manifestId === doc.manifestId)
      .sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0));
    const idx = siblings.findIndex(d => d.id === doc.id);
    const next = siblings[idx + delta];
    if (next) this.switchDocument(next.id);
  }

  /** Navigate to adjacent line within the active document */
  navigateLine(delta: -1 | 1) {
    const doc = this.activeDocument;
    if (!doc || doc.lines.length === 0) return;
    const current = this.hoveredLine;
    if (current < 0) {
      this.hoveredLine = delta === 1 ? 0 : doc.lines.length - 1;
    } else {
      const next = current + delta;
      if (next >= 0 && next < doc.lines.length) this.hoveredLine = next;
    }
  }

  /** Update a document's lines (called from worker callbacks) */
  updateDocumentLines(docId: string, updater: (doc: ImageDocument) => void) {
    const doc = this.documents.find(d => d.id === docId);
    if (doc) {
      updater(doc);
      // Trigger reactivity
      this.documents = [...this.documents];
      // Auto-save if this is a Riksarkivet document
      if (doc.manifestId) this.scheduleAutoSave();
    }
  }

  /** Populate documents with existing transcriptions from backend */
  populateFromBackend(manifestId: string, groups: TranscriptionGroup[]) {
    for (const group of groups) {
      const doc = this.documents.find(
        d => d.manifestId === manifestId && d.pageNumber === group.page_number
      );
      if (!doc) continue;

      // Skip if this doc already has groups (already populated or HTR ran)
      if (doc.groups.length > 0) continue;

      const newLines: Line[] = group.lines.map(l => ({
        bbox: { ...l.bbox, confidence: l.confidence, polygon: undefined },
        text: l.text,
        confidence: l.confidence,
        complete: true,
      }));

      const startIndex = doc.lines.length;
      doc.groupCounter++;
      const lineGroup: LineGroup = {
        id: `group-${doc.groupCounter}`,
        name: group.group_name,
        lineIndices: newLines.map((_, i) => startIndex + i),
        collapsed: false,
        rect: group.group_rect,
      };

      // Use assignment (not push) to trigger Svelte reactivity
      doc.lines = [...doc.lines, ...newLines];
      doc.groups = [...doc.groups, lineGroup];
    }
    this.documents = [...this.documents];
  }

  /** Serialize current transcriptions for the backend API — only complete lines with text */
  serializeForSave(): { manifestId: string; referenceCode: string; groups: TranscriptionGroup[] } | null {
    const docs = this.documents.filter(d => d.manifestId && d.groups.length > 0);
    if (docs.length === 0) return null;

    const manifestId = docs[0].manifestId!;
    const groups: TranscriptionGroup[] = [];

    for (const doc of docs) {
      if (doc.manifestId !== manifestId) continue;
      for (const group of doc.groups) {
        const lines = group.lineIndices
          .map(i => doc.lines[i])
          .filter(line => line && line.complete && line.text.trim() !== '')
          .map((line, idx) => ({
            line_index: idx,
            bbox: { x: line.bbox.x, y: line.bbox.y, w: line.bbox.w, h: line.bbox.h },
            text: line.text,
            confidence: line.confidence,
            source: line.complete ? 'htr' as const : 'human' as const,
            contributor: '',
          }));
        if (lines.length > 0) {
          groups.push({
            page_number: doc.pageNumber ?? 0,
            group_name: group.name,
            group_rect: group.rect ?? { x: 0, y: 0, w: 0, h: 0 },
            lines,
          });
        }
      }
    }

    if (groups.length === 0) return null;
    return { manifestId, referenceCode: '', groups };
  }

  /** Schedule a debounced auto-save to backend */
  scheduleAutoSave() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => this.save(), AUTOSAVE_DELAY);
  }

  private async save() {
    if (this.saving) { console.log('[autosave] skip: already saving'); return; }
    const data = this.serializeForSave();
    if (!data) { console.log('[autosave] skip: no data'); return; }

    // Skip if nothing changed since last save
    const hash = JSON.stringify(data.groups);
    if (hash === this.lastSaveHash) { console.log('[autosave] skip: unchanged'); return; }
    console.log(`[autosave] saving ${data.groups.reduce((n, g) => n + g.lines.length, 0)} lines`);

    this.saving = true;
    this.saveError = null;

    try {
      const { saveTranscriptions } = await import('$lib/api');
      const result = await saveTranscriptions(
        data.manifestId, data.referenceCode, data.groups,
      );
      this.lastSaveHash = hash;
      this.lastSaved = `Saved ${result.lines_added} lines`;
    } catch (err) {
      this.saveError = err instanceof Error ? err.message : String(err);
    } finally {
      this.saving = false;
    }
  }

  reset() {
    this.documents = [];
    this.activeDocumentId = null;
    this.htr.reset();
    this.selectedLines = new Set();
    this.selectMode = false;
  }
}

export const appState = new AppState();
