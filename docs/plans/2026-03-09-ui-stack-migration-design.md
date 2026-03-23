# UI Stack Migration Design

## Goal

Migrate ra-atr from hand-written CSS + plain Vite to the same stack as AI-Riksarkivet/hcp:
SvelteKit, Tailwind CSS v4, bits-ui, tailwind-variants, Storybook 10, lucide-svelte, mode-watcher.

## Tech Stack

| Library | Purpose |
|---------|---------|
| `@sveltejs/kit` | Framework (replaces plain Vite+Svelte) |
| `tailwindcss` v4 + `@tailwindcss/vite` | Utility-first CSS |
| `bits-ui` | Unstyled accessible component primitives |
| `tailwind-variants` (`tv()`) | Variant-driven component styling |
| `storybook` 10 + `@storybook/sveltekit` | Component development/testing |
| `@storybook/addon-svelte-csf` | Modern Svelte story format |
| `lucide-svelte` | Icons |
| `mode-watcher` | Dark/light mode toggle |
| `svelte-sonner` | Toast notifications |
| `clsx` + `tailwind-merge` | Class composition (`cn()` utility) |

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Model loading + image upload |
| `/viewer` | Document workspace (DocumentViewer + TranscriptionPanel) |

Image data passed from `/` to `/viewer` via shared state module. Navigate after upload.

## Component Structure

```
src/
├── routes/
│   ├── +layout.svelte        # App shell, mode-watcher, header
│   ├── +page.svelte           # Model loading + upload
│   └── viewer/
│       └── +page.svelte       # Document workspace
├── lib/
│   ├── components/
│   │   ├── ui/                # Copied from hcp, trimmed
│   │   │   ├── button/
│   │   │   ├── badge/
│   │   │   ├── dialog/
│   │   │   ├── progress/
│   │   │   ├── tooltip/
│   │   │   ├── separator/
│   │   │   └── ...
│   │   ├── document-viewer/
│   │   ├── transcription-panel/
│   │   ├── upload-panel/
│   │   ├── model-manager/
│   │   ├── status-bar/
│   │   └── layout/
│   │       ├── app-header.svelte
│   │       └── app-sidebar.svelte
│   ├── stores/
│   │   └── app-state.svelte.ts  # Shared state between routes
│   ├── utils/
│   │   └── cn.ts                # clsx + tailwind-merge
│   ├── canvas.ts                # Untouched
│   ├── worker-state.svelte.ts   # Untouched
│   ├── types.ts                 # Untouched
│   └── worker-ortw.ts           # Untouched
```

## Styling

- All scoped `<style>` blocks replaced with Tailwind utility classes
- `app.css` uses Tailwind v4 `@theme inline` with oklch color tokens
- Dark mode via `.dark` class (mode-watcher), not `prefers-color-scheme`
- Components use `tv()` for variant definitions
- `cn()` utility for conditional class merging

## What Stays Unchanged

- `canvas.ts` (CanvasController) — pure logic, no UI
- `worker-state.svelte.ts` — worker communication
- `worker-ortw.ts` — ONNX inference worker
- `types.ts` — type definitions
- All WASM/ONNX model files and export scripts

## Migration Strategy

1. Install dependencies, configure SvelteKit + Tailwind v4
2. Copy hcp's `ui/` components + `cn()` utility
3. Set up Storybook configuration
4. Create SvelteKit routes + layout with mode-watcher
5. Create shared app state store for cross-route data
6. Migrate each domain component (replace scoped CSS with Tailwind)
7. Wire up dark/light toggle in header
8. Verify WASM worker and ONNX inference still work
