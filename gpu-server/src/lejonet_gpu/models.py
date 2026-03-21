"""ONNX model session management with auto-download from HuggingFace."""

import logging
import os
from pathlib import Path

import onnxruntime as ort

logger = logging.getLogger(__name__)

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/models"))
HF_REPO = os.environ.get("HF_MODEL_REPO", "carpelan/htr-onnx-models")

# Model filenames
LAYOUT_MODEL = "rtmdet-regions.onnx"
YOLO_MODEL = "yolo-lines.onnx"
ENCODER_MODEL = "encoder.onnx"
DECODER_MODEL = "decoder.onnx"
TOKENIZER_FILE = "tokenizer.json"

ALL_MODELS = [LAYOUT_MODEL, YOLO_MODEL, ENCODER_MODEL, DECODER_MODEL, TOKENIZER_FILE]

# Embedding model (separate HF repo, loaded via sentence-transformers)
EMBED_MODEL = os.environ.get("EMBED_MODEL", "Snowflake/snowflake-arctic-embed-l-v2.0")
EMBED_DIM = int(os.environ.get("EMBED_DIM", "256"))


def _resolve_model(name: str, models_dir: Path = MODELS_DIR, repo: str = HF_REPO) -> Path:
    """Find a model file — local first, then download from HuggingFace."""
    local = models_dir / name
    if local.exists():
        return local

    # Download from HF (uses HF cache, no extra disk copy)
    print(f"  Downloading {name} from {repo}...")
    from huggingface_hub import hf_hub_download

    return Path(hf_hub_download(repo_id=repo, filename=name))


def download_models(models_dir: Path = MODELS_DIR, repo: str = HF_REPO) -> None:
    """Ensure all models are available (local or HF cache)."""
    for name in ALL_MODELS:
        _resolve_model(name, models_dir, repo)


def _providers() -> list[str]:
    """Get available GPU execution providers. Fails if no GPU found."""
    available = ort.get_available_providers()
    for gpu in ["CUDAExecutionProvider", "ROCMExecutionProvider", "MIGraphXExecutionProvider"]:
        if gpu in available:
            return [gpu]
    raise RuntimeError(f"No GPU execution provider found. Available: {available}. Install onnxruntime-gpu (NVIDIA) or onnxruntime-rocm (AMD).")


def _create_session(model_path: Path) -> ort.InferenceSession:
    providers = _providers()
    print(f"Loading {model_path.name} with providers: {providers}")
    return ort.InferenceSession(
        str(model_path),
        providers=providers,
        sess_options=_session_options(),
    )


def _session_options() -> ort.SessionOptions:
    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return opts


class ModelStore:
    """Lazy-loading model session store."""

    def __init__(self, models_dir: Path = MODELS_DIR):
        self.models_dir = models_dir
        self._sessions: dict[str, ort.InferenceSession] = {}

    def get(self, name: str) -> ort.InferenceSession:
        if name not in self._sessions:
            path = _resolve_model(name, self.models_dir)
            self._sessions[name] = _create_session(path)
        return self._sessions[name]

    @property
    def layout(self) -> ort.InferenceSession:
        return self.get(LAYOUT_MODEL)

    @property
    def yolo(self) -> ort.InferenceSession:
        return self.get(YOLO_MODEL)

    @property
    def encoder(self) -> ort.InferenceSession:
        return self.get(ENCODER_MODEL)

    @property
    def decoder(self) -> ort.InferenceSession:
        return self.get(DECODER_MODEL)

    def available_models(self) -> list[str]:
        result = []
        for name in ALL_MODELS:
            if (self.models_dir / name).exists():
                result.append(name)
            else:
                # Check HF cache
                try:
                    from huggingface_hub import try_to_load_from_cache

                    cached = try_to_load_from_cache(HF_REPO, name)
                    if cached and isinstance(cached, str):
                        result.append(name)
                except Exception:
                    logger.debug("Could not check HF cache for model %s", name)
        return result

    def providers(self) -> list[str]:
        return _providers()


class EmbedStore:
    """Lazy-loading sentence-transformers embedding model."""

    def __init__(self):
        self._model = None

    @property
    def model(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(EMBED_MODEL, truncate_dim=EMBED_DIM)
            print(f"Loaded embedding model: {EMBED_MODEL} (dim={EMBED_DIM})")
        return self._model

    def encode_documents(self, texts: list[str], batch_size: int = 64) -> list[list[float]]:
        """Encode documents (no prefix for Arctic)."""
        all_vecs = []
        for i in range(0, len(texts), batch_size):
            sub = texts[i : i + batch_size]
            vecs = self.model.encode(sub, normalize_embeddings=True, show_progress_bar=False)
            all_vecs.extend(v.tolist() for v in vecs)
        return all_vecs

    def encode_query(self, query: str) -> list[float]:
        """Encode a search query (Arctic requires 'query: ' prefix)."""
        vec = self.model.encode(f"query: {query}", normalize_embeddings=True)
        return vec.tolist()
