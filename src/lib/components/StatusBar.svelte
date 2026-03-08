<script lang="ts">
  import type { PipelineStage } from '$lib/types';

  interface Props {
    stage: PipelineStage;
    currentLine: number;
    totalLines: number;
  }

  let { stage, currentLine, totalLines }: Props = $props();

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

<div class="status-bar">
  <span class="stage">{stageLabels[stage]}</span>
  {#if stage === 'transcribing' && totalLines > 0}
    <span class="progress">Line {currentLine + 1} / {totalLines}</span>
  {/if}
  {#if elapsed > 0 && (stage === 'segmenting' || stage === 'transcribing' || stage === 'done')}
    <span class="elapsed">{formatTime(elapsed)}</span>
  {/if}
</div>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.35rem 1rem;
    font-size: 0.8rem;
    border-top: 1px solid var(--border-color, #333);
    color: var(--text-muted, #888);
    background: var(--bg-secondary, #1a1a1a);
  }

  .stage {
    font-weight: 500;
  }

  .progress {
    font-family: monospace;
  }

  .elapsed {
    margin-left: auto;
    font-family: monospace;
  }
</style>
