# LanceDB Backend Design

## Summary

Add a collaborative transcription backend using LanceDB on a free HF Space, allowing users to contribute and share transcriptions of Riksarkivet volumes. HF OAuth provides usernames.

## Architecture

```
Svelte App (browser)  ◄──fetch──►  HF Space (FastAPI + LanceDB)
                                          │
                                   CommitScheduler
                                          │
                                          ▼
                                   HF Dataset Repo (Parquet, free)
```

- **HF Space (free tier)**: 2 vCPU, 16GB RAM, ephemeral disk
- **LanceDB**: Embedded, rebuilt on cold start from dataset repo
- **HF Dataset Repo**: Free persistent storage, Parquet files flushed periodically
- **HF OAuth**: `hf_oauth: true` in Space metadata, provides username via `preferred_username`

## Data Model

One LanceDB table: `transcriptions`. Each row = one transcribed line, versioned.

| Field | Type | Description |
|-------|------|-------------|
| id | string | `{manifest_id}/{page}_{group}_{line}` |
| version | int | Auto-incrementing per id |
| reference_code | string | e.g. `SE/RA/420177/02/A I a/3` |
| manifest_id | string | e.g. `R0003221` |
| page_number | int | 1-based page in volume |
| group_name | string | Group name from the app |
| group_rect_x | float | Region bounds on page |
| group_rect_y | float | |
| group_rect_w | float | |
| group_rect_h | float | |
| line_index | int | Line number within the group |
| bbox_x | float | Line bounding box |
| bbox_y | float | |
| bbox_w | float | |
| bbox_h | float | |
| text | string | The transcription |
| confidence | float | HTR confidence or 1.0 for human |
| source | string | "htr" or "human" |
| contributor | string | HF username |
| created_at | timestamp | When contributed |

Querying latest: filter by manifest_id, group by id, take max version.

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /transcriptions/{manifest_id} | No | All latest-version lines for a volume |
| POST | /transcriptions/{manifest_id} | Yes | Contribute transcriptions (array of groups with lines) |
| GET | /transcriptions/{manifest_id}/history | No | Version history (who, when) |
| GET | /health | No | Health check |

## Frontend Changes

### Lazy image loading
- When importing from Riksarkivet, create `ImageDocument` entries **without** fetching images
- Only fetch the page image when the user selects that page in the document tree
- Reduces memory usage significantly for large volumes

### Contribute button
- Added to viewer page
- Sends current transcriptions to `POST /transcriptions/{manifest_id}`
- Requires HF login (OAuth redirect)

### Pre-populate existing transcriptions
- On Riksarkivet import, call `GET /transcriptions/{manifest_id}`
- If transcriptions exist, reconstruct groups and lines from backend data
- User sees existing work and can edit/improve

## Backend Lifecycle

### Cold start
1. Space wakes from sleep
2. Download Parquet from HF Dataset repo
3. Load into LanceDB table
4. Ready to serve

### Writes
1. POST arrives with transcription data
2. Determine next version number per line id
3. Append rows to LanceDB
4. CommitScheduler flushes Parquet to dataset repo periodically

## File Structure

```
backend/
├── Dockerfile
├── requirements.txt    # fastapi, lancedb, huggingface_hub, pyarrow
├── app.py              # All endpoints, OAuth, LanceDB setup
└── README.md           # HF Space metadata (hf_oauth: true)
```
