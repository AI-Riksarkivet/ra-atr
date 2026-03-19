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

<div class="flex flex-col gap-4">
  <div
    class={cn(
      'flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-8 transition-colors cursor-pointer',
      dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30',
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
    <p class="text-base font-medium text-foreground/80">Drop images here or click to upload</p>
    <p class="text-xs text-muted-foreground text-center max-w-xs">Upload scanned pages of handwritten documents, then press <span class="inline-flex items-center align-middle"><svg class="size-3.5 inline" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></span> to run layout detection, line segmentation, and transcription.</p>
    <Button
      variant="outline"
      size="sm"
      onclick={(e) => { e.stopPropagation(); loadDemoImage(); }}
      disabled={disabled || loadingDemo}
    >
      {loadingDemo ? 'Loading...' : 'Try demo image'}
    </Button>
  </div>

</div>
