import { HTRWorkerState } from '$lib/worker-state.svelte';
import type { LineGroup } from '$lib/types';

class AppState {
  htr = $state(new HTRWorkerState());
  imageUrl = $state<string | null>(null);
  hoveredLine = $state(-1);
  selectedLines = $state(new Set<number>());
  groups = $state<LineGroup[]>([]);
  groupCounter = $state(0);
  selectMode = $state(false);

  reset() {
    this.imageUrl = null;
    this.htr.reset();
    this.selectedLines = new Set();
    this.groups = [];
    this.groupCounter = 0;
    this.selectMode = false;
  }
}

export const appState = new AppState();
