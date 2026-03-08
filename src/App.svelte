<script lang="ts">
  import { HTRWorkerState } from './lib/worker-state.svelte';
  import { onMount } from 'svelte';

  const htr = new HTRWorkerState();

  onMount(() => {
    htr.loadModels();
    return () => htr.destroy();
  });
</script>

<main>
  <h1>Lejonet HTR</h1>
  <p>Stage: {htr.stage}</p>
  <p>Models ready: {htr.modelsReady}</p>
  {#if htr.error}
    <p style="color: red">{htr.error}</p>
  {/if}
</main>
