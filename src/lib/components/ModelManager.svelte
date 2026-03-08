<script lang="ts">
  interface Props {
    modelProgress: Record<string, number>;
    onLoadModels: () => void;
    modelsReady: boolean;
  }

  let { modelProgress, onLoadModels, modelsReady }: Props = $props();

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

<div class="model-manager">
  <h2>Download Models</h2>
  <p class="info">Models run entirely in your browser. Total download: ~1.8 GB (cached after first load).</p>

  <div class="model-list">
    {#each models as model}
      <div class="model-row">
        <span class="model-name">{model.label}</span>
        <span class="model-size">{model.size}</span>
        {#if loading || modelsReady}
          <div class="progress-bar">
            <div
              class="progress-fill"
              class:complete={modelProgress[model.key] === 100 || modelsReady}
              style="width: {modelsReady ? 100 : (modelProgress[model.key] ?? 0)}%"
            ></div>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  {#if !loading && !modelsReady}
    <button class="load-btn" onclick={handleLoad}>Download Models</button>
  {:else if modelsReady}
    <p class="ready">Models cached and ready.</p>
  {/if}
</div>

<style>
  .model-manager {
    max-width: 480px;
    margin: 0 auto;
    padding: 2rem;
  }

  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }

  .info {
    color: var(--text-muted, #888);
    font-size: 0.85rem;
    margin-bottom: 1.5rem;
  }

  .model-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .model-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .model-name {
    flex: 1;
    font-size: 0.9rem;
  }

  .model-size {
    font-size: 0.75rem;
    color: var(--text-muted, #888);
    font-family: monospace;
    min-width: 5rem;
    text-align: right;
  }

  .progress-bar {
    width: 100px;
    height: 6px;
    background: var(--bg-tertiary, #333);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #3b82f6;
    border-radius: 3px;
    transition: width 0.3s;
  }

  .progress-fill.complete {
    background: #22c55e;
  }

  .load-btn {
    display: block;
    width: 100%;
    padding: 0.75rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 0.95rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .load-btn:hover {
    background: #2563eb;
  }

  .ready {
    color: #22c55e;
    text-align: center;
    font-size: 0.9rem;
  }
</style>
