# Lejonet Search Explorer — Design

## Goal

A fast, scalable document search and browse interface for 50M+ transcribed historical pages. Read-only phase 1; crowdsourced corrections in phase 2.

## Architecture

```
Browser (static Svelte)
  ├── Infinite scroll thumbnail grid
  ├── Search bar (FTS + vector)
  └── Page viewer with transcription overlay
          │
          ▼
FastAPI (lightweight, HF Space Docker or local)
  ├── /search — FTS + vector search via LanceDB
  ├── /browse — paginated metadata for grid
  ├── /random — random page
  └── /page/:id — full transcription + image URL
          │
          ▼
HF Bucket (S3-compatible, Xet-backed)
  ├── LanceDB tables (transcriptions, embeddings, metadata)
  └── Thumbnails ({manifestId}_{pageNumber}.webp, 128×128)

Ray GPU Cluster (optional, attach for speed)
  ├── Arctic embedding for query vectors
  └── HTR pipeline for live transcription
```

## Data Model (LanceDB table)

| Column | Type | Notes |
|--------|------|-------|
| id | string | `{manifestId}_{pageNumber}` |
| manifest_id | string | Riksarkivet volume identifier |
| page_number | int | Page within volume |
| reference_code | string | `SE/GLA/12096/A I/5` |
| archive_code | string | `SE_GLA` |
| fonds_title | string | |
| series_title | string | |
| date_text | string | `1783--1792` |
| transcription | string | Full page text (all lines joined) |
| vector | float32[256] | Snowflake Arctic Embed L v2.0 |
| thumbnail_url | string | `{manifestId}_{pageNumber}.webp` |
| image_url | string | IIIF URL to full-resolution image |
| digitized | bool | |

## Storage Estimates (50M pages)

| Data | Size | HF Bucket cost |
|------|------|----------------|
| LanceDB (text + vectors + metadata) | ~100 GB | ~$1.20/mo |
| Thumbnails (128×128 WebP, ~3KB each) | ~150 GB | ~$1.80/mo |
| IVF-PQ vector index | ~5 GB | included |
| FTS tantivy index | ~10 GB | included |
| **Total** | **~265 GB** | **~$3/mo** |

## Search Modes

### Full-text search (always available)
- LanceDB tantivy FTS over transcription column
- Sub-50ms on server, no GPU needed
- Supports Swedish characters, prefix matching

### Vector search (with GPU cluster)
- Query embedded via Arctic on Ray cluster → vector sent to LanceDB ANN search
- IVF-PQ index for sub-10ms search over 50M vectors
- Semantic: "domstolsprotokoll" finds "domböcker", "tingsrätt", etc.

### Vector search (without GPU cluster)
- Fall back to local CPU embedding (slower, ~500ms per query)
- Or FTS-only mode

## Browse (Infinite Scroll)

- Virtual scrolling grid — only render visible thumbnails
- Backend serves paginated results: `/browse?offset=0&limit=100`
- Default sort: random or by archive/date
- Lazy-load thumbnails from HF Bucket CDN
- Click thumbnail → full page view with transcription overlay
- Filter sidebar: archive, date range, document type

## Thumbnail Naming

`{manifestId}_{pageNumber}.webp`

Example: `G0000093_00001.webp`

Stored flat in the HF Bucket, served directly via URL.

## Deployment Options

### HuggingFace (primary)
- **HF Bucket**: LanceDB tables + thumbnails ($3/mo for 50M pages)
- **HF Space (Docker)**: FastAPI + LanceDB reading from bucket (free tier)
- **Frontend**: Same Space or separate static Space

### Local development
- Same code, LanceDB points to local directory
- `make serve` starts backend + frontend

### Production (self-hosted)
- FastAPI behind nginx/Caddy
- LanceDB reads from local disk or S3-compatible storage
- Optional: Ray GPU cluster for fast embedding + HTR

## Performance Targets

| Operation | Target |
|-----------|--------|
| Vector search (50M rows) | < 100ms |
| FTS search | < 50ms |
| Browse page load (100 thumbnails) | < 200ms |
| Thumbnail load (single) | < 50ms (CDN cached) |

## Phase 2 — Crowdsourced Transcriptions

### Architecture

Separate write Space from the read Space:

```
Read Space (free/cheap)              Write Space (free)
  FastAPI + LanceDB                    FastAPI + SQLite
  read-only, fast                      HF OAuth login
  serves search/browse                 append-only transcription log
       │                                     │
       └──────── HF Bucket ─────────────────┘
                 (rebuilt periodically)
```

### Data model — append-only

No edits, no overwrites, no consensus. Every transcription is saved separately.

| Column | Type | Notes |
|--------|------|-------|
| id | string | UUID |
| user_id | string | HF username |
| manifest_id | string | Volume identifier |
| page_number | int | |
| line_index | int | |
| bbox | json | `{x, y, w, h}` |
| text | string | Transcribed text |
| source | string | `htr-trocr`, `htr-gpu`, `human`, `human-corrected` |
| confidence | float | Model confidence (0-1), null for human |
| created_at | timestamp | |

Multiple users can transcribe the same page — all rows are kept.
The read/search index picks the best transcription per page using a simple heuristic (human > human-corrected > high-confidence HTR > low-confidence HTR).

### Source tagging

| Source | Meaning | Training value |
|--------|---------|---------------|
| `htr-trocr` | WASM pipeline output | Bronze (pre-training) |
| `htr-gpu` | GPU server pipeline output | Bronze (pre-training) |
| `human` | User transcribed from scratch | Gold (fine-tuning) |
| `human-corrected` | User edited existing transcription | Gold (fine-tuning) |

### Automatic quality signals

No human review needed. Quality inferred from:

- **Confidence score** — TrOCR outputs per-line confidence. Low = likely wrong
- **Language model perplexity** — small Swedish LM scores gibberish high
- **Character n-gram frequency** — old Swedish has patterns, random misreads don't
- **Agreement** — if 2+ transcriptions exist, similarity between them = quality
- **Length ratio** — transcription length vs image dimensions, outliers are suspicious
- **Source** — human transcriptions weighted higher than HTR

### For VLM training

- Duplicates don't matter — multiple transcriptions of the same image add robustness
- Disagreements are useful — ambiguous handwriting has multiple valid readings
- Quality tiers: gold (human) for fine-tuning, bronze (HTR) for pre-training
- Each training sample: `(line_image_crop, text, confidence, source)`

### Deferred (phase 3)

- Leaderboard / contribution stats
- Active learning — prioritize pages where model is least confident for human review
- Gamification — show users pages that need transcription most

## Tech Stack

- **Frontend**: Svelte 5, Tailwind, virtual scroll
- **Backend**: FastAPI, LanceDB, pyarrow
- **Storage**: HF Buckets (S3-compatible, Xet-backed)
- **Embeddings**: Snowflake Arctic Embed L v2.0 (256 dims)
- **GPU**: Ray Serve + ONNX Runtime (optional)
- **Thumbnails**: Pre-generated 128×128 WebP
