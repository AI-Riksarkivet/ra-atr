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

## Phase 2 (deferred)

- User accounts / HF OAuth
- Submit transcription corrections
- Review/moderation workflow
- Leaderboard / contribution stats
- Version history per page

## Tech Stack

- **Frontend**: Svelte 5, Tailwind, virtual scroll
- **Backend**: FastAPI, LanceDB, pyarrow
- **Storage**: HF Buckets (S3-compatible, Xet-backed)
- **Embeddings**: Snowflake Arctic Embed L v2.0 (256 dims)
- **GPU**: Ray Serve + ONNX Runtime (optional)
- **Thumbnails**: Pre-generated 128×128 WebP
