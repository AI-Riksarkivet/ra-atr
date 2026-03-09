<script lang="ts">
  import { goto } from '$app/navigation';
  import { appState } from '$lib/stores/app-state.svelte';
  import AppHeader from '$lib/components/layout/app-header.svelte';
  import ModelManager from '$lib/components/ModelManager.svelte';
  import UploadPanel from '$lib/components/UploadPanel.svelte';

  function handleUpload(files: { name: string; imageData: ArrayBuffer; previewUrl: string }[]) {
    for (const file of files) {
      const docId = appState.addDocument(file.name, file.previewUrl, file.imageData);
      if (!appState.activeDocumentId) {
        appState.activeDocumentId = docId;
      }
    }
    appState.selectMode = true;
    goto('/viewer');
  }

  function continueWorkspace() {
    goto('/viewer');
  }
</script>

<AppHeader />

<div class="flex flex-1 items-center justify-center overflow-hidden">
  <div class="w-full max-w-lg space-y-6 p-8">
    {#if !appState.htr.cacheChecked}
      <p class="text-center text-muted-foreground">Checking cached models...</p>
    {:else}
      <ModelManager
        modelProgress={appState.htr.modelProgress}
        onLoadModels={() => appState.htr.loadModels()}
        modelsReady={appState.htr.modelsReady}
        autoLoading={appState.htr.stage === 'loading_models'}
      />
    {/if}

    <UploadPanel
      onUpload={handleUpload}
      disabled={!appState.htr.modelsReady}
      poolSize={appState.htr.poolSize}
      onPoolSizeChange={(n) => appState.htr.setPoolSize(n)}
      poolLocked={appState.documents.length > 0}
    />

    {#if appState.documents.length > 0}
      <button
        class="w-full rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
        onclick={continueWorkspace}
      >
        Continue workspace ({appState.documents.length} image{appState.documents.length !== 1 ? 's' : ''})
      </button>
    {/if}
  </div>
</div>
