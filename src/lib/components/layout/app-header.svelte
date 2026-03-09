<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { toggleMode } from 'mode-watcher';
  import { Sun, Moon, Plus, Minus, RotateCcw } from 'lucide-svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import { page } from '$app/state';

  interface Props {
    onZoomIn?: () => void;
    onZoomOut?: () => void;
    onResetView?: () => void;
    onNewImage?: () => void;
  }

  let { onZoomIn, onZoomOut, onResetView, onNewImage }: Props = $props();

  const isViewer = $derived(page.url.pathname === '/viewer');
</script>

<header class="flex items-center gap-3 border-b border-border bg-card px-4 py-2 shrink-0">
  <h1 class="text-lg font-semibold">Lejonet HTR</h1>

  {#if appState.htr.modelsReady}
    <Badge variant="success">Ready</Badge>
  {:else if appState.htr.stage === 'loading_models'}
    <Badge variant="outline" class="animate-pulse">Loading...</Badge>
  {/if}

  <div class="ml-auto flex items-center gap-2">
    {#if isViewer}
      <Button
        variant={appState.selectMode ? 'default' : 'outline'}
        size="sm"
        onclick={() => {
          appState.selectMode = !appState.selectMode;
          if (!appState.selectMode) appState.selectedLines = new Set();
        }}
      >
        {appState.selectMode ? 'Pan mode' : 'Select'}
      </Button>

      <div class="flex">
        <Button variant="outline" size="icon-sm" onclick={onZoomIn}><Plus class="size-4" /></Button>
        <Button variant="outline" size="icon-sm" onclick={onZoomOut}><Minus class="size-4" /></Button>
        <Button variant="outline" size="icon-sm" onclick={onResetView}><RotateCcw class="size-4" /></Button>
      </div>

      <Button variant="outline" size="sm" onclick={onNewImage}>Add images</Button>
    {/if}

    <Button variant="ghost" size="icon-sm" onclick={toggleMode}>
      <Sun class="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon class="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span class="sr-only">Toggle theme</span>
    </Button>
  </div>
</header>
