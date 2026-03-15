"""ONNX model session management with auto-download from HuggingFace."""

import os
from pathlib import Path

import onnxruntime as ort

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/models"))
HF_REPO = os.environ.get("HF_MODEL_REPO", "carpelan/htr-onnx-models")

# Model filenames
LAYOUT_MODEL = "rtmdet-regions.onnx"
YOLO_MODEL = "yolo-lines.onnx"
ENCODER_MODEL = "encoder.onnx"
DECODER_MODEL = "decoder.onnx"
TOKENIZER_FILE = "tokenizer.json"

ALL_MODELS = [LAYOUT_MODEL, YOLO_MODEL, ENCODER_MODEL, DECODER_MODEL, TOKENIZER_FILE]


def download_models(models_dir: Path = MODELS_DIR, repo: str = HF_REPO) -> None:
    """Download missing models from HuggingFace."""
    missing = [m for m in ALL_MODELS if not (models_dir / m).exists()]
    if not missing:
        return

    print(f"Downloading {len(missing)} model(s) from {repo}...")
    from huggingface_hub import hf_hub_download

    models_dir.mkdir(parents=True, exist_ok=True)
    for name in missing:
        print(f"  Downloading {name}...")
        hf_hub_download(
            repo_id=repo,
            filename=name,
            local_dir=str(models_dir),
        )
    print("All models downloaded.")


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
            path = self.models_dir / name
            if not path.exists():
                download_models(self.models_dir)
            if not path.exists():
                raise FileNotFoundError(f"Model not found: {path}")
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
        return [name for name in [LAYOUT_MODEL, YOLO_MODEL, ENCODER_MODEL, DECODER_MODEL, TOKENIZER_FILE] if (self.models_dir / name).exists()]

    def providers(self) -> list[str]:
        return _providers()
