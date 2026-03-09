<script lang="ts">
  import { HTRWorkerState } from './lib/worker-state.svelte';
  import UploadPanel from './lib/components/UploadPanel.svelte';
  import DocumentViewer from './lib/components/DocumentViewer.svelte';
  import TranscriptionPanel from './lib/components/TranscriptionPanel.svelte';
  import StatusBar from './lib/components/StatusBar.svelte';
  import ModelManager from './lib/components/ModelManager.svelte';
  import type { LineGroup } from './lib/types';
  import { onMount } from 'svelte';

  let htr = $state(new HTRWorkerState());
  let imageUrl = $state<string | null>(null);
  let dividerX = $state(60); // percentage for left panel
  let hoveredLine = $state(-1);
  let selectedLines = $state(new Set<number>());
  let groups = $state<LineGroup[]>([]);
  let groupCounter = $state(0);
  let selectMode = $state(false);
  let isDraggingDivider = $state(false);
  let docViewer: DocumentViewer;

  function handleSelectLine(index: number, additive: boolean) {
    if (index < 0) {
      selectedLines = new Set();
      return;
    }
    if (additive) {
      const next = new Set(selectedLines);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      selectedLines = next;
    } else {
      selectedLines = new Set([index]);
    }
  }

  function handleMarqueeSelect(indices: number[]) {
    selectedLines = new Set(indices);
  }

  function createGroup() {
    if (selectedLines.size === 0) return;
    // Remove selected lines from existing groups
    const sel = selectedLines;
    for (const g of groups) {
      g.lineIndices = g.lineIndices.filter(i => !sel.has(i));
    }
    // Remove empty groups
    groups = groups.filter(g => g.lineIndices.length > 0);
    // Create new group with selected lines sorted by index
    groupCounter++;
    const newGroup: LineGroup = {
      id: `group-${groupCounter}`,
      name: `Group ${groupCounter}`,
      lineIndices: [...sel].sort((a, b) => a - b),
      collapsed: false,
    };
    groups = [...groups, newGroup];
    selectedLines = new Set();

    // Reprioritize transcription: grouped lines first (in group order), then ungrouped
    if (htr.stage === 'transcribing') {
      const allGroups = [...groups.filter(g => g.lineIndices.length > 0)];
      const grouped = new Set(allGroups.flatMap(g => g.lineIndices));
      const order = [
        ...allGroups.flatMap(g => g.lineIndices),
        ...Array.from({ length: htr.lines.length }, (_, i) => i).filter(i => !grouped.has(i)),
      ];
      htr.prioritizeLines(order);
    }
  }

  function deleteGroup(groupId: string) {
    groups = groups.filter(g => g.id !== groupId);
  }

  function renameGroup(groupId: string, name: string) {
    groups = groups.map(g => g.id === groupId ? { ...g, name } : g);
  }

  function toggleGroup(groupId: string) {
    groups = groups.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g);
  }

  onMount(() => {
    return () => htr.destroy();
  });

  function handleUpload(imageData: ArrayBuffer, previewUrl: string) {
    imageUrl = previewUrl;
    htr.runPipeline(imageData);
  }

  function onDividerPointerDown(e: PointerEvent) {
    isDraggingDivider = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onDividerPointerMove(e: PointerEvent) {
    if (!isDraggingDivider) return;
    const container = (e.target as HTMLElement).parentElement!;
    const rect = container.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    dividerX = Math.min(85, Math.max(25, pct));
  }

  function onDividerPointerUp(e: PointerEvent) {
    isDraggingDivider = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }
</script>

<div class="app">
  <header>
    <h1>Lejonet HTR</h1>
    {#if htr.modelsReady}
      <span class="badge ready">Ready</span>
    {/if}
    {#if imageUrl && htr.lines.length > 0}
      <button
        class="mode-btn"
        class:active={selectMode}
        onclick={() => { selectMode = !selectMode; if (!selectMode) selectedLines = new Set(); }}
      >{selectMode ? 'Pan mode' : 'Select'}</button>
    {/if}
    {#if imageUrl}
      <button class="new-btn" onclick={() => { imageUrl = null; htr.reset(); selectedLines = new Set(); groups = []; groupCounter = 0; selectMode = false; }}>New image</button>
    {/if}
  </header>

  {#if htr.error}
    <div class="error-bar">{htr.error}</div>
  {/if}

  <div class="workspace">
    {#if !htr.modelsReady && !htr.cacheChecked}
      <div class="loading-container"><p>Checking cached models...</p></div>
    {:else if !htr.modelsReady}
      <ModelManager
        modelProgress={htr.modelProgress}
        onLoadModels={() => htr.loadModels()}
        modelsReady={htr.modelsReady}
        autoLoading={htr.stage === 'loading_models'}
      />
    {:else if !imageUrl}
      <div class="upload-container">
        <UploadPanel onUpload={handleUpload} disabled={!htr.modelsReady} />
      </div>
    {:else}
      {#if selectedLines.size > 0}
        <div class="toolbar">
          <span class="toolbar-info">{selectedLines.size} line{selectedLines.size > 1 ? 's' : ''} selected</span>
          <button class="toolbar-btn" onclick={createGroup}>Group selected</button>
          <button class="toolbar-btn secondary" onclick={() => selectedLines = new Set()}>Clear</button>
        </div>
      {/if}
      <div class="panels">
        <div class="left-panel" style="width: {dividerX}%">
          <DocumentViewer bind:this={docViewer} {imageUrl} lines={htr.lines} currentLine={htr.currentLine} {hoveredLine} onHoverLine={(i) => hoveredLine = i} stage={htr.stage} {selectedLines} onSelectLine={handleSelectLine} onMarqueeSelect={handleMarqueeSelect} {groups} {selectMode} />
        </div>
        <div
          class="divider"
          class:active={isDraggingDivider}
          onpointerdown={onDividerPointerDown}
          onpointermove={onDividerPointerMove}
          onpointerup={onDividerPointerUp}
          role="separator"
        ></div>
        <div class="right-panel" style="width: {100 - dividerX}%">
          <TranscriptionPanel
            lines={htr.lines}
            currentLine={htr.currentLine}
            currentText={htr.currentText}
            {hoveredLine}
            onHoverLine={(i) => hoveredLine = i}
            {selectedLines}
            onSelectLine={handleSelectLine}
            {groups}
            onToggleGroup={toggleGroup}
            onRenameGroup={renameGroup}
            onDeleteGroup={deleteGroup}
            onFocusGroup={(indices) => docViewer?.focusLines(indices)}
            onFocusLine={(i) => docViewer?.focusLines([i])}
            {selectMode}
          />
        </div>
      </div>
    {/if}
  </div>

  {#if htr.stage !== 'idle' || htr.modelsReady}
    <StatusBar
      stage={htr.stage}
      currentLine={htr.currentLine}
      totalLines={htr.lines.length}
    />
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
  }

  header h1 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .mode-btn {
    margin-left: auto;
    padding: 0.3rem 0.75rem;
    background: var(--bg-tertiary, #333);
    color: var(--text-primary, #fff);
    border: 1px solid var(--border-color, #444);
    border-radius: 6px;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .mode-btn:hover {
    background: var(--bg-primary, #222);
  }

  .mode-btn.active {
    background: rgba(250, 204, 21, 0.15);
    border-color: #facc15;
    color: #facc15;
  }

  .new-btn {
    padding: 0.3rem 0.75rem;
    background: var(--bg-tertiary, #333);
    color: var(--text-primary, #fff);
    border: 1px solid var(--border-color, #444);
    border-radius: 6px;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .new-btn:hover {
    background: var(--bg-primary, #222);
  }

  .badge {
    font-size: 0.7rem;
    padding: 0.15rem 0.5rem;
    border-radius: 9999px;
    font-weight: 500;
  }

  .badge.ready {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
  }

.error-bar {
    padding: 0.5rem 1rem;
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    font-size: 0.85rem;
    flex-shrink: 0;
  }

  .workspace {
    flex: 1;
    overflow: hidden;
    display: flex;
  }

  .upload-container,
  .loading-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 1rem;
    background: rgba(250, 204, 21, 0.08);
    border-bottom: 1px solid rgba(250, 204, 21, 0.2);
    flex-shrink: 0;
  }

  .toolbar-info {
    font-size: 0.8rem;
    color: #facc15;
  }

  .toolbar-btn {
    padding: 0.25rem 0.6rem;
    background: #facc15;
    color: #000;
    border: none;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
  }

  .toolbar-btn:hover {
    background: #fde047;
  }

  .toolbar-btn.secondary {
    background: transparent;
    color: var(--text-muted, #888);
    border: 1px solid var(--border-color, #444);
  }

  .toolbar-btn.secondary:hover {
    background: var(--bg-tertiary, #333);
  }

  .panels {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .left-panel {
    position: relative;
    overflow: hidden;
  }

  .right-panel {
    overflow: hidden;
    border-left: 1px solid var(--border-color);
  }

  .divider {
    width: 5px;
    cursor: col-resize;
    background: transparent;
    transition: background 0.15s;
    flex-shrink: 0;
    touch-action: none;
  }

  .divider:hover,
  .divider.active {
    background: var(--accent-color, #3b82f6);
  }
</style>
