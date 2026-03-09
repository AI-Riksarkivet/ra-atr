<script lang="ts">
  import type { PipelineStage, ImageDocument } from '$lib/types';

  interface Props {
    stage: PipelineStage;
    documents: ImageDocument[];
    activeImageIds: Set<string>;
    activeTranscriptions: number;
    poolSize: number;
  }

  let { stage, documents, activeImageIds, activeTranscriptions, poolSize }: Props = $props();

  let totalLines = $derived(documents.reduce((sum, d) => sum + d.lines.length, 0));
  let completedLines = $derived(documents.reduce((sum, d) => sum + d.lines.filter(l => l.complete).length, 0));
  let pendingLines = $derived(totalLines - completedLines);

  let activeDocNames = $derived(
    documents.filter(d => activeImageIds.has(d.id)).map(d => d.name)
  );

  const stageLabels: Record<PipelineStage, string> = {
    idle: 'Ready',
    loading_models: 'Loading models...',
    segmenting: 'Detecting lines...',
    transcribing: 'Transcribing...',
    done: 'Done',
  };

  // ETA tracking: measure time per completed line
  let lastCompletedCount = 0;
  let lastCompletedTime = 0;
  let avgSecondsPerLine = $state(0);
  let etaSeconds = $state(0);

  // Reset ETA when transcription starts
  $effect(() => {
    if (stage === 'transcribing' && lastCompletedTime === 0) {
      lastCompletedCount = completedLines;
      lastCompletedTime = Date.now();
      avgSecondsPerLine = 0;
      etaSeconds = 0;
    } else if (stage === 'idle' || stage === 'done') {
      lastCompletedTime = 0;
      etaSeconds = 0;
    }
  });

  // Update ETA when completed lines changes
  $effect(() => {
    const now = Date.now();
    const newlyDone = completedLines - lastCompletedCount;
    if (newlyDone > 0 && lastCompletedTime > 0) {
      const dt = (now - lastCompletedTime) / 1000;
      const secPerLine = dt / newlyDone;
      // EMA with alpha=0.3 for smoothing, bootstrap on first measurement
      if (avgSecondsPerLine === 0) {
        avgSecondsPerLine = secPerLine;
      } else {
        avgSecondsPerLine = 0.3 * secPerLine + 0.7 * avgSecondsPerLine;
      }
      // avgSecondsPerLine already reflects parallel throughput (observed rate)
      etaSeconds = Math.round(pendingLines * avgSecondsPerLine);
    }
    lastCompletedCount = completedLines;
    lastCompletedTime = now;
  });

  function formatTime(s: number): string {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  }
</script>

<div class="flex items-center gap-4 border-t border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
  <span class="font-medium">{stageLabels[stage]}</span>

  {#if stage === 'transcribing' && activeDocNames.length > 0}
    <span class="truncate max-w-[200px]">{activeDocNames.join(', ')}</span>
  {/if}

  {#if totalLines > 0}
    <span class="font-mono">{completedLines}/{totalLines} lines</span>
    {#if activeTranscriptions > 0}
      <span class="text-orange-500">{activeTranscriptions} in-flight</span>
    {:else if pendingLines > 0 && stage === 'transcribing'}
      <span class="text-orange-500">{pendingLines} pending</span>
    {/if}
  {/if}

  <span>{poolSize} worker{poolSize !== 1 ? 's' : ''}</span>

  {#if documents.length > 1}
    <span>{documents.length} images</span>
  {/if}

  {#if etaSeconds > 0 && pendingLines > 0 && stage === 'transcribing'}
    <span class="ml-auto font-mono">~{formatTime(etaSeconds)} left</span>
  {/if}
</div>
