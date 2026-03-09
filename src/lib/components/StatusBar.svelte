<script lang="ts">
  import type { PipelineStage, ImageDocument } from '$lib/types';

  interface Props {
    stage: PipelineStage;
    documents: ImageDocument[];
    currentWork: { imageId: string; regionId: string } | null;
    activeTranscriptions: number;
    poolSize: number;
  }

  let { stage, documents, currentWork, activeTranscriptions, poolSize }: Props = $props();

  let totalLines = $derived(documents.reduce((sum, d) => sum + d.lines.length, 0));
  let completedLines = $derived(documents.reduce((sum, d) => sum + d.lines.filter(l => l.complete).length, 0));
  let pendingLines = $derived(totalLines - completedLines);

  let currentDocName = $derived(
    currentWork ? documents.find(d => d.id === currentWork.imageId)?.name ?? '' : ''
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
      // Account for parallel workers
      const effectiveRate = avgSecondsPerLine / Math.max(1, poolSize);
      etaSeconds = Math.round(pendingLines * effectiveRate);
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

  {#if stage === 'transcribing' && currentDocName}
    <span class="truncate max-w-[150px]">{currentDocName}</span>
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
