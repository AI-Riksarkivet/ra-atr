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

  let elapsed = $state(0);
  let timer: ReturnType<typeof setInterval> | null = null;
  let startTime = 0;

  $effect(() => {
    if (stage === 'segmenting' || stage === 'transcribing') {
      if (!timer) {
        startTime = Date.now();
        elapsed = 0;
        timer = setInterval(() => {
          elapsed = Math.floor((Date.now() - startTime) / 1000);
        }, 1000);
      }
    } else {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
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

  {#if elapsed > 0 && (stage === 'segmenting' || stage === 'transcribing' || stage === 'done')}
    <span class="ml-auto font-mono">{formatTime(elapsed)}</span>
  {/if}
</div>
