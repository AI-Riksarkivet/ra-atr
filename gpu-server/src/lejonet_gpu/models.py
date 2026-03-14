"""ONNX model session management."""

import os
from pathlib import Path

import onnxruntime as ort

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/models"))

# Model filenames
LAYOUT_MODEL = "rtmdet-regions.onnx"
YOLO_MODEL = "yolo-lines.onnx"
ENCODER_MODEL = "encoder.onnx"
DECODER_MODEL = "decoder.onnx"
TOKENIZER_FILE = "tokenizer.json"


def _providers() -> list[str]:
    """Get available execution providers, preferring GPU."""
    available = ort.get_available_providers()
    if "CUDAExecutionProvider" in available:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    if "ROCMExecutionProvider" in available:
        return ["ROCMExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


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
        return [
            name for name in [LAYOUT_MODEL, YOLO_MODEL, ENCODER_MODEL, DECODER_MODEL, TOKENIZER_FILE]
            if (self.models_dir / name).exists()
        ]

    def providers(self) -> list[str]:
        return _providers()
