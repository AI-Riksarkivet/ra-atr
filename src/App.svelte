<script lang="ts">
  import { HTRWorkerState } from './lib/worker-state.svelte';
  import UploadPanel from './lib/components/UploadPanel.svelte';
  import DocumentViewer from './lib/components/DocumentViewer.svelte';
  import { onMount } from 'svelte';

  const htr = new HTRWorkerState();
  let imageUrl = $state<string | null>(null);

  onMount(() => {
    htr.loadModels();
    return () => htr.destroy();
  });

  function handleUpload(imageData: ArrayBuffer, previewUrl: string) {
    imageUrl = previewUrl;
    htr.runPipeline(imageData);
  }
</script>

<main>
  <header>
    <h1>Lejonet HTR</h1>
    <span class="status">Stage: {htr.stage} | Models: {htr.modelsReady ? 'ready' : 'loading...'}</span>
  </header>

  {#if htr.error}
    <p class="error">{htr.error}</p>
  {/if}

  <div class="workspace">
    {#if !imageUrl}
      <UploadPanel onUpload={handleUpload} disabled={!htr.modelsReady} />
    {:else}
      <div class="viewer-panel">
        <DocumentViewer {imageUrl} lines={htr.lines} currentLine={htr.currentLine} />
      </div>
    {/if}
  </div>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--border-color, #333);
  }

  header h1 {
    margin: 0;
    font-size: 1.2rem;
  }

  .status {
    font-size: 0.85rem;
    color: var(--text-muted, #888);
  }

  .error {
    color: #ef4444;
    padding: 0.5rem 1rem;
    margin: 0;
  }

  .workspace {
    flex: 1;
    display: flex;
    overflow: hidden;
    padding: 1rem;
  }

  .viewer-panel {
    flex: 1;
    position: relative;
  }
</style>
