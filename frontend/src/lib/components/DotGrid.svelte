<script lang="ts">
	import { onMount } from 'svelte';

	let canvas: HTMLCanvasElement;

	onMount(() => {
		const ctx = canvas.getContext('2d')!;
		let raf: number;
		let mouse = { x: -1000, y: -1000 };

		const SPACING = 24;
		const RADIUS = 1;
		const RADIUS_MAX = 2.5;
		const INFLUENCE = 400;
		const PUSH = 0.3;
		const SPRING = 0.015;
		const DAMPING = 0.95;

		// Younger Futhark + medieval Swedish runes
		const RUNES = 'ᚠᚢᚦᚬᚱᚴᚼᚾᛁᛅᛋᛏᛒᛘᛚᛦ᛭ᛮᛯᛰ';
		const FONT_SIZE = 10;
		const ATLAS_SIZE = 32; // render each rune at this size for quality

		// Pre-render rune atlases — dark (white runes) and light (black runes)
		const runeAtlasDark = new Map<string, HTMLCanvasElement>();
		const runeAtlasLight = new Map<string, HTMLCanvasElement>();
		for (const rune of RUNES) {
			for (const [atlas, color] of [
				[runeAtlasDark, '#fff'],
				[runeAtlasLight, '#000'],
			] as const) {
				const oc = document.createElement('canvas');
				oc.width = ATLAS_SIZE;
				oc.height = ATLAS_SIZE;
				const octx = oc.getContext('2d')!;
				octx.font = `${ATLAS_SIZE * 0.75}px serif`;
				octx.textAlign = 'center';
				octx.textBaseline = 'middle';
				octx.fillStyle = color;
				octx.fillText(rune, ATLAS_SIZE / 2, ATLAS_SIZE / 2);
				atlas.set(rune, oc);
			}
		}

		let dots: {
			x: number;
			y: number;
			ox: number;
			oy: number;
			vx: number;
			vy: number;
			phase: number;
			rune: string;
		}[] = [];
		let t = 0;

		function initDots() {
			const w = window.innerWidth;
			const h = window.innerHeight;
			canvas.width = w * devicePixelRatio;
			canvas.height = h * devicePixelRatio;
			canvas.style.width = w + 'px';
			canvas.style.height = h + 'px';
			ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

			dots = [];
			const cols = Math.ceil(w / SPACING) + 1;
			const rows = Math.ceil(h / SPACING) + 1;
			const offX = (w - (cols - 1) * SPACING) / 2;
			const offY = (h - (rows - 1) * SPACING) / 2;

			for (let r = 0; r < rows; r++) {
				for (let c = 0; c < cols; c++) {
					const ox = offX + c * SPACING;
					const oy = offY + r * SPACING;
					// Each dot gets a unique phase based on its diagonal position
					const phase = Math.random() * Math.PI * 2;
					const rune = RUNES[Math.floor(Math.random() * RUNES.length)];
					dots.push({ x: ox, y: oy, ox, oy, vx: 0, vy: 0, phase, rune });
				}
			}
		}

		function draw() {
			const w = window.innerWidth;
			const h = window.innerHeight;
			ctx.clearRect(0, 0, w, h);
			t++;

			const isDark = document.documentElement.classList.contains('dark');

			for (const dot of dots) {
				const targetX = dot.ox;
				const targetY = dot.oy;

				// Mouse repulsion
				const dx = targetX - mouse.x;
				const dy = targetY - mouse.y;
				const dist = Math.sqrt(dx * dx + dy * dy);

				if (dist < INFLUENCE && dist > 0) {
					const force = (1 - dist / INFLUENCE) * PUSH;
					dot.vx += (dx / dist) * force;
					dot.vy += (dy / dist) * force;
				}

				// Spring toward wave+drift target
				dot.vx += (targetX - dot.x) * SPRING;
				dot.vy += (targetY - dot.y) * SPRING;
				dot.vx *= DAMPING;
				dot.vy *= DAMPING;
				dot.x += dot.vx;
				dot.y += dot.vy;

				// Pulsate radius — per-dot, slow
				const pulse = Math.sin(t * 0.01 + dot.phase) * 0.3 + 0.7;

				const proximity = Math.max(0, 1 - dist / INFLUENCE);
				const glow = proximity * proximity;
				const _r = (RADIUS + (RADIUS_MAX - RADIUS) * glow) * (0.85 + 0.15 * pulse);
				const alpha = isDark
					? 0.03 + 0.02 * pulse + 0.25 * glow
					: 0.02 + 0.01 * pulse + 0.15 * glow;

				const size = FONT_SIZE * (0.85 + 0.15 * pulse) + FONT_SIZE * 0.8 * glow;
				const half = size / 2;
				ctx.globalAlpha = alpha;
				const atlas = isDark ? runeAtlasDark : runeAtlasLight;
				ctx.drawImage(atlas.get(dot.rune)!, dot.x - half, dot.y - half, size, size);
				ctx.globalAlpha = 1;
			}

			raf = requestAnimationFrame(draw);
		}

		initDots();

		window.addEventListener('resize', initDots);
		window.addEventListener('mousemove', (e) => {
			mouse.x = e.clientX;
			mouse.y = e.clientY;
		});
		window.addEventListener('mouseleave', () => {
			mouse.x = -1000;
			mouse.y = -1000;
		});

		// Re-parent canvas into fullscreen element so dots stay visible
		const originalParent = canvas.parentElement!;
		function onFullscreenChange() {
			const fsEl = document.fullscreenElement;
			if (fsEl) {
				fsEl.insertBefore(canvas, fsEl.firstChild);
			} else {
				originalParent.appendChild(canvas);
			}
			initDots();
		}
		document.addEventListener('fullscreenchange', onFullscreenChange);

		raf = requestAnimationFrame(draw);

		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener('resize', initDots);
			document.removeEventListener('fullscreenchange', onFullscreenChange);
		};
	});
</script>

<canvas
	bind:this={canvas}
	style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:0;pointer-events:none;"
	aria-hidden="true"
></canvas>
