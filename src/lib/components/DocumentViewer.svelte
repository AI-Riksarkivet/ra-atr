<script lang="ts">
  import type { Line } from '$lib/types';
  import { CanvasController } from '$lib/canvas';
  import { onMount } from 'svelte';

  interface Props {
    imageUrl: string | null;
    lines: Line[];
    currentLine: number;
    hoveredLine: number;
    onHoverLine: (index: number) => void;
  }

  let { imageUrl, lines, currentLine, hoveredLine, onHoverLine }: Props = $props();
  let canvasEl: HTMLCanvasElement;
  let controller: CanvasController;
  let img: HTMLImageElement | null = null;

  function pointInPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function hitTestLine(clientX: number, clientY: number): number {
    if (!controller || lines.length === 0) return -1;
    const pt = controller.screenToImage(clientX, clientY);
    for (let i = 0; i < lines.length; i++) {
      const poly = lines[i].bbox.polygon;
      if (poly && poly.length >= 3) {
        if (pointInPolygon(pt.x, pt.y, poly)) return i;
      } else {
        const b = lines[i].bbox;
        if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) return i;
      }
    }
    return -1;
  }

  function onCanvasPointerMove(e: PointerEvent) {
    const idx = hitTestLine(e.clientX, e.clientY);
    onHoverLine(idx);
  }

  function onCanvasPointerLeave() {
    onHoverLine(-1);
  }

  onMount(() => {
    controller = new CanvasController(canvasEl, {
      onAfterDraw: (ctx, transform) => {
        if (!img) return;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const isCurrent = i === currentLine;
          const isHovered = i === hoveredLine;
          const highlight = isCurrent || isHovered;
          ctx.strokeStyle = highlight ? '#ff6b00' : line.complete ? '#22c55e' : '#3b82f6';
          ctx.lineWidth = (highlight ? 3 : 1.5) / transform.scale;
          ctx.fillStyle = highlight ? 'rgba(255, 107, 0, 0.1)' : 'transparent';
          ctx.beginPath();
          const poly = line.bbox.polygon;
          if (poly && poly.length >= 3) {
            ctx.moveTo(poly[0].x, poly[0].y);
            for (let j = 1; j < poly.length; j++) {
              ctx.lineTo(poly[j].x, poly[j].y);
            }
            ctx.closePath();
          } else {
            ctx.rect(line.bbox.x, line.bbox.y, line.bbox.w, line.bbox.h);
          }
          ctx.fill();
          ctx.stroke();
        }
      },
    });

    canvasEl.addEventListener('pointermove', onCanvasPointerMove);
    canvasEl.addEventListener('pointerleave', onCanvasPointerLeave);

    return () => {
      canvasEl.removeEventListener('pointermove', onCanvasPointerMove);
      canvasEl.removeEventListener('pointerleave', onCanvasPointerLeave);
      controller.destroy();
    };
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
    // Trigger re-render when lines, currentLine, or hoveredLine changes
    void lines;
    void currentLine;
    void hoveredLine;
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
