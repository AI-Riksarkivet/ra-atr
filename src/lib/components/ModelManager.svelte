<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Progress } from '$lib/components/ui/progress';

  interface Props {
    modelProgress: Record<string, number>;
    onLoadModels: () => void;
    modelsReady: boolean;
    autoLoading?: boolean;
  }

  let { modelProgress, onLoadModels, modelsReady, autoLoading = false }: Props = $props();

  const models = [
    { key: 'yolo', label: 'YOLO Line Detection', size: '~229 MB' },
    { key: 'trocr-encoder', label: 'TrOCR Encoder', size: '~329 MB' },
    { key: 'trocr-decoder', label: 'TrOCR Decoder', size: '~1.2 GB' },
    { key: 'tokenizer', label: 'Tokenizer', size: '~2 MB' },
  ];

  let loading = $state(false);

  function handleLoad() {
    loading = true;
    onLoadModels();
  }
</script>

<div class="mx-auto max-w-md space-y-6 p-8">
  <div class="space-y-2">
    <h2 class="text-lg font-semibold">{autoLoading ? 'Loading Models' : 'Download Models'}</h2>
    <p class="text-sm text-muted-foreground">
      {autoLoading ? 'Loading cached models...' : 'Models run entirely in your browser. Total download: ~1.8 GB (cached after first load).'}
    </p>
  </div>

  <div class="space-y-3">
    {#each models as model}
      <div class="flex items-center gap-3">
        <span class="flex-1 text-sm">{model.label}</span>
        <span class="min-w-[5rem] text-right font-mono text-xs text-muted-foreground">{model.size}</span>
        {#if loading || modelsReady || autoLoading}
          <Progress value={modelsReady ? 100 : (modelProgress[model.key] ?? 0)} class="w-24" />
        {/if}
      </div>
    {/each}
  </div>

  {#if !loading && !modelsReady && !autoLoading}
    <Button class="w-full" onclick={handleLoad}>Download Models</Button>
  {:else if modelsReady}
    <p class="text-center text-sm text-success">Models cached and ready.</p>
  {/if}
</div>
