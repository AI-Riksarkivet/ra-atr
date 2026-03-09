<script lang="ts">
  import type { BBox } from '$lib/types';
  import { tick } from 'svelte';

  interface Props {
    imageUrl: string | null;
    bbox: BBox | null;
  }

  let { imageUrl, bbox }: Props = $props();
  let canvasEl: HTMLCanvasElement;
  let containerEl: HTMLDivElement;
  let img: HTMLImageElement | null = $state(null);
  let collapsed = $state(false);
  let height = $state(80);
  let isDragging = $state(false);

  $effect(() => {
    if (!imageUrl) { img = null; return; }
    const newImg = new Image();
    newImg.onload = () => { img = newImg; };
    newImg.src = imageUrl;
  });

  $effect(() => {
    const currentBbox = bbox;
    const currentImg = img;
    if (!currentBbox || !currentImg || collapsed) return;

    tick().then(() => {
      if (!canvasEl || !containerEl) return;
      const ctx = canvasEl.getContext('2d');
      if (!ctx) return;

      const pad = 12;
      const sx = Math.max(0, currentBbox.x - pad);
      const sy = Math.max(0, currentBbox.y - pad);
      const sw = Math.min(currentImg.width - sx, currentBbox.w + pad * 2);
      const sh = Math.min(currentImg.height - sy, currentBbox.h + pad * 2);

      const displayW = containerEl.clientWidth;
      const scale = Math.min(displayW / sw, height / sh);
      const drawW = Math.round(sw * scale);
      const drawH = Math.round(sh * scale);

      canvasEl.width = displayW;
      canvasEl.height = height;

      ctx.clearRect(0, 0, displayW, height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const offsetX = Math.round((displayW - drawW) / 2);
      const offsetY = Math.round((height - drawH) / 2);
      ctx.drawImage(currentImg, sx, sy, sw, sh, offsetX, offsetY, drawW, drawH);
    });
  });

  function onResizePointerDown(e: PointerEvent) {
    isDragging = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onResizePointerMove(e: PointerEvent) {
    if (!isDragging) return;
    height = Math.max(40, Math.min(300, height - e.movementY));
  }
  function onResizePointerUp(e: PointerEvent) {
    isDragging = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }
</script>

<div class="border-t border-border bg-card shrink-0">
  <!-- Resize handle -->
  <div
    class="h-[5px] cursor-row-resize touch-none transition-colors hover:bg-primary"
    class:bg-primary={isDragging}
    onpointerdown={onResizePointerDown}
    onpointermove={onResizePointerMove}
    onpointerup={onResizePointerUp}
    role="separator"
  ></div>
  <div class="flex items-center gap-2 px-3 py-0.5">
    <button
      class="text-[0.65rem] text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer p-0 font-sans"
      onclick={() => collapsed = !collapsed}
    >{collapsed ? '\u25B6' : '\u25BC'}</button>
    <span class="text-xs text-muted-foreground select-none">Line preview</span>
  </div>
  {#if !collapsed}
    <div class="w-full px-1 pb-1" bind:this={containerEl} style="height: {height}px">
      {#if bbox && img}
        <canvas bind:this={canvasEl} class="block w-full h-full rounded"></canvas>
      {:else}
        <div class="flex items-center justify-center h-full text-xs text-muted-foreground italic">Hover a line to preview</div>
      {/if}
    </div>
  {/if}
</div>
