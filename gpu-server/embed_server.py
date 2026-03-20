"""Lightweight embedding server — Snowflake Arctic Embed on GPU."""

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

EMBED_MODEL = os.environ.get("EMBED_MODEL", "Snowflake/snowflake-arctic-embed-l-v2.0")
EMBED_DIM = int(os.environ.get("EMBED_DIM", "256"))

app = FastAPI(title="Lejonet Embed Server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

model: SentenceTransformer | None = None


def get_model() -> SentenceTransformer:
    global model
    if model is None:
        print(f"Loading {EMBED_MODEL} (dim={EMBED_DIM})...")
        model = SentenceTransformer(EMBED_MODEL, truncate_dim=EMBED_DIM)
        print("Model loaded.")
    return model


class EmbedRequest(BaseModel):
    texts: list[str]
    mode: str = "document"


class EmbedResponse(BaseModel):
    vectors: list[list[float]]
    dim: int
    model: str


@app.get("/health")
def health():
    return {"status": "ok", "model": EMBED_MODEL, "dim": EMBED_DIM, "loaded": model is not None}


MAX_CHARS = 2000  # Truncate to ~500 tokens worth of text


@app.post("/embed", response_model=EmbedResponse)
def embed(body: EmbedRequest):
    m = get_model()
    texts = [t[:MAX_CHARS] for t in body.texts]
    if body.mode == "query":
        if len(texts) != 1:
            raise HTTPException(400, "Query mode accepts exactly one text")
        vec = m.encode(f"query: {texts[0]}", normalize_embeddings=True)
        vectors = [vec.tolist()]
    else:
        vecs = m.encode(texts, normalize_embeddings=True, show_progress_bar=False, batch_size=128)
        vectors = [v.tolist() for v in vecs]
    return EmbedResponse(vectors=vectors, dim=len(vectors[0]) if vectors else 0, model=EMBED_MODEL)
