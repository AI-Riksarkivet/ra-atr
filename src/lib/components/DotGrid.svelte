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
    const INFLUENCE = 100;
    const PUSH = 0.8;
    const SPRING = 0.03;
    const DAMPING = 0.92;

    let dots: { x: number; y: number; ox: number; oy: number; vx: number; vy: number }[] = [];

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
          dots.push({ x: ox, y: oy, ox, oy, vx: 0, vy: 0 });
        }
      }
    }

    function draw() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);

      const isDark = document.documentElement.classList.contains('dark');

      for (const dot of dots) {
        const dx = dot.ox - mouse.x;
        const dy = dot.oy - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < INFLUENCE && dist > 0) {
          const force = (1 - dist / INFLUENCE) * PUSH;
          dot.vx += (dx / dist) * force;
          dot.vy += (dy / dist) * force;
        }

        // Spring back to origin
        dot.vx += (dot.ox - dot.x) * SPRING;
        dot.vy += (dot.oy - dot.y) * SPRING;
        dot.vx *= DAMPING;
        dot.vy *= DAMPING;
        dot.x += dot.vx;
        dot.y += dot.vy;

        const proximity = Math.max(0, 1 - dist / INFLUENCE);
        const glow = proximity * proximity;
        const r = RADIUS + (RADIUS_MAX - RADIUS) * glow;
        const alpha = isDark ? 0.13 + 0.45 * glow : 0.1 + 0.3 * glow;

        ctx.beginPath();
        ctx.arc(dot.x, dot.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    }

    initDots();

    window.addEventListener('resize', initDots);
    window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
    window.addEventListener('mouseleave', () => { mouse.x = -1000; mouse.y = -1000; });

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
