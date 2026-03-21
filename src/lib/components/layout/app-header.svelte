<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { toggleMode } from 'mode-watcher';
  import { Sun, Moon, Home, Search, FileText, Server, Download, Dices } from 'lucide-svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import { BACKEND_ENABLED } from '$lib/api';
  import { gpuServerUrl, getGpuName, fetchGpuStatus, type GpuStatus } from '$lib/gpu-client';
  import { DEFAULT_GPU_SERVER } from '$lib/model-config';
  import { exportDocument, type ExportFormat } from '$lib/export';
  import { t, locale, setLocale, type Locale } from '$lib/i18n.svelte';
  import { page } from '$app/state';

  interface Props {
    catalogOpen?: boolean;
    transcriptionOpen?: boolean;
    onToggleCatalog?: () => void;
    onToggleTranscription?: () => void;
    onSearch?: (query: string) => void;
    onRandomVolume?: () => void;
  }

  let { catalogOpen, transcriptionOpen, onToggleCatalog, onToggleTranscription, onSearch, onRandomVolume }: Props = $props();

  let headerSearch = $state('');

  const isViewer = $derived(page.url.pathname === '/viewer');
  let showGpuSettings = $state(false);
  let showExportMenu = $state(false);
  let gpuUrl = $state(gpuServerUrl.get());
  let gpuConnected = $state(!!gpuServerUrl.get());
  let gpuStatus = $state<'idle' | 'checking' | 'ok' | 'error'>('idle');

  let gpuName = $state('');
  let gpuDetails = $state<GpuStatus | null>(null);
  let statusInterval: ReturnType<typeof setInterval>;

  // Poll GPU status when settings panel is open
  $effect(() => {
    if (showGpuSettings && gpuConnected) {
      fetchGpuStatus().then(s => { gpuDetails = s; });
      statusInterval = setInterval(async () => {
        gpuDetails = await fetchGpuStatus();
      }, 5000);
      return () => clearInterval(statusInterval);
    }
    return () => {};
  });

  async function checkGpu() {
    const url = gpuUrl.trim();
    if (!url) {
      gpuServerUrl.set('');
      gpuConnected = false;
      gpuStatus = 'idle';
      gpuName = '';
      return;
    }
    gpuStatus = 'checking';
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        gpuServerUrl.set(url);
        gpuConnected = true;
        gpuStatus = 'ok';
        const data = await res.json();
        gpuName = data.gpu?.name ?? '';
      } else {
        gpuStatus = 'error';
      }
    } catch {
      gpuStatus = 'error';
    }
  }
</script>

<header class="flex items-center gap-3 border-b border-border bg-gradient-to-r from-card to-card/80 px-4 py-2 shrink-0 backdrop-blur-sm">
  {#if isViewer}
    <Button variant="ghost" size="icon-sm" onclick={() => { appState.activeDocumentId = null; }} title={t('toolbar.home')}>
      <Home class="size-4" />
    </Button>
    {#if BACKEND_ENABLED}
      <Button variant={catalogOpen ? 'secondary' : 'ghost'} size="icon-sm" onclick={onToggleCatalog} title={t('toolbar.catalog')}>
        <Search class="size-4" />
      </Button>
      <Button variant="ghost" size="icon-sm" onclick={onRandomVolume} title="Random volume">
        <Dices class="size-4" />
      </Button>
      {#if !catalogOpen}
        <input
          type="text"
          bind:value={headerSearch}
          placeholder={t('toolbar.search')}
          class="w-48 rounded-lg border border-border bg-background/50 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/40 focus:bg-background/80 focus:w-64 focus:shadow-[0_0_0_1px_oklch(0.68_0.16_250_/_0.1)] transition-all duration-300"
          onkeydown={(e) => {
            if (e.key === 'Enter' && headerSearch.trim()) {
              onSearch?.(headerSearch.trim());
              headerSearch = '';
            }
            if (e.key === 'Escape') {
              headerSearch = '';
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      {/if}
    {/if}
  {/if}

  <div class="ml-auto flex items-center gap-1">
    <div class="relative">
      {#if appState.htr.modelsReady && gpuConnected}
        <button class="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-[0.65rem] font-medium text-green-600 dark:text-green-400 cursor-pointer hover:bg-green-500/20 transition-colors" onclick={() => showGpuSettings = !showGpuSettings} title="GPU server settings">
          <Server class="size-3" />GPU{gpuName || getGpuName() ? ` (${gpuName || getGpuName()})` : ''}
        </button>
      {:else if appState.htr.modelsReady}
        <button class="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-[0.65rem] font-medium text-green-600 dark:text-green-400 cursor-pointer hover:bg-green-500/20 transition-colors" onclick={() => showGpuSettings = !showGpuSettings} title="GPU server settings">
          <Server class="size-3" />WASM
        </button>
      {:else if appState.htr.stage === 'loading_models'}
        <button class="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[0.65rem] font-medium text-muted-foreground animate-pulse cursor-pointer hover:bg-muted/50 transition-colors" onclick={() => showGpuSettings = !showGpuSettings} title="GPU server settings">
          <Server class="size-3" />Loading...
        </button>
      {:else}
        <button class="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[0.65rem] font-medium text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors" onclick={() => showGpuSettings = !showGpuSettings} title="GPU server settings">
          <Server class="size-3" />{gpuConnected ? 'GPU' : 'Connect GPU'}
        </button>
      {/if}
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
            <div class="text-[0.65rem] text-green-500 mt-1.5">Connected{gpuName ? ` — ${gpuName}` : ''}</div>
          {:else if gpuStatus === 'error'}
            <div class="text-[0.65rem] text-destructive mt-1.5">Failed to connect</div>
          {/if}
          {#if DEFAULT_GPU_SERVER && !gpuConnected}
            <button
              class="w-full mt-1.5 rounded bg-green-600 px-2 py-1.5 text-[0.65rem] text-white font-medium hover:bg-green-700 transition-colors"
              onclick={() => { gpuUrl = DEFAULT_GPU_SERVER; checkGpu(); }}
            >Connect to GPU server</button>
          {/if}
          {#if gpuConnected}
            <!-- Deployment status -->
            {#if gpuDetails}
              <div class="mt-2 pt-2 border-t border-border space-y-1">
                {#each Object.entries(gpuDetails.deployments) as [name, dep]}
                  <div class="flex items-center gap-2 text-[0.6rem]">
                    <span class="size-1.5 rounded-full {dep.status === 'HEALTHY' ? 'bg-green-500' : dep.status === 'UPDATING' ? 'bg-yellow-500' : 'bg-red-500'}"></span>
                    <span class="text-muted-foreground flex-1">{name}</span>
                    <span class="font-mono text-muted-foreground/60">{dep.status}</span>
                  </div>
                {/each}
                <div class="flex items-center gap-3 text-[0.6rem] text-muted-foreground/60 pt-1">
                  <span>GPU: {gpuDetails.gpu.name}</span>
                  <span>{gpuDetails.cluster.memory_gb}GB</span>
                  <span>{gpuDetails.cluster.cpu_available} CPU</span>
                </div>
              </div>
            {/if}
            <button
              class="text-[0.65rem] text-muted-foreground hover:text-foreground mt-2 cursor-pointer"
              onclick={() => { gpuUrl = ''; gpuServerUrl.set(''); gpuConnected = false; gpuStatus = 'idle'; gpuDetails = null; }}
            >Disconnect (use WASM)</button>
          {:else}
            <div class="text-[0.65rem] text-muted-foreground mt-1.5">Using local WASM inference</div>
          {/if}
        </div>
      {/if}
    </div>

    {#if isViewer}
      <Button variant={transcriptionOpen ? 'secondary' : 'ghost'} size="icon-sm" onclick={onToggleTranscription} title={t('toolbar.transcriptions')}>
        <FileText class="size-4" />
      </Button>

      <div class="relative">
        <Button variant="ghost" size="icon-sm" onclick={() => showExportMenu = !showExportMenu} title={t('export.title')}>
          <Download class="size-4" />
        </Button>
        {#if showExportMenu}
          <div class="absolute right-0 top-full mt-1 z-50 rounded-lg border border-border bg-card shadow-lg p-1 w-40">
            {#each [
              { format: 'alto' as ExportFormat, label: 'ALTO XML' },
              { format: 'page' as ExportFormat, label: 'PAGE XML' },
              { format: 'txt' as ExportFormat, label: 'Plain text' },
              { format: 'json' as ExportFormat, label: 'JSON' },
            ] as item}
              <button
                class="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-muted transition-colors"
                onclick={() => {
                  const doc = appState.activeDocument;
                  if (doc) exportDocument(doc, item.format);
                  showExportMenu = false;
                }}
              >{item.label}</button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <Button variant="ghost" size="icon-sm" onclick={toggleMode}>
      <Sun class="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon class="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span class="sr-only">{t('theme.toggle')}</span>
    </Button>

    <button
      class="px-1.5 py-0.5 rounded text-[0.65rem] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer uppercase"
      onclick={() => setLocale(locale() === 'en' ? 'sv' : 'en')}
      title={locale() === 'en' ? 'Byt till svenska' : 'Switch to English'}
    >{locale()}</button>
  </div>
</header>
