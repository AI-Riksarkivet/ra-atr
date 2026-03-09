import { HTRWorkerState } from '$lib/worker-state.svelte';
import type { ImageDocument, LineGroup } from '$lib/types';

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

  switchDocument(docId: string) {
    if (docId === this.activeDocumentId) return;
    this.activeDocumentId = docId;
    this.hoveredLine = -1;
    this.selectedLines = new Set();
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

  reset() {
    this.documents = [];
    this.activeDocumentId = null;
    this.htr.reset();
    this.selectedLines = new Set();
    this.selectMode = false;
  }
}

export const appState = new AppState();
