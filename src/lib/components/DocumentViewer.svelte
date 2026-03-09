<script lang="ts">
  import type { Line, LineGroup, PipelineStage } from '$lib/types';
  import { CanvasController } from '$lib/canvas';
  import { onMount } from 'svelte';

  interface Props {
    imageUrl: string | null;
    lines: Line[];
    currentLine: number;
    hoveredLine: number;
    onHoverLine: (index: number) => void;
    stage: PipelineStage;
    selectedLines: Set<number>;
    onSelectLine: (index: number, additive: boolean) => void;
    onMarqueeSelect: (indices: number[]) => void;
    onRedetectRegion: (x: number, y: number, w: number, h: number) => void;
    groups: LineGroup[];
    selectMode: boolean;
  }

  let { imageUrl, lines, currentLine, hoveredLine, onHoverLine, stage, selectedLines, onSelectLine, onMarqueeSelect, onRedetectRegion, groups, selectMode }: Props = $props();
  let canvasEl: HTMLCanvasElement;
  let controller: CanvasController;
  let img: HTMLImageElement | null = null;

  /** Zoom to fit the bounding box of the given line indices */
  export function zoomIn() { controller?.zoomBy(1.4); controller?.render(); }
  export function zoomOut() { controller?.zoomBy(1 / 1.4); controller?.render(); }
  export function resetView() { controller?.fitToCanvas(); controller?.render(); }

  export function focusLines(indices: number[]) {
    if (!controller || indices.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const idx of indices) {
      const b = lines[idx]?.bbox;
      if (!b) continue;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    if (minX === Infinity) return;
    controller.fitToRect(minX, minY, maxX - minX, maxY - minY);
    controller.render();
  }

  // Marquee state
  let isMarquee = $state(false);
  let marqueeStart = $state({ x: 0, y: 0 });
  let marqueeEnd = $state({ x: 0, y: 0 });

  // Region detection state
  let redetectRegion = $state({ x: 0, y: 0, w: 0, h: 0 });
  let redetecting = $state(false);

  /** Call this when region_lines arrives to clear the loading state */
  export function clearRedetecting() {
    redetecting = false;
    controller?.render();
  }

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

  /** Find all lines whose bbox center falls within a rectangle (in image coords) */
  function linesInRect(x1: number, y1: number, x2: number, y2: number): number[] {
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const result: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const b = lines[i].bbox;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
        result.push(i);
      }
    }
    return result;
  }

  let pointerDownPos = { x: 0, y: 0 };

  // Disable panning when in select mode
  $effect(() => {
    if (controller) {
      controller.panEnabled = !selectMode;
    }
  });

  function onCanvasPointerDown(e: PointerEvent) {
    pointerDownPos = { x: e.clientX, y: e.clientY };

    if (selectMode) {
      // Stop the event from reaching CanvasController's pan handler
      e.stopImmediatePropagation();
      isMarquee = true;
      const imgPt = controller.screenToImage(e.clientX, e.clientY);
      marqueeStart = { ...imgPt };
      marqueeEnd = { ...imgPt };
      canvasEl.setPointerCapture(e.pointerId);
    }
  }

  function onCanvasPointerMove(e: PointerEvent) {
    if (isMarquee) {
      marqueeEnd = controller.screenToImage(e.clientX, e.clientY);
      controller.render();
      return;
    }
    const idx = hitTestLine(e.clientX, e.clientY);
    onHoverLine(idx);
  }

  function onCanvasPointerUp(e: PointerEvent) {
    if (isMarquee) {
      isMarquee = false;
      canvasEl.releasePointerCapture(e.pointerId);
      const indices = linesInRect(marqueeStart.x, marqueeStart.y, marqueeEnd.x, marqueeEnd.y);
      if (indices.length > 0) {
        onMarqueeSelect(indices);
      } else {
        // Empty selection — detect lines in this region
        const minX = Math.min(marqueeStart.x, marqueeEnd.x);
        const minY = Math.min(marqueeStart.y, marqueeEnd.y);
        const w = Math.abs(marqueeEnd.x - marqueeStart.x);
        const h = Math.abs(marqueeEnd.y - marqueeStart.y);
        if (w > 10 && h > 10) {
          redetectRegion = { x: minX, y: minY, w, h };
          onRedetectRegion(minX, minY, w, h);
          redetecting = true;
          controller?.render();
        }
      }
      controller.render();
      return;
    }

    // Only treat as click if pointer didn't move (not a pan)
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    if (dx * dx + dy * dy < 25) {
      const idx = hitTestLine(e.clientX, e.clientY);
      if (idx >= 0) {
        if (selectMode) {
          onSelectLine(idx, e.ctrlKey || e.metaKey);
        } else {
          // Pan mode: zoom to the clicked line
          focusLines([idx]);
        }
      } else if (selectMode) {
        onSelectLine(-1, false);
      }
    }
  }

  function onCanvasDblClick(e: MouseEvent) {
    const idx = hitTestLine(e.clientX, e.clientY);
    if (idx < 0) {
      controller.fitToCanvas();
      controller.render();
    }
  }

  function onCanvasPointerLeave() {
    onHoverLine(-1);
  }

  const GROUP_COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#f97316'];

  function getGroupColor(lineIndex: number): string | null {
    for (let g = 0; g < groups.length; g++) {
      if (groups[g].lineIndices.includes(lineIndex)) {
        return GROUP_COLORS[g % GROUP_COLORS.length];
      }
    }
    return null;
  }

  function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  onMount(() => {
    controller = new CanvasController(canvasEl, {
      onAfterDraw: (ctx, transform) => {
        if (!img) return;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const isCurrent = i === currentLine;
          const isHovered = i === hoveredLine;
          const isSelected = selectedLines.has(i);
          const groupColor = getGroupColor(i);
          const highlight = isCurrent || isHovered;

          if (isSelected) {
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 3 / transform.scale;
            ctx.fillStyle = 'rgba(250, 204, 21, 0.08)';
          } else if (highlight) {
            ctx.strokeStyle = '#ff6b00';
            ctx.lineWidth = 3 / transform.scale;
            ctx.fillStyle = 'rgba(255, 107, 0, 0.05)';
          } else if (groupColor) {
            ctx.strokeStyle = groupColor;
            ctx.lineWidth = 2 / transform.scale;
            ctx.fillStyle = 'transparent';
          } else {
            ctx.strokeStyle = line.complete ? '#22c55e' : '#3b82f6';
            ctx.lineWidth = 1.5 / transform.scale;
            ctx.fillStyle = 'transparent';
          }

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

          // Draw group color dot next to line
          if (groupColor && !isSelected && !highlight) {
            const b = line.bbox;
            const dotX = b.x - 6 / transform.scale;
            const dotY = b.y + b.h / 2;
            ctx.fillStyle = groupColor;
            ctx.beginPath();
            ctx.arc(dotX, dotY, 3 / transform.scale, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Draw marquee rectangle
        if (isMarquee) {
          const x = Math.min(marqueeStart.x, marqueeEnd.x);
          const y = Math.min(marqueeStart.y, marqueeEnd.y);
          const w = Math.abs(marqueeEnd.x - marqueeStart.x);
          const h = Math.abs(marqueeEnd.y - marqueeStart.y);
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 2 / transform.scale;
          ctx.setLineDash([6 / transform.scale, 4 / transform.scale]);
          ctx.fillStyle = 'rgba(250, 204, 21, 0.06)';
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Draw redetecting region with animated dashes
        if (redetecting) {
          const { x, y, w, h } = redetectRegion;
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 2 / transform.scale;
          ctx.setLineDash([8 / transform.scale, 4 / transform.scale]);
          ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([]);

          // Spinner circle in the center of the region
          const spinCx = x + w / 2;
          const spinCy = y + h / 2;
          const r = Math.min(w, h, 60 / transform.scale) * 0.3;
          const angle = (performance.now() / 600) % (Math.PI * 2);
          ctx.beginPath();
          ctx.arc(spinCx, spinCy, r, angle, angle + Math.PI * 1.5);
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 3 / transform.scale;
          ctx.stroke();
        }
      },
    });

    canvasEl.addEventListener('pointerdown', onCanvasPointerDown, true);
    canvasEl.addEventListener('pointermove', onCanvasPointerMove);
    canvasEl.addEventListener('pointerup', onCanvasPointerUp);
    canvasEl.addEventListener('pointerleave', onCanvasPointerLeave);
    canvasEl.addEventListener('dblclick', onCanvasDblClick);

    return () => {
      canvasEl.removeEventListener('pointerdown', onCanvasPointerDown, true);
      canvasEl.removeEventListener('pointermove', onCanvasPointerMove);
      canvasEl.removeEventListener('pointerup', onCanvasPointerUp);
      canvasEl.removeEventListener('pointerleave', onCanvasPointerLeave);
      canvasEl.removeEventListener('dblclick', onCanvasDblClick);
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
    void lines;
    void currentLine;
    void hoveredLine;
    void selectedLines;
    void groups;
    controller?.render();
  });

  // Animate spinner while redetecting
  $effect(() => {
    if (!redetecting) return;
    let animId = 0;
    function tick() {
      controller?.render();
      animId = requestAnimationFrame(tick);
    }
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  });
</script>

<div class="relative h-full w-full">
  <canvas bind:this={canvasEl} class="block h-full w-full touch-none" class:cursor-crosshair={selectMode}></canvas>
  {#if stage === 'segmenting'}
    <div class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/50 pointer-events-none">
      <div class="size-8 animate-spin rounded-full border-3 border-white/20 border-t-white"></div>
      <p class="text-sm text-white">Detecting text lines...</p>
    </div>
  {/if}
</div>
