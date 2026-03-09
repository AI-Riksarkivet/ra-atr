# UI Stack Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate lejonet from plain Vite + hand-written CSS to SvelteKit + Tailwind CSS v4 + bits-ui + Storybook 10, matching the AI-Riksarkivet/hcp project patterns.

**Architecture:** SvelteKit app with two routes (`/` for upload, `/viewer` for workspace). Shared app state via a Svelte 5 runes store. UI components copied from hcp's bits-ui wrappers. All scoped CSS replaced with Tailwind utility classes.

**Tech Stack:** SvelteKit, Tailwind CSS v4, bits-ui, tailwind-variants, Storybook 10, lucide-svelte, mode-watcher, svelte-sonner, clsx, tailwind-merge

---

### Task 1: Install SvelteKit and reconfigure project

**Files:**
- Modify: `package.json`
- Create: `svelte.config.js` (replace existing)
- Create: `vite.config.ts` (replace existing)
- Create: `src/app.html`
- Delete: `index.html`
- Delete: `src/main.ts`
- Modify: `tsconfig.json`, `tsconfig.app.json`

**Step 1: Install SvelteKit and Tailwind dependencies**

Run:
```bash
npm install @sveltejs/kit @sveltejs/adapter-static @tailwindcss/vite tailwindcss@4 bits-ui tailwind-variants clsx tailwind-merge lucide-svelte mode-watcher svelte-sonner tw-animate-css
npm install -D storybook @storybook/svelte @storybook/sveltekit @storybook/addon-docs @storybook/addon-svelte-csf
```

**Step 2: Replace svelte.config.js**

```js
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: 'index.html',
    }),
  },
};

export default config;
```

**Step 3: Replace vite.config.ts**

```ts
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit(), wasm()],
  worker: {
    plugins: () => [wasm()],
  },
  ssr: {
    noExternal: ['svelte-sonner', 'mode-watcher', 'svelte-toolbelt'],
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    watch: {
      ignored: ['**/target/**', '**/models/**', '**/.venv/**', '**/.export-venv/**'],
    },
  },
});
```

**Step 4: Create src/app.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lejonet HTR</title>
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

**Step 5: Delete old entry points**

```bash
rm index.html src/main.ts
```

**Step 6: Update tsconfig.json**

Replace `tsconfig.json`:
```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "strict": true
  }
}
```

Delete `tsconfig.app.json` and `tsconfig.node.json` (SvelteKit generates its own).

**Step 7: Update package.json scripts**

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build"
  }
}
```

**Step 8: Verify SvelteKit boots**

Run: `npm run dev`
Expected: Server starts (page will 404 — no routes yet). Ctrl+C to stop.

**Step 9: Commit**

```bash
git add -A
git commit -m "migrate from plain Vite to SvelteKit with Tailwind v4"
```

---

### Task 2: Set up Tailwind v4 theme and app.css

**Files:**
- Create: `src/app.css` (replace existing)

**Step 1: Replace src/app.css with Tailwind v4 config**

Copy the hcp theme with oklch colors. This replaces the old hand-written CSS variables:

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0.004 285.823);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0.004 285.823);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0.004 285.823);
  --primary: oklch(0.37 0.19 250);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0.001 286.375);
  --secondary-foreground: oklch(0.205 0.006 285.885);
  --muted: oklch(0.97 0.001 286.375);
  --muted-foreground: oklch(0.556 0.007 285.938);
  --accent: oklch(0.97 0.001 286.375);
  --accent-foreground: oklch(0.205 0.006 285.885);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0.004 286.32);
  --input: oklch(0.922 0.004 286.32);
  --ring: oklch(0.45 0.18 250);
  --success: oklch(0.65 0.2 145);
  --success-foreground: oklch(0.985 0 0);
  --warning: oklch(0.75 0.18 75);
  --warning-foreground: oklch(0.145 0.004 285.823);
}

.dark {
  --background: oklch(0.145 0.004 285.823);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0.006 285.885);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0.006 285.885);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.66 0.15 250);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.269 0.006 285.885);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0.006 285.885);
  --muted-foreground: oklch(0.711 0.007 285.938);
  --accent: oklch(0.371 0.006 285.885);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.66 0.15 250);
  --success: oklch(0.65 0.2 145);
  --success-foreground: oklch(0.985 0 0);
  --warning: oklch(0.75 0.18 75);
  --warning-foreground: oklch(0.985 0 0);
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground antialiased;
  }
}
```

**Step 2: Commit**

```bash
git add src/app.css
git commit -m "replace hand-written CSS with Tailwind v4 theme"
```

---

### Task 3: Create utility files and copy UI components from hcp

**Files:**
- Create: `src/lib/utils.ts`
- Create: `src/lib/utils/cn.ts`
- Create: `src/lib/components/ui/button/button.svelte`
- Create: `src/lib/components/ui/button/index.ts`
- Create: `src/lib/components/ui/badge/badge.svelte`
- Create: `src/lib/components/ui/badge/index.ts`
- Create: `src/lib/components/ui/progress/progress.svelte`
- Create: `src/lib/components/ui/progress/index.ts`
- Create: `src/lib/components/ui/separator/separator.svelte`
- Create: `src/lib/components/ui/separator/index.ts`
- Create: `src/lib/components/ui/tooltip/` (all files)

**Step 1: Create src/lib/utils/cn.ts**

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**Step 2: Create src/lib/utils.ts**

```ts
export { cn } from "./utils/cn.js";

export type WithElementRef<T, El extends HTMLElement = HTMLElement> = T & {
  ref?: El | null;
};

export type WithoutChildren<T> = Omit<T, "children">;
export type WithoutChild<T> = Omit<T, "child">;
export type WithoutChildrenOrChild<T> = Omit<T, "children" | "child">;
```

**Step 3: Copy UI components from hcp**

Copy these directories verbatim from `/tmp/hcp/frontend/src/lib/components/ui/`:
- `button/`
- `badge/`
- `progress/`
- `separator/`
- `tooltip/`

```bash
mkdir -p src/lib/components/ui
for dir in button badge progress separator tooltip; do
  cp -r /tmp/hcp/frontend/src/lib/components/ui/$dir src/lib/components/ui/
done
```

**Step 4: Verify imports resolve**

Run: `npm run check`
Expected: No errors related to the UI components.

**Step 5: Commit**

```bash
git add src/lib/utils.ts src/lib/utils/ src/lib/components/ui/
git commit -m "add utility functions and UI components from hcp"
```

---

### Task 4: Set up Storybook

**Files:**
- Create: `.storybook/main.ts`
- Create: `.storybook/preview.ts`

**Step 1: Create .storybook/main.ts**

```ts
import type { StorybookConfig } from "@storybook/sveltekit";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(js|ts|svelte)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-svelte-csf"],
  framework: {
    name: "@storybook/sveltekit",
    options: {},
  },
  docs: {
    autodocs: true,
  },
};

export default config;
```

**Step 2: Create .storybook/preview.ts**

```ts
import type { Preview } from "@storybook/svelte";
import "../src/app.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
```

**Step 3: Verify Storybook starts**

Run: `npm run storybook`
Expected: Storybook opens on port 6006. Ctrl+C to stop.

**Step 4: Commit**

```bash
git add .storybook/
git commit -m "set up Storybook 10 with SvelteKit integration"
```

---

### Task 5: Create shared app state store

**Files:**
- Create: `src/lib/stores/app-state.svelte.ts`

**Step 1: Create the shared state module**

This replaces the per-component state in App.svelte and allows cross-route data sharing (upload page → viewer page).

```ts
import { HTRWorkerState } from '$lib/worker-state.svelte';
import type { LineGroup } from '$lib/types';

class AppState {
  htr = $state(new HTRWorkerState());
  imageUrl = $state<string | null>(null);
  hoveredLine = $state(-1);
  selectedLines = $state(new Set<number>());
  groups = $state<LineGroup[]>([]);
  groupCounter = $state(0);
  selectMode = $state(false);

  reset() {
    this.imageUrl = null;
    this.htr.reset();
    this.selectedLines = new Set();
    this.groups = [];
    this.groupCounter = 0;
    this.selectMode = false;
  }
}

export const appState = new AppState();
```

**Step 2: Commit**

```bash
git add src/lib/stores/
git commit -m "add shared app state store for cross-route data"
```

---

### Task 6: Create SvelteKit layout with mode-watcher and header

**Files:**
- Create: `src/routes/+layout.svelte`
- Create: `src/routes/+layout.ts`
- Create: `src/lib/components/layout/app-header.svelte`

**Step 1: Create src/routes/+layout.ts**

Disable SSR (client-only WASM app):

```ts
export const ssr = false;
export const prerender = false;
```

**Step 2: Create src/lib/components/layout/app-header.svelte**

```svelte
<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { toggleMode } from 'mode-watcher';
  import { Sun, Moon, Plus, Minus, RotateCcw } from 'lucide-svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import { page } from '$app/state';

  interface Props {
    onZoomIn?: () => void;
    onZoomOut?: () => void;
    onResetView?: () => void;
    onNewImage?: () => void;
  }

  let { onZoomIn, onZoomOut, onResetView, onNewImage }: Props = $props();

  const isViewer = $derived(page.url.pathname === '/viewer');
</script>

<header class="flex items-center gap-3 border-b border-border bg-card px-4 py-2 shrink-0">
  <h1 class="text-lg font-semibold">Lejonet HTR</h1>

  {#if appState.htr.modelsReady}
    <Badge variant="success">Ready</Badge>
  {/if}

  <div class="ml-auto flex items-center gap-2">
    {#if isViewer}
      <Button
        variant={appState.selectMode ? 'default' : 'outline'}
        size="sm"
        onclick={() => {
          appState.selectMode = !appState.selectMode;
          if (!appState.selectMode) appState.selectedLines = new Set();
        }}
      >
        {appState.selectMode ? 'Pan mode' : 'Select'}
      </Button>

      <div class="flex">
        <Button variant="outline" size="icon-sm" onclick={onZoomIn}><Plus class="size-4" /></Button>
        <Button variant="outline" size="icon-sm" onclick={onZoomOut}><Minus class="size-4" /></Button>
        <Button variant="outline" size="icon-sm" onclick={onResetView}><RotateCcw class="size-4" /></Button>
      </div>

      <Button variant="outline" size="sm" onclick={onNewImage}>New image</Button>
    {/if}

    <Button variant="ghost" size="icon-sm" onclick={toggleMode}>
      <Sun class="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon class="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span class="sr-only">Toggle theme</span>
    </Button>
  </div>
</header>
```

**Step 3: Create src/routes/+layout.svelte**

```svelte
<script lang="ts">
  import '../app.css';
  import { ModeWatcher } from 'mode-watcher';
  import { Toaster } from 'svelte-sonner';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<ModeWatcher defaultMode="dark" />
<Toaster />

<div class="flex h-screen flex-col overflow-hidden">
  {@render children()}
</div>
```

**Step 4: Commit**

```bash
git add src/routes/ src/lib/components/layout/
git commit -m "add SvelteKit layout with mode-watcher and header"
```

---

### Task 7: Create home page (model loading + upload)

**Files:**
- Create: `src/routes/+page.svelte`
- Modify: `src/lib/components/ModelManager.svelte` (restyle with Tailwind)
- Modify: `src/lib/components/UploadPanel.svelte` (restyle with Tailwind)

**Step 1: Rewrite ModelManager.svelte with Tailwind**

Replace the entire component. Remove `<style>` block, use Tailwind classes and bits-ui Progress:

```svelte
<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Progress } from '$lib/components/ui/progress';

  interface Props {
    modelProgress: Record<string, number>;
    onLoadModels: () => void;
    modelsReady: boolean;
    autoLoading?: boolean;
  }

  let { modelProgress, onLoadModels, modelsReady, autoLoading = false }: Props = $props();

  const models = [
    { key: 'yolo', label: 'YOLO Line Detection', size: '~229 MB' },
    { key: 'trocr-encoder', label: 'TrOCR Encoder', size: '~329 MB' },
    { key: 'trocr-decoder', label: 'TrOCR Decoder', size: '~1.2 GB' },
    { key: 'tokenizer', label: 'Tokenizer', size: '~2 MB' },
  ];

  let loading = $state(false);

  function handleLoad() {
    loading = true;
    onLoadModels();
  }
</script>

<div class="mx-auto max-w-md space-y-6 p-8">
  <div class="space-y-2">
    <h2 class="text-lg font-semibold">{autoLoading ? 'Loading Models' : 'Download Models'}</h2>
    <p class="text-sm text-muted-foreground">
      {autoLoading ? 'Loading cached models...' : 'Models run entirely in your browser. Total download: ~1.8 GB (cached after first load).'}
    </p>
  </div>

  <div class="space-y-3">
    {#each models as model}
      <div class="flex items-center gap-3">
        <span class="flex-1 text-sm">{model.label}</span>
        <span class="min-w-[5rem] text-right font-mono text-xs text-muted-foreground">{model.size}</span>
        {#if loading || modelsReady || autoLoading}
          <Progress value={modelsReady ? 100 : (modelProgress[model.key] ?? 0)} class="w-24" />
        {/if}
      </div>
    {/each}
  </div>

  {#if !loading && !modelsReady && !autoLoading}
    <Button class="w-full" onclick={handleLoad}>Download Models</Button>
  {:else if modelsReady}
    <p class="text-center text-sm text-success">Models cached and ready.</p>
  {/if}
</div>
```

**Step 2: Rewrite UploadPanel.svelte with Tailwind**

```svelte
<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';

  interface Props {
    onUpload: (imageData: ArrayBuffer, previewUrl: string) => void;
    disabled: boolean;
  }

  let { onUpload, disabled }: Props = $props();
  let dragOver = $state(false);
  let loadingDemo = $state(false);
  let fileInput: HTMLInputElement;

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) return;
    const previewUrl = URL.createObjectURL(file);
    file.arrayBuffer().then((buf) => onUpload(buf, previewUrl));
  }

  async function loadDemoImage() {
    loadingDemo = true;
    try {
      const res = await fetch('/demo.jpg');
      const buf = await res.arrayBuffer();
      const blob = new Blob([buf], { type: 'image/jpeg' });
      const previewUrl = URL.createObjectURL(blob);
      onUpload(buf, previewUrl);
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
    class="hidden"
    onchange={(e) => handleFiles(e.currentTarget.files)}
    {disabled}
  />
  <p class="text-sm text-muted-foreground">Drop an image here or click to upload</p>
  <Button
    variant="outline"
    size="sm"
    onclick={(e) => { e.stopPropagation(); loadDemoImage(); }}
    disabled={disabled || loadingDemo}
  >
    {loadingDemo ? 'Loading...' : 'Try demo image'}
  </Button>
</div>
```

**Step 3: Create src/routes/+page.svelte**

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { appState } from '$lib/stores/app-state.svelte';
  import AppHeader from '$lib/components/layout/app-header.svelte';
  import ModelManager from '$lib/components/ModelManager.svelte';
  import UploadPanel from '$lib/components/UploadPanel.svelte';
  import { onMount } from 'svelte';

  onMount(() => {
    return () => { /* cleanup if needed */ };
  });

  function handleUpload(imageData: ArrayBuffer, previewUrl: string) {
    appState.imageUrl = previewUrl;
    appState.selectMode = true;
    appState.htr.setImage(imageData);
    goto('/viewer');
  }
</script>

<AppHeader />

<div class="flex flex-1 items-center justify-center overflow-hidden">
  {#if !appState.htr.modelsReady && !appState.htr.cacheChecked}
    <p class="text-muted-foreground">Checking cached models...</p>
  {:else if !appState.htr.modelsReady}
    <ModelManager
      modelProgress={appState.htr.modelProgress}
      onLoadModels={() => appState.htr.loadModels()}
      modelsReady={appState.htr.modelsReady}
      autoLoading={appState.htr.stage === 'loading_models'}
    />
  {:else}
    <div class="w-full max-w-lg p-8">
      <UploadPanel onUpload={handleUpload} disabled={!appState.htr.modelsReady} />
    </div>
  {/if}
</div>
```

**Step 4: Verify home page renders**

Run: `npm run dev`
Navigate to `http://localhost:5173/`
Expected: Model manager or upload panel visible with new Tailwind styling.

**Step 5: Commit**

```bash
git add src/routes/+page.svelte src/lib/components/ModelManager.svelte src/lib/components/UploadPanel.svelte
git commit -m "create home page with restyled model manager and upload panel"
```

---

### Task 8: Create viewer page with document workspace

**Files:**
- Create: `src/routes/viewer/+page.svelte`
- Modify: `src/lib/components/DocumentViewer.svelte` (remove `<style>`, add Tailwind)
- Modify: `src/lib/components/TranscriptionPanel.svelte` (remove `<style>`, add Tailwind)
- Modify: `src/lib/components/StatusBar.svelte` (remove `<style>`, add Tailwind)

**Step 1: Restyle StatusBar.svelte**

Remove entire `<style>` block. Replace template with Tailwind classes:

```svelte
<script lang="ts">
  import type { PipelineStage } from '$lib/types';

  interface Props {
    stage: PipelineStage;
    currentLine: number;
    totalLines: number;
  }

  let { stage, currentLine, totalLines }: Props = $props();

  const stageLabels: Record<PipelineStage, string> = {
    idle: 'Ready',
    loading_models: 'Loading models...',
    segmenting: 'Detecting lines...',
    transcribing: 'Transcribing...',
    done: 'Done',
  };

  let elapsed = $state(0);
  let timer: ReturnType<typeof setInterval> | null = null;
  let startTime = 0;

  $effect(() => {
    if (stage === 'segmenting' || stage === 'transcribing') {
      if (!timer) {
        startTime = Date.now();
        elapsed = 0;
        timer = setInterval(() => {
          elapsed = Math.floor((Date.now() - startTime) / 1000);
        }, 1000);
      }
    } else {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  });

  function formatTime(s: number): string {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  }
</script>

<div class="flex items-center gap-4 border-t border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
  <span class="font-medium">{stageLabels[stage]}</span>
  {#if stage === 'transcribing' && totalLines > 0}
    <span class="font-mono">Line {currentLine + 1} / {totalLines}</span>
  {/if}
  {#if elapsed > 0 && (stage === 'segmenting' || stage === 'transcribing' || stage === 'done')}
    <span class="ml-auto font-mono">{formatTime(elapsed)}</span>
  {/if}
</div>
```

**Step 2: Restyle DocumentViewer.svelte**

Keep all the `<script>` logic unchanged. Remove the `<style>` block. Replace the template with Tailwind classes:

```svelte
<div class="relative h-full w-full">
  <canvas bind:this={canvasEl} class="block h-full w-full touch-none" class:cursor-crosshair={selectMode}></canvas>
  {#if stage === 'segmenting'}
    <div class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/50 pointer-events-none">
      <div class="size-8 animate-spin rounded-full border-3 border-white/20 border-t-white"></div>
      <p class="text-sm text-white">Detecting text lines...</p>
    </div>
  {/if}
</div>
```

**Step 3: Restyle TranscriptionPanel.svelte**

Keep all `<script>` logic unchanged. Remove the `<style>` block. Replace the template with Tailwind classes. Key class mappings:

- `.transcription-panel` → `overflow-y-auto p-3 font-serif text-[0.95rem] leading-relaxed h-full`
- `.group` → `mb-2 border-l-3 rounded` with `style="border-color: var(--group-color)"`
- `.group-header` → `flex items-center gap-1.5 px-2 py-1.5 bg-white/[0.03] text-xs font-sans select-none`
- `.line` → `flex items-baseline gap-2 px-2 py-1 rounded cursor-pointer transition-colors`
- `.line.current, .line.hovered` → `bg-orange-500/[0.08]`
- `.line.selected` → `bg-yellow-400/[0.12] outline outline-1 outline-yellow-400/30`
- `.line-number` → `text-muted-foreground text-xs min-w-[1.5rem] text-right font-mono select-none`
- `.confidence` → `text-xs text-muted-foreground font-mono`
- `.cursor` → `animate-pulse text-orange-500`

The exact template is long — replace class-by-class, keeping all Svelte logic (`{#each}`, `{#if}`, event handlers) identical.

**Step 4: Create src/routes/viewer/+page.svelte**

This is the main workspace page, largely migrated from `App.svelte`:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import AppHeader from '$lib/components/layout/app-header.svelte';
  import DocumentViewer from '$lib/components/DocumentViewer.svelte';
  import TranscriptionPanel from '$lib/components/TranscriptionPanel.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import { Button } from '$lib/components/ui/button';
  import type { LineGroup } from '$lib/types';

  let dividerX = $state(60);
  let isDraggingDivider = $state(false);
  let docViewer: DocumentViewer;

  // Redirect to home if no image loaded
  $effect(() => {
    if (!appState.imageUrl) goto('/');
  });

  // All the group/selection/delete logic from App.svelte goes here
  // (createGroup, deleteSelectedLines, deleteGroup, renameGroup, toggleGroup, onKeyDown, etc.)
  // Keep identical logic, but reference appState.htr, appState.selectedLines, appState.groups, etc.

  function handleSelectLine(index: number, additive: boolean) {
    if (index < 0) { appState.selectedLines = new Set(); return; }
    if (additive) {
      const next = new Set(appState.selectedLines);
      if (next.has(index)) next.delete(index); else next.add(index);
      appState.selectedLines = next;
    } else {
      appState.selectedLines = new Set([index]);
    }
  }

  function handleMarqueeSelect(indices: number[]) {
    appState.selectedLines = new Set(indices);
  }

  function createGroup() {
    if (appState.selectedLines.size === 0) return;
    const sel = appState.selectedLines;
    for (const g of appState.groups) {
      g.lineIndices = g.lineIndices.filter(i => !sel.has(i));
    }
    appState.groups = appState.groups.filter(g => g.lineIndices.length > 0);
    appState.groupCounter++;
    const newGroup: LineGroup = {
      id: `group-${appState.groupCounter}`,
      name: `Group ${appState.groupCounter}`,
      lineIndices: [...sel].sort((a, b) => a - b),
      collapsed: false,
    };
    appState.groups = [...appState.groups, newGroup];
    appState.selectedLines = new Set();
    if (appState.htr.stage === 'transcribing') {
      const allGroups = [...appState.groups.filter(g => g.lineIndices.length > 0)];
      const grouped = new Set(allGroups.flatMap(g => g.lineIndices));
      const order = [
        ...allGroups.flatMap(g => g.lineIndices),
        ...Array.from({ length: appState.htr.lines.length }, (_, i) => i).filter(i => !grouped.has(i)),
      ];
      appState.htr.prioritizeLines(order);
    }
  }

  function deleteSelectedLines() {
    if (appState.selectedLines.size === 0) return;
    const removed = appState.selectedLines;
    const remap = new Map<number, number>();
    let newIdx = 0;
    for (let i = 0; i < appState.htr.lines.length; i++) {
      if (!removed.has(i)) remap.set(i, newIdx++);
    }
    appState.htr.lines = appState.htr.lines.filter((_, i) => !removed.has(i));
    for (const g of appState.groups) {
      g.lineIndices = g.lineIndices.filter(i => !removed.has(i)).map(i => remap.get(i)!);
    }
    appState.groups = appState.groups.filter(g => g.lineIndices.length > 0);
    appState.selectedLines = new Set();
  }

  function deleteGroup(groupId: string) { appState.groups = appState.groups.filter(g => g.id !== groupId); }
  function renameGroup(groupId: string, name: string) { appState.groups = appState.groups.map(g => g.id === groupId ? { ...g, name } : g); }
  function toggleGroup(groupId: string) { appState.groups = appState.groups.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g); }

  function onKeyDown(e: KeyboardEvent) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && appState.selectedLines.size > 0) {
      e.preventDefault();
      deleteSelectedLines();
    }
  }

  function handleNewImage() {
    appState.reset();
    goto('/');
  }

  onMount(() => {
    appState.htr.onRegionDetected = (startIndex, count) => {
      docViewer?.clearRedetecting();
      if (count > 0) {
        appState.groupCounter++;
        const lineIndices = Array.from({ length: count }, (_, i) => startIndex + i);
        appState.groups = [...appState.groups, {
          id: `group-${appState.groupCounter}`,
          name: `Group ${appState.groupCounter}`,
          lineIndices,
          collapsed: false,
        }];
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  });

  function onDividerPointerDown(e: PointerEvent) {
    isDraggingDivider = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDividerPointerMove(e: PointerEvent) {
    if (!isDraggingDivider) return;
    const container = (e.target as HTMLElement).parentElement!;
    const rect = container.getBoundingClientRect();
    dividerX = Math.min(85, Math.max(25, ((e.clientX - rect.left) / rect.width) * 100));
  }
  function onDividerPointerUp(e: PointerEvent) {
    isDraggingDivider = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }
</script>

<AppHeader
  onZoomIn={() => docViewer?.zoomIn()}
  onZoomOut={() => docViewer?.zoomOut()}
  onResetView={() => docViewer?.resetView()}
  onNewImage={handleNewImage}
/>

{#if appState.htr.error}
  <div class="bg-destructive/10 px-4 py-2 text-sm text-destructive shrink-0">{appState.htr.error}</div>
{/if}

{#if appState.selectedLines.size > 0}
  <div class="flex items-center gap-2 border-b border-yellow-400/20 bg-yellow-400/[0.08] px-4 py-1.5 shrink-0">
    <span class="text-xs text-yellow-400">{appState.selectedLines.size} line{appState.selectedLines.size > 1 ? 's' : ''} selected</span>
    <Button size="sm" onclick={createGroup}>Group selected</Button>
    <Button size="sm" variant="destructive" onclick={deleteSelectedLines}>Delete</Button>
    <Button size="sm" variant="outline" onclick={() => appState.selectedLines = new Set()}>Clear</Button>
  </div>
{/if}

<div class="flex flex-1 overflow-hidden">
  <div class="relative overflow-hidden" style="width: {dividerX}%">
    <DocumentViewer
      bind:this={docViewer}
      imageUrl={appState.imageUrl}
      lines={appState.htr.lines}
      currentLine={appState.htr.currentLine}
      hoveredLine={appState.hoveredLine}
      onHoverLine={(i) => appState.hoveredLine = i}
      stage={appState.htr.stage}
      selectedLines={appState.selectedLines}
      onSelectLine={handleSelectLine}
      onMarqueeSelect={handleMarqueeSelect}
      onRedetectRegion={(x, y, w, h) => appState.htr.redetectRegion(x, y, w, h)}
      groups={appState.groups}
      selectMode={appState.selectMode}
    />
  </div>
  <div
    class="w-[5px] shrink-0 cursor-col-resize touch-none transition-colors hover:bg-primary"
    class:bg-primary={isDraggingDivider}
    onpointerdown={onDividerPointerDown}
    onpointermove={onDividerPointerMove}
    onpointerup={onDividerPointerUp}
    role="separator"
  ></div>
  <div class="overflow-hidden border-l border-border" style="width: {100 - dividerX}%">
    <TranscriptionPanel
      lines={appState.htr.lines}
      currentLine={appState.htr.currentLine}
      currentText={appState.htr.currentText}
      hoveredLine={appState.hoveredLine}
      onHoverLine={(i) => appState.hoveredLine = i}
      selectedLines={appState.selectedLines}
      onSelectLine={handleSelectLine}
      groups={appState.groups}
      onToggleGroup={toggleGroup}
      onRenameGroup={renameGroup}
      onDeleteGroup={deleteGroup}
      onFocusGroup={(indices) => docViewer?.focusLines(indices)}
      onFocusLine={(i) => docViewer?.focusLines([i])}
      onEditLine={(i, text) => { if (appState.htr.lines[i]) appState.htr.lines[i].text = text; }}
      selectMode={appState.selectMode}
    />
  </div>
</div>

{#if appState.htr.stage !== 'idle' || appState.htr.modelsReady}
  <StatusBar
    stage={appState.htr.stage}
    currentLine={appState.htr.currentLine}
    totalLines={appState.htr.lines.length}
  />
{/if}
```

**Step 5: Delete old App.svelte**

```bash
rm src/App.svelte
```

**Step 6: Verify full flow**

Run: `npm run dev`
1. Navigate to `/` — should show model manager or upload
2. Upload image — should navigate to `/viewer`
3. All existing functionality (select, group, transcribe, delete) should work

**Step 7: Commit**

```bash
git add -A
git commit -m "create viewer page and restyle all components with Tailwind"
```

---

### Task 9: Move static assets to SvelteKit static directory

**Files:**
- Move: `public/demo.jpg` → `static/demo.jpg`
- Move: `public/vite.svg` → `static/favicon.ico` (or remove)
- Move WASM/ORT files if any are in `public/`

**Step 1: Move static assets**

SvelteKit uses `static/` instead of `public/` for static files:

```bash
mkdir -p static
cp public/demo.jpg static/
# Note: models stay in public/ since they're gitignored and fetched at runtime
```

Update `src/app.html` favicon if needed.

**Step 2: Commit**

```bash
git add static/ src/app.html
git commit -m "move static assets to SvelteKit static directory"
```

---

### Task 10: Final verification and cleanup

**Step 1: Run type check**

```bash
npm run check
```

Fix any type errors.

**Step 2: Run dev server and test all features**

```bash
npm run dev
```

Test:
- `/` loads, models download
- Upload image navigates to `/viewer`
- Line detection + transcription works
- Select mode, grouping, delete work
- Dark/light mode toggle works
- Zoom controls work
- New image button returns to `/`

**Step 3: Run Storybook**

```bash
npm run storybook
```

Verify button, badge, progress components render.

**Step 4: Clean up unused files**

Remove any remaining old files:
```bash
rm -f src/App.svelte src/main.ts index.html
```

**Step 5: Final commit**

```bash
git add -A
git commit -m "complete UI stack migration to SvelteKit + Tailwind v4 + bits-ui"
```
