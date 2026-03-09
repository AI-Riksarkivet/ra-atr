<script lang="ts">
  import { goto } from '$app/navigation';
  import { appState } from '$lib/stores/app-state.svelte';
  import AppHeader from '$lib/components/layout/app-header.svelte';
  import ModelManager from '$lib/components/ModelManager.svelte';
  import UploadPanel from '$lib/components/UploadPanel.svelte';

  function handleUpload(files: { name: string; imageData: ArrayBuffer; previewUrl: string }[]) {
    for (const file of files) {
      const docId = appState.addDocument(file.name, file.previewUrl, file.imageData);
      // Set first uploaded as active
      if (!appState.activeDocumentId) {
        appState.activeDocumentId = docId;
      }
    }
    appState.selectMode = true;
    goto('/viewer');
  }
</script>

<AppHeader />

<div class="flex flex-1 items-center justify-center overflow-hidden">
  {#if !appState.htr.modelsReady && !appState.htr.cacheChecked}
    <p class="text-muted-foreground">Checking cached models...</p>
  {:else if !appState.htr.modelsReady}
    <ModelManager
      modelProgress={appState.htr.modelProgress}
      onLoadModels={() => appState.htr.loadModels()}
      modelsReady={appState.htr.modelsReady}
      autoLoading={appState.htr.stage === 'loading_models'}
    />
  {:else}
    <div class="w-full max-w-lg p-8">
      <UploadPanel onUpload={handleUpload} disabled={!appState.htr.modelsReady} />
    </div>
  {/if}
</div>
