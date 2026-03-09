<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';

  interface Props {
    onUpload: (files: { name: string; imageData: ArrayBuffer; previewUrl: string }[]) => void;
    disabled: boolean;
  }

  let { onUpload, disabled }: Props = $props();
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
