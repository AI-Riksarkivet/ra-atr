<script lang="ts">
	import type { Line, LineGroup, PipelineStage } from '$lib/types';
	import { CanvasController } from '$lib/canvas';
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n.svelte';

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
		onRedetectRegion: (x: number, y: number, w: number, h: number) => string;
		groups: LineGroup[];
		selectMode: boolean;
		showTextOverlay: boolean;
		showBoxes?: boolean;
		imageFilter?: string;
	}

	let {
		imageUrl,
		lines,
		currentLine,
		hoveredLine,
		onHoverLine,
		stage,
		selectedLines,
		onSelectLine,
		onMarqueeSelect,
		onRedetectRegion,
		groups,
		selectMode,
		showTextOverlay,
		showBoxes = true,
		imageFilter = '',
	}: Props = $props();
	let canvasEl: HTMLCanvasElement;
	let controller: CanvasController;
	let img: HTMLImageElement | null = null;

	/** Zoom to fit the bounding box of the given line indices */
	export function zoomIn() {
		controller?.zoomBy(1.4);
		controller?.render();
	}
	export function zoomOut() {
		controller?.zoomBy(1 / 1.4);
		controller?.render();
	}
	export function resetView() {
		controller?.fitToCanvas();
		controller?.render();
	}

	export function focusRect(x: number, y: number, w: number, h: number) {
		if (!controller) return;
		controller.fitToRect(x, y, w, h);
		controller.render();
	}

	export function focusLines(lineIds: number[]) {
		if (!controller || lineIds.length === 0) return;
		const idSet = new Set(lineIds);
		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity;
		for (const line of lines) {
			if (!idSet.has(line.id)) continue;
			const b = line.bbox;
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

	// Region detection state — track multiple pending regions
	let pendingRegions = $state<Map<string, { x: number; y: number; w: number; h: number }>>(
		new Map(),
	);

	/** Call this when region_lines arrives to clear a specific region's spinner */
	export function clearRedetecting(regionId?: string) {
		if (regionId) {
			pendingRegions.delete(regionId);
		} else {
			pendingRegions = new Map();
		}
		controller?.render();
	}

	function pointInPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
		let inside = false;
		for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
			const xi = poly[i].x,
				yi = poly[i].y;
			const xj = poly[j].x,
				yj = poly[j].y;
			if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
				inside = !inside;
			}
		}
		return inside;
	}

	function hitTestLine(clientX: number, clientY: number): number {
		if (!controller || lines.length === 0) return -1;
		const pt = controller.screenToImage(clientX, clientY);
		for (const line of lines) {
			const poly = line.bbox.polygon;
			if (poly && poly.length >= 3) {
				if (pointInPolygon(pt.x, pt.y, poly)) return line.id;
			} else {
				const b = line.bbox;
				if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) return line.id;
			}
		}
		return -1;
	}

	/** Find all lines whose bbox center falls within a rectangle (in image coords) */
	function linesInRect(x1: number, y1: number, x2: number, y2: number): number[] {
		const minX = Math.min(x1, x2),
			maxX = Math.max(x1, x2);
		const minY = Math.min(y1, y2),
			maxY = Math.max(y1, y2);
		const result: number[] = [];
		for (const line of lines) {
			const b = line.bbox;
			const cx = b.x + b.w / 2;
			const cy = b.y + b.h / 2;
			if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
				result.push(line.id);
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
		// Show transcribed text as tooltip (skip when text overlay is on)
		if (showTextOverlay) {
			canvasEl.title = '';
		} else {
			const line = idx >= 0 ? lines.find((l) => l.id === idx) : null;
			canvasEl.title = line?.complete ? line.text : '';
		}
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
					const regionId = onRedetectRegion(minX, minY, w, h);
					pendingRegions.set(regionId, { x: minX, y: minY, w, h });
					pendingRegions = new Map(pendingRegions); // trigger reactivity
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

	function getGroupColor(lineId: number): string | null {
		for (let g = 0; g < groups.length; g++) {
			if (groups[g].lineIds.includes(lineId)) {
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
				for (const line of lines) {
					if (!showBoxes && !showTextOverlay) continue;
					const isCurrent = line.id === currentLine;
					const isHovered = line.id === hoveredLine;
					const isSelected = selectedLines.has(line.id);
					const groupColor = getGroupColor(line.id);
					const highlight = isCurrent || isHovered;

					if (showBoxes) {
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

					// Text overlay mode
					if (showTextOverlay) {
						const b = line.bbox;
						const isHoveredLine = line.id === hoveredLine;

						if (!line.complete) {
							const t = performance.now() / 1000;
							const pad = b.h * 0.15;

							// Parse group color for tinting (fallback to blue)
							const gc = groupColor || '#3b82f6';
							const lr = parseInt(gc.slice(1, 3), 16);
							const lg = parseInt(gc.slice(3, 5), 16);
							const lb = parseInt(gc.slice(5, 7), 16);
							const lrLight = Math.min(lr + 90, 255);
							const lgLight = Math.min(lg + 90, 255);
							const lbLight = Math.min(lb + 90, 255);

							if (line.text) {
								// Measure text
								let fontSize = b.h * 0.75;
								ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
								let textW = ctx.measureText(line.text).width;
								if (textW + pad * 2 > b.w) {
									fontSize *= (b.w - pad * 2) / textW;
									ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
									textW = ctx.measureText(line.text).width;
								}
								const bgW = Math.max(b.w, textW + pad * 2);

								// Dark backdrop with soft edges
								ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
								ctx.beginPath();
								const r = Math.min(b.h * 0.15, 4 / transform.scale);
								ctx.roundRect(b.x, b.y, bgW, b.h, r);
								ctx.fill();

								// Sweeping gradient highlight in group color
								const sweepX = b.x + ((t * 80 + line.id * 50) % (bgW + 60)) - 30;
								const grad = ctx.createLinearGradient(sweepX - 30, 0, sweepX + 30, 0);
								grad.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, 0)`);
								grad.addColorStop(0.5, `rgba(${lrLight}, ${lgLight}, ${lbLight}, 0.12)`);
								grad.addColorStop(1, `rgba(${lr}, ${lg}, ${lb}, 0)`);
								ctx.fillStyle = grad;
								ctx.fillRect(b.x, b.y, bgW, b.h);

								// Text tinted with group color
								ctx.textAlign = 'left';
								ctx.textBaseline = 'middle';
								ctx.fillStyle = `rgba(${lrLight}, ${lgLight}, ${lbLight}, 0.95)`;
								ctx.fillText(line.text, b.x + pad, b.y + b.h * 0.55);

								// Glowing progress edge
								const progress = Math.min(1, line.text.length / 40);
								const pw = bgW * progress;
								const edgeGrad = ctx.createLinearGradient(
									b.x + pw - 8 / transform.scale,
									0,
									b.x + pw,
									0,
								);
								edgeGrad.addColorStop(0, `rgba(${lrLight}, ${lgLight}, ${lbLight}, 0)`);
								edgeGrad.addColorStop(1, `rgba(${lrLight}, ${lgLight}, ${lbLight}, 0.8)`);
								ctx.fillStyle = edgeGrad;
								ctx.fillRect(b.x, b.y + b.h - 2 / transform.scale, pw, 2 / transform.scale);

								// Thin progress line
								ctx.fillStyle = `rgba(${lr}, ${lg}, ${lb}, 0.3)`;
								ctx.fillRect(b.x, b.y + b.h - 1.5 / transform.scale, pw, 1.5 / transform.scale);
							} else {
								// No text yet — subtle pulsing placeholder in group color
								const shimmerAlpha = 0.04 + 0.03 * Math.sin(t * 3 + line.id);
								ctx.fillStyle = `rgba(${lr}, ${lg}, ${lb}, ${shimmerAlpha})`;
								ctx.fillRect(b.x, b.y, b.w, b.h);
							}
						} else if (line.text) {
							// Completed line — dim unless hovered
							const dimmed = hoveredLine >= 0 && !isHoveredLine;
							const pad = b.h * 0.15;
							// Start with height-based size, then shrink to fit width if needed
							let fontSize = b.h * 0.75;
							ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
							let textW = ctx.measureText(line.text).width;
							if (textW + pad * 2 > b.w) {
								fontSize *= (b.w - pad * 2) / textW;
								ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
								textW = ctx.measureText(line.text).width;
							}
							ctx.textAlign = 'left';
							ctx.textBaseline = 'middle';
							const bgW = Math.max(b.w, textW + pad * 2);
							ctx.fillStyle = dimmed ? 'rgba(0, 0, 0, 0.15)' : 'rgba(0, 0, 0, 0.7)';
							ctx.fillRect(b.x, b.y, bgW, b.h);
							ctx.fillStyle = dimmed ? 'rgba(255, 255, 255, 0.12)' : '#fff';
							ctx.fillText(line.text, b.x + pad, b.y + b.h * 0.55);
						}
					} else if (!line.complete && !isSelected && !highlight) {
						// Non-overlay mode: subtle shimmer only
						const b = line.bbox;
						const t = performance.now() / 1000;
						const shimmerAlpha = 0.06 + 0.04 * Math.sin(t * 3 + line.id);
						ctx.fillStyle = `rgba(59, 130, 246, ${shimmerAlpha})`;
						ctx.fillRect(b.x, b.y, b.w, b.h);
					}
				}

				// Draw persistent group region boxes with labels
				for (let gi = 0; gi < groups.length; gi++) {
					const g = groups[gi];
					if (!g.rect) continue;
					const color = GROUP_COLORS[gi % GROUP_COLORS.length];
					const { x, y, w, h } = g.rect;

					// Region outline
					ctx.strokeStyle = color;
					ctx.lineWidth = 2 / transform.scale;
					ctx.setLineDash([6 / transform.scale, 4 / transform.scale]);
					ctx.fillStyle = hexToRgba(color, 0.04);
					ctx.beginPath();
					ctx.rect(x, y, w, h);
					ctx.fill();
					ctx.stroke();
					ctx.setLineDash([]);

					// Group name label at top-left
					const fontSize = Math.max(12, Math.min(24, 16 / transform.scale));
					ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
					ctx.textAlign = 'left';
					ctx.textBaseline = 'top';
					const text = g.name;
					const metrics = ctx.measureText(text);
					const px = 5 / transform.scale;
					const py = 3 / transform.scale;
					const labelX = x + px;
					const labelY = y + py;
					ctx.fillStyle = hexToRgba(color, 0.85);
					ctx.beginPath();
					ctx.roundRect(
						labelX - px,
						labelY - py,
						metrics.width + px * 2,
						fontSize + py * 2,
						3 / transform.scale,
					);
					ctx.fill();
					ctx.fillStyle = '#fff';
					ctx.fillText(text, labelX, labelY);
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

				// Draw pending region spinners (waiting for detection)
				const now = performance.now();
				let pendingIdx = 0;
				for (const [regionId, region] of pendingRegions) {
					const { x, y, w, h } = region;
					// Find group color for this region
					const gi = groups.findIndex((g) => g.regionId === regionId);
					const groupCol =
						gi >= 0
							? GROUP_COLORS[gi % GROUP_COLORS.length]
							: GROUP_COLORS[pendingIdx % GROUP_COLORS.length];
					pendingIdx++;
					// Parse hex to rgb components
					const cr = parseInt(groupCol.slice(1, 3), 16);
					const cg = parseInt(groupCol.slice(3, 5), 16);
					const cb = parseInt(groupCol.slice(5, 7), 16);
					const s = transform.scale;
					const rr = Math.min(h * 0.05, 6 / s);

					// Frosted backdrop
					ctx.fillStyle = 'rgba(15, 23, 42, 0.15)';
					ctx.beginPath();
					ctx.roundRect(x, y, w, h, rr);
					ctx.fill();

					// Animated marching ants border
					const dashLen = 10 / s;
					const offset = (now / 80) % (dashLen * 2);
					ctx.setLineDash([dashLen, dashLen]);
					ctx.lineDashOffset = -offset;
					ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, 0.6)`;
					ctx.lineWidth = 1.5 / s;
					ctx.beginPath();
					ctx.roundRect(x, y, w, h, rr);
					ctx.stroke();
					ctx.setLineDash([]);
					ctx.lineDashOffset = 0;

					// Glowing spinner ring
					const cx = x + w / 2;
					const cy = y + h / 2;
					const sr = Math.min(w, h, 50 / s) * 0.2;
					const angle = (now / 500) % (Math.PI * 2);

					// Outer glow
					ctx.beginPath();
					ctx.arc(cx, cy, sr + 2 / s, angle, angle + Math.PI * 1.2);
					ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, 0.15)`;
					ctx.lineWidth = 5 / s;
					ctx.stroke();

					// Main arc
					ctx.beginPath();
					ctx.arc(cx, cy, sr, angle, angle + Math.PI * 1.2);
					ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, 0.9)`;
					ctx.lineWidth = 2.5 / s;
					ctx.lineCap = 'round';
					ctx.stroke();
					ctx.lineCap = 'butt';

					// Small dot at the leading edge
					const dotAngle = angle + Math.PI * 1.2;
					ctx.beginPath();
					ctx.arc(
						cx + sr * Math.cos(dotAngle),
						cy + sr * Math.sin(dotAngle),
						2.5 / s,
						0,
						Math.PI * 2,
					);
					ctx.fillStyle = `rgba(${Math.min(cr + 80, 255)}, ${Math.min(cg + 80, 255)}, ${Math.min(cb + 80, 255)}, 0.95)`;
					ctx.fill();

					// "Analyzing..." label
					const labelSize = Math.min(14 / s, h * 0.06);
					ctx.font = `500 ${labelSize}px system-ui, sans-serif`;
					ctx.textAlign = 'center';
					ctx.textBaseline = 'top';
					ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.7)`;
					ctx.fillText('Analyzing...', cx, cy + sr + 8 / s);
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
			// Clear pending regions from previous image
			pendingRegions = new Map();
			// Fade transition
			canvasEl.style.opacity = '0';
			const newImg = new Image();
			newImg.onload = () => {
				img = newImg;
				controller.setImage(newImg);
				// Animate in
				requestAnimationFrame(() => {
					canvasEl.style.transition = 'opacity 0.2s ease-out';
					canvasEl.style.opacity = '1';
					setTimeout(() => {
						canvasEl.style.transition = '';
					}, 250);
				});
			};
			newImg.src = imageUrl;
		}
	});

	$effect(() => {
		void imageUrl;
		void lines;
		void currentLine;
		void hoveredLine;
		void selectedLines;
		void groups;
		void showTextOverlay;
		void showBoxes;
		controller?.render();
	});

	// Animate while regions pending or lines being transcribed
	$effect(() => {
		const hasActiveWork =
			pendingRegions.size > 0 || lines.some((l) => !l.complete && l.text !== undefined);
		if (!hasActiveWork) return;
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
	<canvas
		bind:this={canvasEl}
		class="block h-full w-full touch-none"
		class:cursor-crosshair={selectMode}
		style:filter={imageFilter || 'none'}
	></canvas>
	{#if stage === 'segmenting'}
		<div
			class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60 backdrop-blur-md pointer-events-none"
		>
			<div class="loader-premium"><div class="ring ring-lg ring-light"></div></div>
			<p class="text-sm text-white font-medium">{t('region.analyzing')}</p>
		</div>
	{/if}
	{#if !imageUrl}
		<div class="absolute inset-0 flex items-center justify-center pointer-events-none">
			<div class="rounded-xl bg-card/90 backdrop-blur-lg border border-border/50 shadow-xl p-5">
				<div class="loader-premium"><div class="ring"></div></div>
			</div>
		</div>
	{/if}
</div>
