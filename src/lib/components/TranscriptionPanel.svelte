<script lang="ts">
  import type { Line } from '$lib/types';

  interface Props {
    lines: Line[];
    currentLine: number;
    currentText: string;
  }

  let { lines, currentLine, currentText }: Props = $props();
  let panelEl: HTMLDivElement;

  // Auto-scroll to current line
  $effect(() => {
    if (currentLine >= 0 && panelEl) {
      const el = panelEl.querySelector(`[data-line="${currentLine}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
</script>

<div class="transcription-panel" bind:this={panelEl}>
  {#each lines as line, i}
    <div
      class="line"
      class:current={i === currentLine}
      class:complete={line.complete}
      data-line={i}
    >
      <span class="line-number">{i + 1}</span>
      <span class="line-text">
        {line.text}{#if i === currentLine && !line.complete}<span class="cursor">|</span>{/if}
      </span>
      {#if line.complete}
        <span class="confidence" title="Confidence">{(line.confidence * 100).toFixed(0)}%</span>
      {/if}
    </div>
  {/each}

  {#if lines.length === 0}
    <p class="placeholder">Transcription will appear here...</p>
  {/if}
</div>

<style>
  .transcription-panel {
    overflow-y: auto;
    padding: 0.75rem;
    font-family: 'Georgia', serif;
    font-size: 0.95rem;
    line-height: 1.6;
    height: 100%;
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    transition: background-color 0.2s;
  }

  .line.current {
    background-color: rgba(255, 107, 0, 0.08);
  }

  .line.complete {
    opacity: 1;
  }

  .line-number {
    color: var(--text-muted, #666);
    font-size: 0.75rem;
    min-width: 1.5rem;
    text-align: right;
    font-family: monospace;
    user-select: none;
  }

  .line-text {
    flex: 1;
  }

  .confidence {
    font-size: 0.7rem;
    color: var(--text-muted, #666);
    font-family: monospace;
  }

  .cursor {
    animation: blink 0.7s step-end infinite;
    color: #ff6b00;
  }

  @keyframes blink {
    50% { opacity: 0; }
  }

  .placeholder {
    color: var(--text-muted, #666);
    font-style: italic;
    text-align: center;
    margin-top: 2rem;
  }
</style>
