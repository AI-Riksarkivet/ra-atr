"""Entry point for the GPU inference server with Ray Serve."""

import ray
from ray import serve

from .app import app
from .serve import LayoutDetector, LineDetector, Transcriber


def start():
    """Start Ray Serve with all deployments."""
    ray.init(ignore_reinit_error=True)

    # Bind deployments
    layout = LayoutDetector.bind()
    lines = LineDetector.bind()
    transcriber = Transcriber.bind()

    # Start serve with the FastAPI app as ingress
    serve.run(
        serve.deployment(app).bind(),
        name="lejonet-gpu",
        route_prefix="/",
    )

    # Deploy model workers
    serve.run(layout, name="LayoutDetector", route_prefix="/internal/layout")
    serve.run(lines, name="LineDetector", route_prefix="/internal/lines")
    serve.run(transcriber, name="Transcriber", route_prefix="/internal/transcribe")

    print("Ray Serve started with deployments:")
    print("  - LayoutDetector (0.25 GPU)")
    print("  - LineDetector (0.25 GPU)")
    print("  - Transcriber (0.5 GPU, batching up to 8)")
    print(f"  Dashboard: http://localhost:8265")


if __name__ == "__main__":
    start()
    import time
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        serve.shutdown()
        ray.shutdown()
