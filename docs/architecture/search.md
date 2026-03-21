# Search Backend

The search backend provides catalog search and transcription storage.

## Repository

**[lejonet-search](https://github.com/carpelan/lejonet-search)** — FastAPI + LanceDB search backend

## Overview

| Component | Technology |
|-----------|-----------|
| Framework | FastAPI |
| Database | LanceDB |
| Port | 8000 |

## Features

- **Archive catalog** — Search 3.7M volumes from Riksarkivet's metadata
- **Transcription storage** — Save and retrieve user transcriptions with per-user isolation
- **Full-text search** — FTS index on catalog records

## Integration

The frontend proxies API requests to `localhost:8000` during development. Set `VITE_DISABLE_BACKEND=true` to run the frontend without the search backend.
