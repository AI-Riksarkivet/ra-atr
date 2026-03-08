<script lang="ts">
  import { HTRWorkerState } from './lib/worker-state.svelte';
  import UploadPanel from './lib/components/UploadPanel.svelte';
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
  <h1>Lejonet HTR</h1>
  <p>Stage: {htr.stage}</p>
  <p>Models ready: {htr.modelsReady}</p>
  {#if htr.error}
    <p style="color: red">{htr.error}</p>
  {/if}

  {#if !imageUrl}
    <UploadPanel onUpload={handleUpload} disabled={!htr.modelsReady} />
  {:else}
    <p>Image loaded. Processing...</p>
  {/if}
</main>
