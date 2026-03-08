<script lang="ts">
  import { HTRWorkerState } from './lib/worker-state.svelte';
  import UploadPanel from './lib/components/UploadPanel.svelte';
  import DocumentViewer from './lib/components/DocumentViewer.svelte';
  import TranscriptionPanel from './lib/components/TranscriptionPanel.svelte';
  import StatusBar from './lib/components/StatusBar.svelte';
  import ModelManager from './lib/components/ModelManager.svelte';
  import { onMount } from 'svelte';

  let htr = $state(new HTRWorkerState());
  let imageUrl = $state<string | null>(null);
  let dividerX = $state(60); // percentage for left panel
  let isDraggingDivider = $state(false);

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
  </header>

  {#if htr.error}
    <div class="error-bar">{htr.error}</div>
  {/if}

  <div class="workspace">
    {#if !htr.modelsReady}
      <ModelManager
        modelProgress={htr.modelProgress}
        onLoadModels={() => htr.loadModels()}
        modelsReady={htr.modelsReady}
      />
    {:else if !imageUrl}
      <div class="upload-container">
        <UploadPanel onUpload={handleUpload} disabled={!htr.modelsReady} />
      </div>
    {:else}
      <div class="panels">
        <div class="left-panel" style="width: {dividerX}%">
          <DocumentViewer {imageUrl} lines={htr.lines} currentLine={htr.currentLine} />
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

  .upload-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
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
