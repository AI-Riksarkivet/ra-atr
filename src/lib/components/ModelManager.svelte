<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Progress } from '$lib/components/ui/progress';
  import { Scan, PenLine, SplitSquareHorizontal, Type, FileKey } from 'lucide-svelte';
  import { t } from '$lib/i18n.svelte';
  import { getQuantization, setQuantization, type ModelQuantization } from '$lib/model-config';

  interface Props {
    modelProgress: Record<string, number>;
    onLoadModels: () => void;
    modelsReady: boolean;
    autoLoading?: boolean;
    error?: string | null;
    onDismissError?: () => void;
  }

  let { modelProgress, onLoadModels, modelsReady, autoLoading = false, error = null, onDismissError }: Props = $props();

  let loading = $state(false);
  let quantization = $state<ModelQuantization>(getQuantization());

  const fp32Models = [
    { key: 'layout', labelKey: 'model.layout', descKey: 'model.layout.desc', size: '97 MB', icon: Scan },
    { key: 'yolo', labelKey: 'model.yolo', descKey: 'model.yolo.desc', size: '229 MB', icon: SplitSquareHorizontal },
    { key: 'trocr-encoder', labelKey: 'model.encoder', descKey: 'model.encoder.desc', size: '329 MB', icon: FileKey },
    { key: 'trocr-decoder', labelKey: 'model.decoder', descKey: 'model.decoder.desc', size: '1.2 GB', icon: PenLine },
    { key: 'tokenizer', labelKey: 'model.tokenizer', descKey: 'model.tokenizer.desc', size: '2 MB', icon: Type },
  ];

  const int8Models = [
    { key: 'layout', labelKey: 'model.layout', descKey: 'model.layout.desc', size: '97 MB', icon: Scan },
    { key: 'yolo', labelKey: 'model.yolo', descKey: 'model.yolo.desc', size: '59 MB', icon: SplitSquareHorizontal },
    { key: 'trocr-encoder', labelKey: 'model.encoder', descKey: 'model.encoder.desc', size: '85 MB', icon: FileKey },
    { key: 'trocr-decoder', labelKey: 'model.decoder', descKey: 'model.decoder.desc', size: '1.2 GB', icon: PenLine },
    { key: 'tokenizer', labelKey: 'model.tokenizer', descKey: 'model.tokenizer.desc', size: '2 MB', icon: Type },
  ];

  const models = $derived(quantization === 'int8' ? int8Models : fp32Models);
  const totalSize = $derived(quantization === 'int8' ? '~1.4 GB' : '~1.8 GB');

  $effect(() => { if (error) loading = false; });

  const is401 = $derived(error?.includes('401') ?? false);
  const isActive = $derived(loading || autoLoading);

  const overallProgress = $derived(() => {
    if (modelsReady) return 100;
    if (!isActive) return 0;
    const values = models.map(m => modelProgress[m.key] ?? 0);
    return Math.round(values.reduce((a, b) => a + b, 0) / models.length);
  });

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
  <!-- Title and description -->
  <div class="space-y-3 text-center">
    <h1 class="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">{t('app.title')}</h1>
    <p class="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
      {t('app.description')}
    </p>
  </div>

  <!-- Model card -->
  <div class="relative rounded-xl bg-card/50 backdrop-blur-sm p-5 space-y-4 {isActive && !modelsReady ? 'border-glow' : 'border border-border/50'}">
    <div class="flex items-center justify-between">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {#if modelsReady}
          {t('models.ready')}
        {:else if isActive}
          {t('models.downloading')} — {overallProgress()}%
        {:else}
          {t('models.pipeline')}
        {/if}
      </h3>
      {#if isActive && !modelsReady}
        <span class="text-xs text-muted-foreground/60 font-mono">{totalSize}</span>
      {/if}
    </div>

    <!-- Overall progress bar (only during loading) -->
    {#if isActive && !modelsReady}
      <div class="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          class="h-full rounded-full bg-primary transition-all duration-500 progress-shimmer"
          style="width: {overallProgress()}%"
        ></div>
      </div>
    {/if}

    <!-- Model list -->
    <div class="space-y-2">
      {#each models as model}
        {@const pct = modelProgress[model.key] ?? 0}
        {@const done = modelsReady || pct >= 100}
        <div class="flex items-center gap-3 py-1.5 {done ? 'opacity-60' : ''}">
          <div class="size-7 rounded-lg {done ? 'bg-success/10 text-success' : isActive && pct > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'} flex items-center justify-center transition-colors">
            <model.icon class="size-3.5" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium {done ? 'text-muted-foreground' : ''}">{t(model.labelKey)}</span>
              <span class="text-[0.65rem] text-muted-foreground/60 font-mono">{model.size}</span>
            </div>
            {#if isActive && !done}
              <div class="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                <div class="h-full rounded-full bg-primary transition-all duration-300" style="width: {pct}%"></div>
              </div>
            {:else if !isActive && !done}
              <p class="text-[0.65rem] text-muted-foreground/50">{t(model.descKey)}</p>
            {:else}
              <p class="text-[0.65rem] text-success/70">{t('transcription.ready')}</p>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Actions -->
  {#if error}
    <div class="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-2">
      <p class="text-sm font-medium text-destructive">{t('models.failed')}</p>
      <p class="text-xs text-muted-foreground break-all">{error}</p>
      {#if is401}
        <p class="text-xs text-muted-foreground">Set your HuggingFace token in the browser console:<br><code class="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">sessionStorage.setItem('hf_token', 'hf_...')</code></p>
      {/if}
      <Button variant="outline" size="sm" onclick={handleRetry}>{t('models.retry')}</Button>
    </div>
  {:else if !loading && !modelsReady && !autoLoading}
    <div class="flex items-center justify-center gap-1 rounded-lg bg-muted/50 p-1">
      <button
        class="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors {quantization === 'fp32' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => { quantization = 'fp32'; setQuantization('fp32'); }}
      >
        Full (1.8 GB)
      </button>
      <button
        class="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors {quantization === 'int8' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => { quantization = 'int8'; setQuantization('int8'); }}
      >
        Lite (530 MB)
      </button>
    </div>
    <Button class="w-full h-11 text-sm font-medium btn-glow rounded-xl" onclick={handleLoad}>{t('models.download')}</Button>
    <p class="text-center text-[0.65rem] text-muted-foreground/50">{t('models.cached')}</p>
  {/if}
</div>

<style>
  .border-glow {
    --border-width: 1px;
    --glow-size: 80px;
    border: var(--border-width) solid transparent;
    background-clip: padding-box;
    position: relative;
  }
  .border-glow::before {
    content: '';
    position: absolute;
    inset: calc(var(--border-width) * -1);
    border-radius: inherit;
    background: conic-gradient(
      from var(--glow-angle, 0deg),
      transparent 0%,
      transparent 25%,
      hsl(var(--primary)) 35%,
      hsl(var(--primary) / 0.6) 45%,
      transparent 55%,
      transparent 100%
    );
    z-index: -1;
    animation: border-spin 3s linear infinite;
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask-composite: exclude;
    padding: var(--border-width);
  }
  .border-glow::after {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: inherit;
    background: conic-gradient(
      from var(--glow-angle, 0deg),
      transparent 0%,
      transparent 30%,
      hsl(var(--primary) / 0.15) 38%,
      transparent 46%,
      transparent 100%
    );
    z-index: -2;
    animation: border-spin 3s linear infinite;
    filter: blur(8px);
  }
  @property --glow-angle {
    syntax: '<angle>';
    initial-value: 0deg;
    inherits: false;
  }
  @keyframes border-spin {
    to { --glow-angle: 360deg; }
  }
</style>
