<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { resolveVolume, type ImportProgress } from '$lib/riksarkivet';

  interface Props {
    onResolved: (manifestId: string, pages: number[]) => void;
    disabled: boolean;
  }

  let { onResolved, disabled }: Props = $props();
  let refCode = $state('');
  let pageRange = $state('1-20');
  let loading = $state(false);
  let progress = $state<ImportProgress | null>(null);

  function parseRange(range: string): { start: number; end: number } | null {
    const m = range.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) return { start: parseInt(m[1]), end: parseInt(m[2]) };
    const single = range.trim().match(/^(\d+)$/);
    if (single) { const n = parseInt(single[1]); return { start: n, end: n }; }
    return null;
  }

  async function handleImport() {
    if (!refCode.trim() || loading) return;
    const range = parseRange(pageRange);
    if (!range) return;
    loading = true;
    progress = null;
    try {
      const { manifestId, pages } = await resolveVolume(
        refCode.trim(),
        (p) => { progress = p; },
        range,
      );
      onResolved(manifestId, pages);
    } catch {
      // error already in progress state
    } finally {
      loading = false;
    }
  }

  function statusText(p: ImportProgress): string {
    switch (p.stage) {
      case 'resolving': return 'Resolving reference code...';
      case 'manifest': return `Found ${p.manifestId}, loading manifest...`;
      case 'fetching': return `Loading page ${p.currentPage}/${p.totalPages}...`;
      case 'done': return `Loaded ${p.totalPages} pages`;
      case 'error': return p.error ?? 'Error';
    }
  }
</script>

<div class="flex flex-col gap-3">
  <div class="flex gap-2">
    <input
      type="text"
      bind:value={refCode}
      placeholder="Reference code, e.g. SE/RA/420177/02/A I a/3"
      class="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
      disabled={disabled || loading}
      onkeydown={(e) => { if (e.key === 'Enter') handleImport(); }}
    />
    <input
      type="text"
      bind:value={pageRange}
      placeholder="1-20"
      class="w-20 rounded-lg border border-border bg-card px-2 py-2 text-sm text-foreground text-center placeholder:text-muted-foreground outline-none focus:border-primary"
      disabled={disabled || loading}
      onkeydown={(e) => { if (e.key === 'Enter') handleImport(); }}
    />
    <Button
      variant="outline"
      size="sm"
      onclick={handleImport}
      disabled={disabled || loading || !refCode.trim() || !parseRange(pageRange)}
    >
      {loading ? 'Loading...' : 'Load'}
    </Button>
  </div>

  {#if progress}
    <div class="flex items-center gap-2 text-xs text-muted-foreground">
      {#if progress.stage === 'fetching' && progress.totalPages > 0}
        <div class="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            class="h-full bg-primary rounded-full transition-all"
            style="width: {(progress.currentPage / progress.totalPages) * 100}%"
          ></div>
        </div>
      {/if}
      {#if progress.stage === 'error'}
        <span class="text-destructive">{statusText(progress)}</span>
      {:else}
        <span>{statusText(progress)}</span>
      {/if}
    </div>
  {/if}
</div>
