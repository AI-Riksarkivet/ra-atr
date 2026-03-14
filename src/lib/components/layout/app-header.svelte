<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { toggleMode } from 'mode-watcher';
  import { Sun, Moon, Home, Search, FileText } from 'lucide-svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import { page } from '$app/state';

  interface Props {
    catalogOpen?: boolean;
    transcriptionOpen?: boolean;
    onToggleCatalog?: () => void;
    onToggleTranscription?: () => void;
  }

  let { catalogOpen, transcriptionOpen, onToggleCatalog, onToggleTranscription }: Props = $props();

  const isViewer = $derived(page.url.pathname === '/viewer');
</script>

<header class="flex items-center gap-3 border-b border-border bg-card px-4 py-2 shrink-0">
  <h1 class="text-lg font-semibold">Lejonet HTR</h1>

  {#if appState.htr.modelsReady}
    <Badge variant="success">Ready</Badge>
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

    <Button variant="ghost" size="icon-sm" onclick={toggleMode}>
      <Sun class="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon class="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span class="sr-only">Toggle theme</span>
    </Button>
  </div>
</header>
