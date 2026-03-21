"""Entry point for the GPU inference server with Ray Serve."""

import io
import logging

# --- Ray Serve Deployments ---
import numpy as np
import ray
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from ray import serve

from .detect import decode_yolo
from .layout import decode_rtmdet
from .models import TOKENIZER_FILE, ModelStore, _resolve_model
from .preprocessing import crop_region, preprocess_rtmdet, preprocess_trocr, preprocess_yolo
from .transcribe import Tokenizer, transcribe_line

logger = logging.getLogger(__name__)


@serve.deployment(num_replicas=1, ray_actor_options={"num_gpus": 0.25})
class LayoutDetector:
    def __init__(self):
        self.store = ModelStore()
        self.session = self.store.layout
        print(f"[LayoutDetector] Loaded with {self.store.providers()}")

    def detect(self, tensor: np.ndarray, scale: float) -> list[dict]:
        """Run layout detection on preprocessed tensor [1,3,640,640]."""
        result = self.session.run(None, {"image": tensor})
        return decode_rtmdet(result[0][0], result[1][0], 640, scale)


@serve.deployment(num_replicas=1, ray_actor_options={"num_gpus": 0.25})
class LineDetector:
    def __init__(self):
        self.store = ModelStore()
        self.session = self.store.yolo
        print(f"[LineDetector] Loaded with {self.store.providers()}")

    def detect(self, tensor: np.ndarray, orig_w: int, orig_h: int, scale: float, pad_x: int, pad_y: int, offset_x: float, offset_y: float) -> list[dict]:
        """Run line detection on preprocessed YOLO tensor [1,3,640,640]."""
        result = self.session.run(None, {self.session.get_inputs()[0].name: tensor})
        lines = decode_yolo(result[0], orig_w, orig_h, scale, pad_x, pad_y)
        for line in lines:
            line["x"] += offset_x
            line["y"] += offset_y
        return lines


@serve.deployment(num_replicas=1, ray_actor_options={"num_gpus": 0.5})
class TranscriberDeployment:
    def __init__(self):
        self.store = ModelStore()
        self.encoder = self.store.encoder
        self.decoder = self.store.decoder
        tok_path = _resolve_model(TOKENIZER_FILE, self.store.models_dir)
        self.tokenizer = Tokenizer(tok_path)
        print(f"[Transcriber] Loaded with {self.store.providers()}")

    def transcribe_one(self, tensor: np.ndarray) -> dict:
        """Run TrOCR on preprocessed tensor [1,3,384,384]."""
        text, confidence = transcribe_line(self.encoder, self.decoder, self.tokenizer, tensor)
        return {"text": text, "confidence": confidence}


# --- FastAPI Ingress ---


def _gpu_info() -> dict:
    from .gpu_info import get_gpu_info

    return get_gpu_info()


app = FastAPI(title="Lejonet GPU Inference (Ray Serve)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _read_image(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data)).convert("RGB")


@serve.deployment(ray_actor_options={"num_cpus": 1})
@serve.ingress(app)
class APIIngress:
    def __init__(self, layout, line_det, transcriber):
        self.layout = layout
        self.line_det = line_det
        self.transcriber = transcriber
        self._images: dict[str, Image.Image] = {}
        self._image_counter = 0

    def _store_image(self, img: Image.Image) -> str:
        self._image_counter += 1
        image_id = f"img-{self._image_counter}"
        self._images[image_id] = img
        # Evict old images (keep max 20)
        if len(self._images) > 20:
            oldest = list(self._images.keys())[0]
            del self._images[oldest]
        return image_id

    def _get_image(self, image_id: str) -> Image.Image:
        img = self._images.get(image_id)
        if not img:
            raise ValueError(f"Image {image_id} not found. Upload first via /upload-image")
        return img

    @app.get("/health")
    def health(self):
        store = ModelStore()
        return {
            "status": "ok",
            "models": store.available_models(),
            "providers": store.providers(),
            "gpu": _gpu_info(),
            "ray": True,
        }

    @app.get("/status")
    def status(self):
        """Rich status with Ray Serve deployment metrics."""
        from ray.serve import status as serve_status

        info = serve_status()
        deployments = {}
        for app_status in info.applications.values():
            for name, dep in app_status.deployments.items():
                deployments[name] = {
                    "status": dep.status,
                    "message": dep.message or None,
                    "replicas": len(dep.replica_states) if hasattr(dep, "replica_states") else None,
                }

        # Get cluster resources
        import ray

        resources = ray.available_resources()

        return {
            "deployments": deployments,
            "gpu": _gpu_info(),
            "cluster": {
                "cpu_available": resources.get("CPU", 0),
                "gpu_available": resources.get("GPU", 0),
                "memory_gb": round(resources.get("memory", 0) / 1e9, 1),
            },
        }

    @app.post("/upload-image")
    async def upload_image(self, image: UploadFile = File(...)):  # noqa: B008
        """Upload image once, get an ID to use in subsequent calls."""
        img = _read_image(await image.read())
        image_id = self._store_image(img)
        return {"image_id": image_id, "width": img.width, "height": img.height}

    @app.post("/detect-layout")
    async def detect_layout(
        self,
        image: UploadFile = File(None),  # noqa: B008
        image_id: str = Form(None),  # noqa: B008
    ):
        img = self._get_image(image_id) if image_id else _read_image(await image.read())
        # Preprocess on CPU side — only send small tensor to GPU actor
        tensor, scale = preprocess_rtmdet(img)
        regions = await self.layout.detect.remote(tensor, scale)
        return {"regions": regions, "image_size": [img.width, img.height]}

    @app.post("/detect-lines")
    async def detect_lines(
        self,
        image: UploadFile = File(None),  # noqa: B008
        image_id: str = Form(None),  # noqa: B008
        x: float = Form(0),  # noqa: B008
        y: float = Form(0),  # noqa: B008
        w: float = Form(0),  # noqa: B008
        h: float = Form(0),  # noqa: B008
    ):
        img = self._get_image(image_id) if image_id else _read_image(await image.read())
        if w > 0 and h > 0:
            cropped = crop_region(img, x, y, w, h)
            offset_x, offset_y = x, y
        else:
            cropped = img
            offset_x, offset_y = 0, 0
        tensor, scale, pad_x, pad_y = preprocess_yolo(cropped)
        lines = await self.line_det.detect.remote(tensor, cropped.width, cropped.height, scale, pad_x, pad_y, offset_x, offset_y)
        return {"lines": lines}

    @app.post("/transcribe")
    async def transcribe(
        self,
        image: UploadFile = File(None),  # noqa: B008
        image_id: str = Form(None),  # noqa: B008
        x: float = Form(...),  # noqa: B008
        y: float = Form(...),  # noqa: B008
        w: float = Form(...),  # noqa: B008
        h: float = Form(...),  # noqa: B008
    ):
        img = self._get_image(image_id) if image_id else _read_image(await image.read())
        # Crop and preprocess on CPU — send only 384x384 tensor to GPU
        line_img = crop_region(img, x, y, w, h)
        tensor = preprocess_trocr(line_img)
        result = await self.transcriber.transcribe_one.remote(tensor)
        return result

    @app.post("/process-page")
    async def process_page(self, image: UploadFile = File(...)):  # noqa: B008
        img = _read_image(await image.read())

        # Preprocess and detect layout
        layout_tensor, layout_scale = preprocess_rtmdet(img)
        regions = await self.layout.detect.remote(layout_tensor, layout_scale)

        all_groups = []
        for region in regions:
            # Preprocess and detect lines
            cropped = crop_region(img, region["x"], region["y"], region["w"], region["h"])
            yolo_tensor, scale, px, py = preprocess_yolo(cropped)
            lines = await self.line_det.detect.remote(yolo_tensor, cropped.width, cropped.height, scale, px, py, region["x"], region["y"])

            # Preprocess all line crops and send tensors in parallel
            futures = []
            for line in lines:
                line_img = crop_region(img, line["x"], line["y"], line["w"], line["h"])
                tensor = preprocess_trocr(line_img)
                futures.append((line, self.transcriber.transcribe_one.remote(tensor)))

            transcribed = []
            for line, fut in futures:
                result = await fut
                transcribed.append(
                    {
                        "bbox": {"x": line["x"], "y": line["y"], "w": line["w"], "h": line["h"]},
                        "text": result["text"],
                        "confidence": result["confidence"],
                    }
                )

            all_groups.append({"region": region, "lines": transcribed})

        return {"groups": all_groups, "image_size": [img.width, img.height]}


# --- Start ---


def start():
    import os

    os.environ.setdefault("RAY_GRAFANA_HOST", "http://grafana:3000")
    os.environ.setdefault("RAY_PROMETHEUS_HOST", "http://prometheus:9090")
    os.environ.setdefault("RAY_GRAFANA_IFRAME_HOST", "http://localhost:3000")

    os.environ.setdefault("RAY_METRICS_EXPORT_PORT", "9100")
    ray.init(
        ignore_reinit_error=True,
        runtime_env={"working_dir": None},
        dashboard_host="0.0.0.0",  # noqa: S104 — intentional for Docker
    )

    serve.start(http_options={"host": "0.0.0.0", "port": 8080})  # noqa: S104 — intentional for Docker

    layout = LayoutDetector.bind()
    line_det = LineDetector.bind()
    transcriber = TranscriberDeployment.bind()
    ingress = APIIngress.bind(layout, line_det, transcriber)

    serve.run(ingress)

    print("Ray Serve running:")
    print("  API: http://0.0.0.0:8080")
    print("  Dashboard: http://localhost:8265")
    print("  Deployments: LayoutDetector(0.25GPU), LineDetector(0.25GPU), Transcriber(0.5GPU, batch=8)")

    # Warm up models by sending a dummy request (triggers GPU kernel compilation)
    import threading
    import time as _time

    def _warmup():
        _time.sleep(8)  # Wait for Ray Serve to fully start
        try:
            print("Warming up models...")
            # Create a tiny dummy JPEG
            dummy = Image.new("RGB", (100, 100), (200, 200, 200))
            buf = io.BytesIO()
            dummy.save(buf, format="JPEG")
            img_bytes = buf.getvalue()

            # Send to detect-layout to trigger model load
            import http.client

            boundary = "warmup_boundary"
            body = (
                (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="warmup.jpg"\r\nContent-Type: image/jpeg\r\n\r\n').encode()
                + img_bytes
                + f"\r\n--{boundary}--\r\n".encode()
            )

            conn = http.client.HTTPConnection("localhost", 8080)
            conn.request("POST", "/detect-layout", body=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
            resp = conn.getresponse()
            print(f"  Warmup layout: {resp.status}")
            conn.close()

            conn = http.client.HTTPConnection("localhost", 8080)
            conn.request("POST", "/detect-lines", body=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
            resp = conn.getresponse()
            print(f"  Warmup lines: {resp.status}")
            conn.close()

            print("  Warmup complete — models ready.")
        except Exception as e:
            print(f"  Warmup error (non-fatal): {e}")

    threading.Thread(target=_warmup, daemon=True).start()


if __name__ == "__main__":
    start()
    import time

    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        serve.shutdown()
        ray.shutdown()
