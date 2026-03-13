# Archive Catalog — Design

Index 7.6M Riksarkivet volume records into LanceDB with FTS and vector search, enabling users to discover interesting volumes to transcribe.

## Data source

44,770 EAD XML files from the 2022-12-16 Riksarkivet metadata export (`/home/m/Downloads/Riksarkivet-2022-12-16/`). Nine archive repositories (SE_RA, SE_LLA, SE_GLA, SE_HLA, SE_ViLA, SE_VALA, SE_ULA, SE_KrA, SE_ÖLA).

Hierarchy: Fonds → Series → **Volumes** (leaf nodes). Volumes are the searchable unit.

~2% of volumes are marked as digitized (`userestrict type="dao"`).

## Schema — `archive_catalog` LanceDB table

| Field | Type | Source |
|---|---|---|
| `id` | string | `{eadid}/{series_id}/{vol_id}` |
| `reference_code` | string | `SE/RA/1111/A1/1` (for OAI-PMH lookup) |
| `archive_code` | string | `SE_RA` etc. |
| `fonds_id` | string | `1111` |
| `fonds_title` | string | From `<unittitle>` |
| `fonds_description` | string | Top-level `<odd>` text |
| `creator` | string | From `<origination>/<corpname>` |
| `series_id` | string | `A1` |
| `series_title` | string | Series `<unittitle>` |
| `volume_id` | string | Volume `<unitid>` |
| `date_text` | string | Raw `<unitdate>` text |
| `date_start` | int32 | First year parsed from date_text |
| `date_end` | int32 | Last year parsed from date_text |
| `description` | string | Volume `<odd>/<p>` text |
| `digitized` | bool | `userestrict type="dao"` present |
| `search_text` | string | Concatenation: fonds_title + series_title + description + creator |
| `vector` | fixed_size_list[float32, 384] | Embedding of search_text |

Estimated ~7.6M rows. FTS ngram index on `search_text`. Vector index on `vector`.

## Ingestion — `backend/ingest_catalog.py`

One-time CLI script. Must be tested on sample files first before full run.

1. Parse XML files with `xml.etree.ElementTree`
2. Extract fonds → series → volume hierarchy, construct reference codes
3. Parse date ranges (regex for YYYY patterns, take min/max)
4. Batch-embed `search_text` with `intfloat/multilingual-e5-small` (384 dims)
5. Write to LanceDB in batches (10K rows)
6. Build FTS index after ingestion

Testing strategy:
- First: parse 1 file, print extracted rows, verify fields
- Then: parse 10 files from different archives, check consistency
- Then: parse 100 files, write to LanceDB, test search
- Finally: full 44K file run

## Search API

### `GET /catalog/search`

Query params: `q` (text), `digitized` (bool), `date_start` (int), `date_end` (int), `archive` (string), `mode` (fts|vector|hybrid, default hybrid), `limit` (default 50), `offset` (default 0).

Returns: `{ results: [{ reference_code, fonds_title, series_title, volume_id, date_text, description, digitized, score }], total: int }`

### `GET /catalog/{reference_code}`

Single volume detail.

## Frontend

Search UI in TranscriptionPanel or dedicated catalog browser. Results show volume cards. Digitized volumes get a "Load" button feeding reference_code into existing `resolveVolume` flow. Non-digitized shown grayed out.

Filters: date range, archive dropdown, digitized toggle.

## Unified search (future)

Single search bar queries both `archive_catalog` and `transcriptions`. Results grouped by source.
