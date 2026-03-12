<script lang="ts">
  import { goto } from '$app/navigation';
  import { appState } from '$lib/stores/app-state.svelte';
  import AppHeader from '$lib/components/layout/app-header.svelte';
  import ModelManager from '$lib/components/ModelManager.svelte';
  import UploadPanel from '$lib/components/UploadPanel.svelte';
  import RiksarkivetImport from '$lib/components/RiksarkivetImport.svelte';

  let videoEl = $state<HTMLVideoElement>();
  let videoStarted = false;

  $effect(() => {
    if (appState.htr.modelsReady && videoEl && !videoStarted) {
      videoStarted = true;
      videoEl.play();
    }
  });

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

  function handleRiksarkivetResolved(manifestId: string, pages: number[]) {
    for (const page of pages) {
      const padded = String(page).padStart(5, '0');
      const docId = appState.addPlaceholderDocument(
        `${manifestId}_${padded}.jpg`, manifestId, page
      );
      if (!appState.activeDocumentId) {
        appState.activeDocumentId = docId;
        appState.loadDocumentImage(docId);
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

<div class="relative flex flex-1 items-center justify-center overflow-hidden">
  <video bind:this={videoEl} class="absolute inset-0 w-full h-full object-cover opacity-15 pointer-events-none" src="/flying-papers.mp4" loop muted playsinline></video>
  <div class="relative w-full max-w-lg space-y-6 p-8">
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

    <div class="text-center text-xs text-muted-foreground uppercase tracking-wide">Riksarkivet</div>
    <RiksarkivetImport
      onResolved={handleRiksarkivetResolved}
      disabled={!appState.htr.modelsReady}
    />

    <div class="flex items-center gap-3 text-xs text-muted-foreground">
      <div class="flex-1 border-t border-border"></div>
      <span>or upload from disk</span>
      <div class="flex-1 border-t border-border"></div>
    </div>

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
