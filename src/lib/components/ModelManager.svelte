<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Progress } from '$lib/components/ui/progress';

  interface Props {
    modelProgress: Record<string, number>;
    onLoadModels: () => void;
    modelsReady: boolean;
    autoLoading?: boolean;
    error?: string | null;
    onDismissError?: () => void;
  }

  let { modelProgress, onLoadModels, modelsReady, autoLoading = false, error = null, onDismissError }: Props = $props();

  const models = [
    { key: 'layout', label: 'RTMDet Layout', size: '~97 MB' },
    { key: 'yolo', label: 'YOLO Line Detection', size: '~229 MB' },
    { key: 'trocr-encoder', label: 'TrOCR Encoder', size: '~329 MB' },
    { key: 'trocr-decoder', label: 'TrOCR Decoder', size: '~1.2 GB' },
    { key: 'tokenizer', label: 'Tokenizer', size: '~2 MB' },
  ];

  let loading = $state(false);

  // Reset loading state when an error arrives
  $effect(() => { if (error) loading = false; });

  const is401 = $derived(error?.includes('401') ?? false);

  function handleLoad() {
    loading = true;
    onDismissError?.();
    onLoadModels();
  }

  function handleRetry() {
    loading = true;
    onDismissError?.();
    onLoadModels();
  }
</script>

<div class="mx-auto max-w-md space-y-6 p-8">
  <div class="space-y-2">
    <h2 class="text-2xl font-bold tracking-tight">Lejonet HTR</h2>
    <p class="text-sm text-muted-foreground">
      Transcribe handwritten Swedish historical documents directly in your browser. All inference runs locally — no data leaves your device.
    </p>
  </div>

  <div class="space-y-2">
    <h3 class="text-sm font-semibold">{autoLoading ? 'Loading Models' : 'Download Models'}</h3>
    <p class="text-xs text-muted-foreground">
      {autoLoading ? 'Loading cached models...' : 'HTR models run entirely in your browser using ONNX Runtime. Total download: ~1.8 GB (cached after first load).'}
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

  {#if error}
    <div class="rounded-md border border-destructive/50 bg-destructive/10 p-3 space-y-2">
      <p class="text-sm font-medium text-destructive">Download failed</p>
      <p class="text-xs text-muted-foreground break-all">{error}</p>
      {#if is401}
        <p class="text-xs text-muted-foreground">Set your HuggingFace token: open browser console and run<br><code class="text-xs bg-muted px-1 rounded">sessionStorage.setItem('hf_token', 'hf_...')</code></p>
      {/if}
      <Button variant="outline" size="sm" onclick={handleRetry}>Retry</Button>
    </div>
  {:else if !loading && !modelsReady && !autoLoading}
    <Button class="w-full" onclick={handleLoad}>Download Models</Button>
  {/if}
</div>
