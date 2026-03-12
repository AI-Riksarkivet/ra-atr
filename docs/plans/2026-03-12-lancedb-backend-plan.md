# LanceDB Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a collaborative transcription backend on a free HF Space so users can contribute and share HTR transcriptions of Riksarkivet volumes.

**Architecture:** FastAPI + LanceDB embedded in a Docker HF Space, with HF OAuth for auth and a HF Dataset repo for persistent storage. The Svelte frontend gets a "Contribute" button and lazy image loading.

**Tech Stack:** Python (FastAPI, LanceDB, huggingface_hub, pyarrow), Svelte 5 (frontend), Docker (HF Space)

---

### Task 1: Backend scaffold — Dockerfile, requirements, health endpoint

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/requirements.txt`
- Create: `backend/app.py`
- Create: `backend/README.md`

**Step 1: Create `backend/requirements.txt`**

```
fastapi[standard]>=0.115,<1
uvicorn[standard]>=0.30,<1
lancedb>=0.20,<1
pyarrow>=18,<19
huggingface_hub>=0.27,<1
```

**Step 2: Create `backend/app.py` with health endpoint and CORS**

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: init DB (Task 2)
    yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}
```

**Step 3: Create `backend/Dockerfile`**

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
```

**Step 4: Create `backend/README.md`** (HF Space metadata)

```markdown
---
title: Lejonet Transcription Backend
emoji: 🦁
colorFrom: yellow
colorTo: orange
sdk: docker
app_port: 7860
hf_oauth: true
hf_oauth_scopes:
  - openid
  - profile
---
```

**Step 5: Test locally**

```bash
cd backend && pip install -r requirements.txt && uvicorn app:app --port 7860 &
curl http://localhost:7860/health
# Expected: {"status":"ok"}
```

**Step 6: Commit**

```bash
git add backend/
git commit -m "feat: scaffold backend with FastAPI, Dockerfile, health endpoint"
```

---

### Task 2: LanceDB table setup and cold-start from HF Dataset repo

**Files:**
- Modify: `backend/app.py`

**Step 1: Add DB initialization in lifespan**

Add to `app.py`:

```python
import os
import lancedb
import pyarrow as pa
from huggingface_hub import hf_hub_download, HfApi

DATASET_REPO = os.environ.get("DATASET_REPO", "your-username/lejonet-transcriptions")
TABLE_NAME = "transcriptions"
DB_PATH = "/tmp/lancedb"

SCHEMA = pa.schema([
    pa.field("id", pa.string()),
    pa.field("version", pa.int32()),
    pa.field("reference_code", pa.string()),
    pa.field("manifest_id", pa.string()),
    pa.field("page_number", pa.int32()),
    pa.field("group_name", pa.string()),
    pa.field("group_rect_x", pa.float32()),
    pa.field("group_rect_y", pa.float32()),
    pa.field("group_rect_w", pa.float32()),
    pa.field("group_rect_h", pa.float32()),
    pa.field("line_index", pa.int32()),
    pa.field("bbox_x", pa.float32()),
    pa.field("bbox_y", pa.float32()),
    pa.field("bbox_w", pa.float32()),
    pa.field("bbox_h", pa.float32()),
    pa.field("text", pa.string()),
    pa.field("confidence", pa.float32()),
    pa.field("source", pa.string()),
    pa.field("contributor", pa.string()),
    pa.field("created_at", pa.timestamp("ms")),
])

db = None
table = None

def init_db():
    global db, table
    db = lancedb.connect(DB_PATH)

    # Try loading from HF Dataset repo
    try:
        local_path = hf_hub_download(
            repo_id=DATASET_REPO,
            filename="transcriptions.parquet",
            repo_type="dataset",
        )
        pq_table = pa.parquet.read_table(local_path)
        table = db.create_table(TABLE_NAME, pq_table, mode="overwrite")
        print(f"Loaded {table.count_rows()} rows from dataset repo")
    except Exception as e:
        print(f"No existing data found ({e}), creating empty table")
        table = db.create_table(TABLE_NAME, schema=SCHEMA, mode="overwrite")
```

**Step 2: Update lifespan to call init_db**

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield
```

**Step 3: Test locally**

```bash
cd backend && python -c "from app import init_db; init_db(); print('OK')"
# Expected: "No existing data found (...), creating empty table" then "OK"
```

**Step 4: Commit**

```bash
git add backend/app.py
git commit -m "feat: add LanceDB table init with cold-start from HF dataset repo"
```

---

### Task 3: GET /transcriptions/{manifest_id} — fetch latest transcriptions

**Files:**
- Modify: `backend/app.py`

**Step 1: Add GET endpoint**

```python
from fastapi import HTTPException

@app.get("/transcriptions/{manifest_id}")
def get_transcriptions(manifest_id: str):
    if table is None:
        raise HTTPException(503, "Database not initialized")

    rows = table.search().where(f"manifest_id = '{manifest_id}'").to_arrow()
    if len(rows) == 0:
        return {"manifest_id": manifest_id, "groups": []}

    # Convert to pandas for grouping
    df = rows.to_pandas()

    # Keep only latest version per id
    latest = df.loc[df.groupby("id")["version"].idxmax()]

    # Group by page + group_name
    groups = []
    for (page, gname), gdf in latest.groupby(["page_number", "group_name"]):
        first = gdf.iloc[0]
        lines = []
        for _, row in gdf.sort_values("line_index").iterrows():
            lines.append({
                "line_index": int(row["line_index"]),
                "bbox": {"x": float(row["bbox_x"]), "y": float(row["bbox_y"]),
                         "w": float(row["bbox_w"]), "h": float(row["bbox_h"])},
                "text": row["text"],
                "confidence": float(row["confidence"]),
                "source": row["source"],
                "contributor": row["contributor"],
            })
        groups.append({
            "page_number": int(page),
            "group_name": gname,
            "group_rect": {"x": float(first["group_rect_x"]), "y": float(first["group_rect_y"]),
                           "w": float(first["group_rect_w"]), "h": float(first["group_rect_h"])},
            "lines": lines,
        })

    return {"manifest_id": manifest_id, "groups": groups}
```

**Step 2: Test locally**

```bash
curl http://localhost:7860/transcriptions/R0003221
# Expected: {"manifest_id":"R0003221","groups":[]}
```

**Step 3: Commit**

```bash
git add backend/app.py
git commit -m "feat: add GET /transcriptions endpoint returning latest versions"
```

---

### Task 4: POST /transcriptions/{manifest_id} — contribute transcriptions

**Files:**
- Modify: `backend/app.py`

**Step 1: Add Pydantic models and POST endpoint**

```python
from pydantic import BaseModel
from datetime import datetime, timezone
from fastapi import Request
from huggingface_hub import attach_huggingface_oauth, parse_huggingface_oauth

# After app creation:
attach_huggingface_oauth(app)

class BBoxInput(BaseModel):
    x: float
    y: float
    w: float
    h: float

class LineInput(BaseModel):
    line_index: int
    bbox: BBoxInput
    text: str
    confidence: float
    source: str  # "htr" or "human"

class GroupInput(BaseModel):
    page_number: int
    group_name: str
    group_rect: BBoxInput
    lines: list[LineInput]

class ContributeRequest(BaseModel):
    reference_code: str
    groups: list[GroupInput]

@app.post("/transcriptions/{manifest_id}")
def contribute(manifest_id: str, body: ContributeRequest, request: Request):
    oauth = parse_huggingface_oauth(request)
    if oauth is None:
        raise HTTPException(401, "Login with Hugging Face required")

    username = oauth.user_info.preferred_username
    now = datetime.now(timezone.utc)

    # Build rows
    new_rows = []
    for group in body.groups:
        for line in group.lines:
            line_id = f"{manifest_id}/{group.page_number}_{group.group_name}_{line.line_index}"

            # Get current max version for this id
            existing = table.search().where(f"id = '{line_id}'").to_arrow()
            max_version = 0
            if len(existing) > 0:
                max_version = existing.column("version").to_pylist()
                max_version = max(max_version) if max_version else 0

            new_rows.append({
                "id": line_id,
                "version": max_version + 1,
                "reference_code": body.reference_code,
                "manifest_id": manifest_id,
                "page_number": group.page_number,
                "group_name": group.group_name,
                "group_rect_x": group.group_rect.x,
                "group_rect_y": group.group_rect.y,
                "group_rect_w": group.group_rect.w,
                "group_rect_h": group.group_rect.h,
                "line_index": line.line_index,
                "bbox_x": line.bbox.x,
                "bbox_y": line.bbox.y,
                "bbox_w": line.bbox.w,
                "bbox_h": line.bbox.h,
                "text": line.text,
                "confidence": line.confidence,
                "source": line.source,
                "contributor": username,
                "created_at": now,
            })

    if new_rows:
        table.add(new_rows)

    return {"status": "ok", "lines_added": len(new_rows), "contributor": username}
```

**Step 2: Commit**

```bash
git add backend/app.py
git commit -m "feat: add POST /transcriptions with HF OAuth and versioned rows"
```

---

### Task 5: CommitScheduler for persistent storage

**Files:**
- Modify: `backend/app.py`

**Step 1: Add scheduled flush to HF Dataset repo**

```python
from huggingface_hub import CommitScheduler
from pathlib import Path
import pyarrow.parquet as pq

PARQUET_DIR = Path("/tmp/parquet_export")
PARQUET_DIR.mkdir(exist_ok=True)

scheduler = None

def init_scheduler():
    global scheduler
    # Only run scheduler in HF Space (HF_TOKEN is set automatically)
    if os.environ.get("SPACE_ID"):
        scheduler = CommitScheduler(
            repo_id=DATASET_REPO,
            repo_type="dataset",
            folder_path=PARQUET_DIR,
            every=10,  # minutes
        )

def flush_to_parquet():
    """Export full LanceDB table to parquet for CommitScheduler to push."""
    if table is None:
        return
    arrow_table = table.to_arrow()
    pq.write_table(arrow_table, PARQUET_DIR / "transcriptions.parquet")
```

**Step 2: Call flush after each POST and init scheduler in lifespan**

In `contribute()` endpoint, after `table.add(new_rows)`:
```python
    flush_to_parquet()
```

In lifespan:
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    init_scheduler()
    yield
```

**Step 3: Commit**

```bash
git add backend/app.py
git commit -m "feat: add CommitScheduler to flush transcriptions to HF dataset repo"
```

---

### Task 6: GET /transcriptions/{manifest_id}/history

**Files:**
- Modify: `backend/app.py`

**Step 1: Add history endpoint**

```python
@app.get("/transcriptions/{manifest_id}/history")
def get_history(manifest_id: str):
    if table is None:
        raise HTTPException(503, "Database not initialized")

    rows = table.search().where(f"manifest_id = '{manifest_id}'").to_arrow()
    if len(rows) == 0:
        return {"manifest_id": manifest_id, "contributions": []}

    df = rows.to_pandas()
    contributions = (
        df.groupby(["contributor", "created_at"])
        .agg(lines=("id", "count"))
        .reset_index()
        .sort_values("created_at", ascending=False)
    )

    return {
        "manifest_id": manifest_id,
        "contributions": [
            {"contributor": r["contributor"],
             "created_at": r["created_at"].isoformat(),
             "lines": int(r["lines"])}
            for _, r in contributions.iterrows()
        ],
    }
```

**Step 2: Commit**

```bash
git add backend/app.py
git commit -m "feat: add GET /transcriptions/history endpoint"
```

---

### Task 7: Frontend — lazy image loading for Riksarkivet imports

**Files:**
- Modify: `src/lib/types.ts` — add optional `pageNumber` and `manifestId` to `ImageDocument`
- Modify: `src/lib/stores/app-state.svelte.ts` — add `addPlaceholderDocument()` and lazy load method
- Modify: `src/lib/riksarkivet.ts` — change `importVolume` to create placeholders without fetching images
- Modify: `src/lib/components/RiksarkivetImport.svelte` — update callbacks
- Modify: `src/routes/+page.svelte` — update Riksarkivet import handlers

**Step 1: Add `pageNumber` and `manifestId` to `ImageDocument`**

In `src/lib/types.ts`, add to `ImageDocument`:
```typescript
export interface ImageDocument {
  id: string;
  name: string;
  imageUrl: string;
  imageData: ArrayBuffer;
  lines: Line[];
  groups: LineGroup[];
  groupCounter: number;
  /** Riksarkivet metadata for lazy loading */
  manifestId?: string;
  pageNumber?: number;
  /** True if image has not been fetched yet */
  placeholder?: boolean;
}
```

**Step 2: Add placeholder document method to app-state**

In `src/lib/stores/app-state.svelte.ts`, add:
```typescript
addPlaceholderDocument(name: string, manifestId: string, pageNumber: number): string {
    this.docCounter++;
    const id = `doc-${this.docCounter}`;
    const doc: ImageDocument = {
      id,
      name,
      imageUrl: '',
      imageData: new ArrayBuffer(0),
      lines: [],
      groups: [],
      groupCounter: 0,
      manifestId,
      pageNumber,
      placeholder: true,
    };
    this.documents = [...this.documents, doc];
    return id;
}
```

**Step 3: Add lazy load method that fetches image on demand**

In `src/lib/stores/app-state.svelte.ts`, add:
```typescript
async loadDocumentImage(docId: string) {
    const doc = this.documents.find(d => d.id === docId);
    if (!doc || !doc.placeholder || !doc.manifestId || !doc.pageNumber) return;

    const { fetchPageImage } = await import('$lib/riksarkivet');
    const result = await fetchPageImage(doc.manifestId, doc.pageNumber);
    if (result) {
      doc.imageUrl = result.previewUrl;
      doc.imageData = result.imageData;
      doc.placeholder = false;
      this.documents = [...this.documents];
      // Send image to workers
      this.htr.addImage(doc.id, result.imageData.slice(0));
    }
}
```

**Step 4: Update `switchDocument` to trigger lazy load**

In `src/lib/stores/app-state.svelte.ts`, modify `switchDocument`:
```typescript
switchDocument(docId: string) {
    if (docId === this.activeDocumentId) return;
    this.activeDocumentId = docId;
    this.hoveredLine = -1;
    this.selectedLines = new Set();
    // Lazy load image if placeholder
    this.loadDocumentImage(docId);
}
```

**Step 5: Update `importVolume` to return metadata instead of fetching images**

In `src/lib/riksarkivet.ts`, add a new function:
```typescript
export async function resolveVolume(
  referenceCode: string,
  onProgress: (progress: ImportProgress) => void,
  pageRange?: { start: number; end: number },
): Promise<{ manifestId: string; pages: number[] }> {
  onProgress({ stage: 'resolving', currentPage: 0, totalPages: 0, manifestId: '' });
  const manifestId = await resolveManifestId(referenceCode);

  onProgress({ stage: 'manifest', currentPage: 0, totalPages: 0, manifestId });
  const volumePages = await getPageCount(manifestId);

  if (volumePages === 0) throw new Error('No pages found in this volume');

  const start = pageRange ? Math.max(1, pageRange.start) : 1;
  const end = pageRange ? Math.min(pageRange.end, volumePages) : volumePages;
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  onProgress({ stage: 'done', currentPage: pages.length, totalPages: pages.length, manifestId });
  return { manifestId, pages };
}
```

**Step 6: Update `RiksarkivetImport.svelte` to use `resolveVolume`**

Replace `importVolume` call with `resolveVolume`, callback creates placeholder docs.

**Step 7: Update `+page.svelte` handlers**

Replace `handleRiksarkivetPage` with placeholder creation:
```typescript
function handleRiksarkivetResolved(manifestId: string, pages: number[]) {
    for (const page of pages) {
      const padded = String(page).padStart(5, '0');
      const docId = appState.addPlaceholderDocument(
        `${manifestId}_${padded}.jpg`, manifestId, page
      );
      if (!appState.activeDocumentId) {
        appState.activeDocumentId = docId;
        appState.loadDocumentImage(docId);
      }
    }
    appState.selectMode = true;
    goto('/viewer');
}
```

**Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/stores/app-state.svelte.ts src/lib/riksarkivet.ts \
  src/lib/components/RiksarkivetImport.svelte src/routes/+page.svelte
git commit -m "feat: lazy image loading for Riksarkivet imports"
```

---

### Task 8: Frontend — backend API client

**Files:**
- Create: `src/lib/api.ts`

**Step 1: Create API client**

```typescript
const API_BASE = import.meta.env.VITE_API_URL || 'https://your-space.hf.space';

export interface TranscriptionGroup {
  page_number: number;
  group_name: string;
  group_rect: { x: number; y: number; w: number; h: number };
  lines: {
    line_index: number;
    bbox: { x: number; y: number; w: number; h: number };
    text: string;
    confidence: number;
    source: string;
    contributor: string;
  }[];
}

export async function fetchTranscriptions(manifestId: string): Promise<TranscriptionGroup[]> {
  const res = await fetch(`${API_BASE}/transcriptions/${manifestId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.groups ?? [];
}

export async function contributeTranscriptions(
  manifestId: string,
  referenceCode: string,
  groups: TranscriptionGroup[],
  token: string,
): Promise<{ lines_added: number; contributor: string }> {
  const res = await fetch(`${API_BASE}/transcriptions/${manifestId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ reference_code: referenceCode, groups }),
  });
  if (!res.ok) throw new Error(`Contribute failed: ${res.status}`);
  return res.json();
}
```

**Step 2: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: add backend API client for transcriptions"
```

---

### Task 9: Frontend — pre-populate transcriptions on Riksarkivet import

**Files:**
- Modify: `src/routes/+page.svelte` — after resolving volume, check backend for existing transcriptions
- Modify: `src/lib/stores/app-state.svelte.ts` — add method to populate lines/groups from backend data

**Step 1: After creating placeholder docs, fetch existing transcriptions**

In the `handleRiksarkivetResolved` handler, after creating placeholders:
```typescript
// Check backend for existing transcriptions
const { fetchTranscriptions } = await import('$lib/api');
const existingGroups = await fetchTranscriptions(manifestId);
if (existingGroups.length > 0) {
    appState.populateFromBackend(manifestId, existingGroups);
}
```

**Step 2: Add `populateFromBackend` to app-state**

Reconstructs `Line[]` and `LineGroup[]` from the backend response, matching pages to placeholder documents by `pageNumber`.

**Step 3: Commit**

```bash
git add src/routes/+page.svelte src/lib/stores/app-state.svelte.ts
git commit -m "feat: pre-populate transcriptions from backend on Riksarkivet import"
```

---

### Task 10: Frontend — Contribute button

**Files:**
- Modify: `src/routes/viewer/+page.svelte` — add Contribute button to header or toolbar
- Modify: `src/lib/stores/app-state.svelte.ts` — add method to serialize current state for API

**Step 1: Add Contribute button to viewer**

Below the "Add images" button in the header area, add a "Contribute" button that:
1. Collects all documents with `manifestId` set
2. Serializes their groups/lines into `GroupInput[]` format
3. Calls `contributeTranscriptions()`
4. Shows success/error feedback

**Step 2: Handle HF OAuth**

For auth, redirect to HF OAuth login flow. Store token in sessionStorage. The `contributeTranscriptions` call sends it as Bearer token.

**Step 3: Commit**

```bash
git add src/routes/viewer/+page.svelte src/lib/stores/app-state.svelte.ts
git commit -m "feat: add Contribute button with HF OAuth for sharing transcriptions"
```
