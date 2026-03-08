<script lang="ts">
  import type { Line } from '$lib/types';
  import { CanvasController } from '$lib/canvas';
  import { onMount } from 'svelte';

  interface Props {
    imageUrl: string | null;
    lines: Line[];
    currentLine: number;
  }

  let { imageUrl, lines, currentLine }: Props = $props();
  let canvasEl: HTMLCanvasElement;
  let controller: CanvasController;
  let img: HTMLImageElement | null = null;

  onMount(() => {
    controller = new CanvasController(canvasEl, {
      onAfterDraw: (ctx, transform) => {
        if (!img) return;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const isCurrent = i === currentLine;
          ctx.strokeStyle = isCurrent ? '#ff6b00' : line.complete ? '#22c55e' : '#3b82f6';
          ctx.lineWidth = (isCurrent ? 3 : 1.5) / transform.scale;
          ctx.fillStyle = isCurrent ? 'rgba(255, 107, 0, 0.1)' : 'transparent';
          ctx.beginPath();
          ctx.rect(line.bbox.x, line.bbox.y, line.bbox.w, line.bbox.h);
          ctx.fill();
          ctx.stroke();
        }
      },
    });

    return () => controller.destroy();
  });

  $effect(() => {
    if (imageUrl) {
      const newImg = new Image();
      newImg.onload = () => {
        img = newImg;
        controller.setImage(newImg);
      };
      newImg.src = imageUrl;
    }
  });

  $effect(() => {
    // Trigger re-render when lines or currentLine changes
    void lines;
    void currentLine;
    controller?.render();
  });
</script>

<canvas bind:this={canvasEl} class="document-canvas"></canvas>

<style>
  .document-canvas {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
  }
</style>
