<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';

  interface Props {
    onUpload: (files: { name: string; imageData: ArrayBuffer; previewUrl: string }[]) => void;
    disabled: boolean;
    poolSize: number;
    onPoolSizeChange: (n: number) => void;
    poolLocked: boolean;
  }

  let { onUpload, disabled, poolSize, onPoolSizeChange, poolLocked }: Props = $props();
  let dragOver = $state(false);
  let loadingDemo = $state(false);
  let fileInput: HTMLInputElement;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const results: { name: string; imageData: ArrayBuffer; previewUrl: string }[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const previewUrl = URL.createObjectURL(file);
      const buf = await file.arrayBuffer();
      results.push({ name: file.name, imageData: buf, previewUrl });
    }
    if (results.length > 0) onUpload(results);
  }

  async function loadDemoImage() {
    loadingDemo = true;
    try {
      const res = await fetch('/demo.jpg');
      const buf = await res.arrayBuffer();
      const blob = new Blob([buf], { type: 'image/jpeg' });
      const previewUrl = URL.createObjectURL(blob);
      onUpload([{ name: 'demo.jpg', imageData: buf, previewUrl }]);
    } finally {
      loadingDemo = false;
    }
  }
</script>

<div class="flex flex-col gap-4">
  <div
    class={cn(
      'flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-8 transition-colors cursor-pointer',
      dragOver ? 'border-primary bg-primary/5' : 'border-border',
      disabled && 'opacity-50 pointer-events-none'
    )}
    ondrop={(e) => { e.preventDefault(); dragOver = false; handleFiles(e.dataTransfer?.files ?? null); }}
    ondragover={(e) => { e.preventDefault(); dragOver = true; }}
    ondragleave={() => (dragOver = false)}
    onclick={() => { if (!disabled) fileInput?.click(); }}
    role="button"
    tabindex="0"
  >
    <input
      bind:this={fileInput}
      type="file"
      accept="image/*"
      multiple
      class="hidden"
      onchange={(e) => handleFiles(e.currentTarget.files)}
      {disabled}
    />
    <p class="text-sm text-muted-foreground">Drop images here or click to upload</p>
    <Button
      variant="outline"
      size="sm"
      onclick={(e) => { e.stopPropagation(); loadDemoImage(); }}
      disabled={disabled || loadingDemo}
    >
      {loadingDemo ? 'Loading...' : 'Try demo image'}
    </Button>
  </div>

  <div class="flex items-center justify-between rounded-lg border border-border px-4 py-2.5 {poolLocked ? 'opacity-50' : ''}">
    <label class="text-sm text-muted-foreground" for="pool-size">Transcription workers</label>
    <div class="flex items-center gap-2">
      <input
        id="pool-size"
        type="range"
        min="1"
        max="4"
        value={poolSize}
        oninput={(e) => onPoolSizeChange(parseInt(e.currentTarget.value))}
        class="w-24 accent-primary"
        disabled={poolLocked}
      />
      <span class="text-sm font-mono w-4 text-center">{poolSize}</span>
    </div>
    {#if poolLocked}
      <span class="text-xs text-muted-foreground">reload to change</span>
    {/if}
  </div>
</div>
