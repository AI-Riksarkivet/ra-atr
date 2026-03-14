# Layout Detection — Design

**Goal:** Add a "Layout" button to the header that runs PP-DocLayout-L on the active page, creating named groups from detected layout regions.

## Flow

1. User loads a page, clicks "Layout" button in header
2. A layout detection worker loads `pp-doclayout-l.onnx` (124MB, cached)
3. Preprocesses page image to 640x640, runs inference
4. Filters detections by confidence > 0.5
5. Creates a group per detection: name = category label (e.g. "Text", "Table", "Header"), rect = bounding box
6. Groups appear in the transcription panel tree — user can then run line detection within them manually

## Model

- PP-DocLayout-L from PaddlePaddle
- 30.9M params, 124MB ONNX
- Input: [1, 3, 640, 640] + im_shape + scale_factor
- Output: up to 300 detections [class_id, score, x1, y1, x2, y2]
- 23 categories: paragraph_title, image, text, number, abstract, content, figure_title, formula, table, table_title, reference, doc_title, footnote, header, algorithm, footer, seal, chart_title, chart, formula_number, header_image, footer_image, aside_text
- Confidence threshold: 0.5
- License: Apache 2.0

## Components

- `src/worker-layout.ts` — new web worker for layout inference
- `src/lib/preprocessing.ts` — add preprocessLayout (resize to 640x640, normalize)
- `src/lib/worker-state.svelte.ts` — add layout detection methods and model caching
- `src/lib/components/layout/app-header.svelte` — add Layout button
- `src/routes/viewer/+page.svelte` — wire button to trigger layout detection

No changes to: TranscriptionPanel, DocumentViewer, backend.
