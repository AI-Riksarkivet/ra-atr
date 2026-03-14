<script lang="ts">
  import { searchCatalog, type CatalogResult } from '$lib/api';

  interface Props {
    onLoad: (referenceCode: string) => void;
  }

  let { onLoad }: Props = $props();

  let query = $state('');
  let digitizedOnly = $state(false);
  let results = $state<CatalogResult[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let debounceTimer: ReturnType<typeof setTimeout>;

  function triggerSearch() {
    clearTimeout(debounceTimer);
    if (!query.trim()) {
      results = [];
      total = 0;
      return;
    }
    debounceTimer = setTimeout(doSearch, 300);
  }

  async function doSearch() {
    if (!query.trim()) return;
    loading = true;
    try {
      const data = await searchCatalog({
        q: query.trim(),
        digitized: digitizedOnly ? true : undefined,
        mode: 'fts',
        limit: 50,
      });
      results = data.results;
      total = data.total;
    } catch {
      results = [];
      total = 0;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    // Re-search when digitizedOnly changes (if we have a query)
    digitizedOnly;
    if (query.trim()) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(doSearch, 100);
    }
  });
</script>

<div class="flex flex-col gap-3">
  <div class="flex gap-2">
    <input
      type="text"
      bind:value={query}
      oninput={triggerSearch}
      placeholder="Search archive catalog..."
      class="flex-1 rounded border border-border bg-background px-2 py-1.5 text-xs font-sans text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
    />
  </div>

  <label class="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
    <input type="checkbox" bind:checked={digitizedOnly} class="accent-primary" />
    Digitized only
  </label>

  {#if loading}
    <p class="text-xs text-muted-foreground animate-pulse">Searching...</p>
  {/if}

  {#if results.length > 0}
    <div class="text-[0.65rem] text-muted-foreground">{total} result{total !== 1 ? 's' : ''}</div>
    <div class="flex flex-col gap-1.5 max-h-[40vh] overflow-y-auto">
      {#each results as r}
        <div class="rounded border border-border px-3 py-2 text-xs {r.digitized ? '' : 'opacity-50'}">
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0">
              <div class="font-semibold truncate">{r.fonds_title || r.reference_code}</div>
              <div class="text-muted-foreground">
                {r.series_title ? `${r.series_title} / ` : ''}vol. {r.volume_id}
                {#if r.date_text}
                  <span class="ml-1">({r.date_text})</span>
                {/if}
              </div>
              {#if r.description}
                <div class="text-muted-foreground/70 mt-0.5 line-clamp-2">{r.description}</div>
              {/if}
            </div>
            {#if r.digitized}
              <button
                class="shrink-0 rounded bg-primary px-2 py-1 text-primary-foreground text-[0.65rem] font-medium hover:bg-primary/90 transition-colors"
                onclick={() => onLoad(r.reference_code)}
              >
                Load
              </button>
            {/if}
          </div>
          <div class="text-[0.6rem] text-muted-foreground/50 mt-1 font-mono truncate">{r.reference_code}</div>
        </div>
      {/each}
    </div>
  {:else if query.trim() && !loading}
    <p class="text-xs text-muted-foreground italic">No results</p>
  {/if}
</div>
