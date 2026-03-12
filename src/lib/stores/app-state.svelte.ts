import { HTRWorkerState } from '$lib/worker-state.svelte';
import type { ImageDocument, Line, LineGroup } from '$lib/types';
import type { TranscriptionGroup } from '$lib/api';

class AppState {
  htr = $state(new HTRWorkerState());
  documents = $state<ImageDocument[]>([]);
  activeDocumentId = $state<string | null>(null);
  hoveredLine = $state(-1);
  selectedLines = $state(new Set<number>());
  selectMode = $state(false);
  private docCounter = 0;

  get activeDocument(): ImageDocument | undefined {
    return this.documents.find(d => d.id === this.activeDocumentId);
  }

  addDocument(name: string, imageUrl: string, imageData: ArrayBuffer): string {
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
    if (!doc || !doc.placeholder || !doc.manifestId || !doc.pageNumber) return;

    const { fetchPageImage } = await import('$lib/riksarkivet');
    const result = await fetchPageImage(doc.manifestId, doc.pageNumber);
    if (result) {
      doc.imageUrl = result.previewUrl;
      doc.imageData = result.imageData;
      doc.placeholder = false;
      this.documents = [...this.documents];
      this.htr.addImage(doc.id, result.imageData.slice(0));
    }
  }

  switchDocument(docId: string) {
    if (docId === this.activeDocumentId) return;
    this.activeDocumentId = docId;
    this.hoveredLine = -1;
    this.selectedLines = new Set();
    this.loadDocumentImage(docId);
  }

  /** Update a document's lines (called from worker callbacks) */
  updateDocumentLines(docId: string, updater: (doc: ImageDocument) => void) {
    const doc = this.documents.find(d => d.id === docId);
    if (doc) {
      updater(doc);
      // Trigger reactivity
      this.documents = [...this.documents];
    }
  }

  /** Populate documents with existing transcriptions from backend */
  populateFromBackend(manifestId: string, groups: TranscriptionGroup[]) {
    for (const group of groups) {
      const doc = this.documents.find(
        d => d.manifestId === manifestId && d.pageNumber === group.page_number
      );
      if (!doc) continue;

      const lines: Line[] = group.lines.map(l => ({
        bbox: { ...l.bbox, confidence: l.confidence, polygon: undefined },
        text: l.text,
        confidence: l.confidence,
        complete: true,
      }));

      const startIndex = doc.lines.length;
      doc.lines.push(...lines);

      doc.groupCounter++;
      const lineGroup: LineGroup = {
        id: `group-${doc.groupCounter}`,
        name: group.group_name,
        lineIndices: lines.map((_, i) => startIndex + i),
        collapsed: false,
        rect: group.group_rect,
      };
      doc.groups.push(lineGroup);
    }
    this.documents = [...this.documents];
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
