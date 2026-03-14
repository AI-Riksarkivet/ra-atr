<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { toggleMode } from 'mode-watcher';
  import { Sun, Moon, Home, Search, FileText, LayoutGrid, Server } from 'lucide-svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import { gpuServerUrl } from '$lib/gpu-client';
  import { page } from '$app/state';

  interface Props {
    catalogOpen?: boolean;
    transcriptionOpen?: boolean;
    onToggleCatalog?: () => void;
    onToggleTranscription?: () => void;
    onDetectLayout?: () => void;
    layoutRunning?: boolean;
  }

  let { catalogOpen, transcriptionOpen, onToggleCatalog, onToggleTranscription, onDetectLayout, layoutRunning }: Props = $props();

  const isViewer = $derived(page.url.pathname === '/viewer');
  let showGpuSettings = $state(false);
  let gpuUrl = $state(gpuServerUrl.get());
  let gpuStatus = $state<'idle' | 'checking' | 'ok' | 'error'>('idle');

  async function checkGpu() {
    const url = gpuUrl.trim();
    if (!url) {
      gpuServerUrl.set('');
      gpuStatus = 'idle';
      return;
    }
    gpuStatus = 'checking';
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        gpuServerUrl.set(url);
        gpuStatus = 'ok';
      } else {
        gpuStatus = 'error';
      }
    } catch {
      gpuStatus = 'error';
    }
  }
</script>

<header class="flex items-center gap-3 border-b border-border bg-card px-4 py-2 shrink-0">
  <h1 class="text-lg font-semibold">Lejonet HTR</h1>

  {#if appState.htr.modelsReady && gpuServerUrl.get()}
    <Badge variant="success">GPU</Badge>
  {:else if appState.htr.modelsReady}
    <Badge variant="success">WASM</Badge>
  {:else if appState.htr.stage === 'loading_models'}
    <Badge variant="outline" class="animate-pulse">Loading...</Badge>
  {/if}

  <div class="ml-auto flex items-center gap-1">
    {#if isViewer}
      <Button variant={catalogOpen ? 'secondary' : 'ghost'} size="icon-sm" onclick={onToggleCatalog} title="Toggle catalog">
        <Search class="size-4" />
      </Button>
      <Button variant={transcriptionOpen ? 'secondary' : 'ghost'} size="icon-sm" onclick={onToggleTranscription} title="Toggle transcriptions">
        <FileText class="size-4" />
      </Button>

      <div class="w-px h-5 bg-border mx-1"></div>

      <Button variant="ghost" size="icon-sm" onclick={onDetectLayout} title="Detect layout" disabled={layoutRunning}>
        {#if layoutRunning}
          <LayoutGrid class="size-4 animate-spin" />
        {:else}
          <LayoutGrid class="size-4" />
        {/if}
      </Button>

      <Button
        variant={appState.selectMode ? 'default' : 'ghost'}
        size="icon-sm"
        onclick={() => {
          appState.selectMode = !appState.selectMode;
          if (!appState.selectMode) appState.selectedLines = new Set();
        }}
        title={appState.selectMode ? 'Switch to pan mode' : 'Switch to select mode'}
      >
        <span class="text-xs">{appState.selectMode ? 'S' : 'P'}</span>
      </Button>

      <Button variant="ghost" size="icon-sm" onclick={() => { appState.activeDocumentId = null; }} title="Home">
        <Home class="size-4" />
      </Button>
    {/if}

    <div class="relative">
      <Button
        variant={gpuServerUrl.get() ? 'secondary' : 'ghost'}
        size="icon-sm"
        onclick={() => showGpuSettings = !showGpuSettings}
        title="GPU server settings"
      >
        <Server class="size-4" />
      </Button>
      {#if showGpuSettings}
        <div class="absolute right-0 top-full mt-1 z-50 rounded-lg border border-border bg-card shadow-lg p-3 w-72">
          <div class="text-xs font-medium mb-2">GPU Inference Server</div>
          <div class="flex gap-1.5">
            <input
              type="text"
              bind:value={gpuUrl}
              placeholder="http://192.168.1.10:8080"
              class="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
              onkeydown={(e) => { if (e.key === 'Enter') checkGpu(); }}
            />
            <button
              class="rounded bg-primary px-2 py-1 text-[0.65rem] text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
              onclick={checkGpu}
            >
              {gpuStatus === 'checking' ? '...' : 'Connect'}
            </button>
          </div>
          {#if gpuStatus === 'ok'}
            <div class="text-[0.65rem] text-green-500 mt-1.5">Connected</div>
          {:else if gpuStatus === 'error'}
            <div class="text-[0.65rem] text-destructive mt-1.5">Failed to connect</div>
          {/if}
          {#if gpuServerUrl.get()}
            <button
              class="text-[0.65rem] text-muted-foreground hover:text-foreground mt-1.5 cursor-pointer"
              onclick={() => { gpuUrl = ''; gpuServerUrl.set(''); gpuStatus = 'idle'; }}
            >Disconnect (use WASM)</button>
          {:else}
            <div class="text-[0.65rem] text-muted-foreground mt-1.5">Using local WASM inference</div>
          {/if}
        </div>
      {/if}
    </div>

    <Button variant="ghost" size="icon-sm" onclick={toggleMode}>
      <Sun class="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon class="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span class="sr-only">Toggle theme</span>
    </Button>
  </div>
</header>
