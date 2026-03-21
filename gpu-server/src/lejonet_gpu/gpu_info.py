"""GPU device detection utility."""

import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


def get_gpu_info(providers: list[str] | None = None) -> dict:
    """Get GPU device info. Tries rocm-smi, nvidia-smi, sysfs, then ORT providers."""
    # Try rocm-smi
    for cmd in [
        ["rocm-smi", "--showproductname", "--csv"],
        ["rocm-smi", "--showallinfo", "--csv"],
    ]:
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)  # noqa: S603
            if result.returncode == 0:
                lines = [row for row in result.stdout.strip().split("\n") if row and not row.startswith("device")]
                if lines:
                    return {"name": lines[0].split(",")[-1].strip(), "runtime": "ROCm"}
        except Exception:
            logger.debug("rocm-smi command %s failed", cmd[0])
    # Try nvidia-smi
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],  # noqa: S607
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            return {"name": result.stdout.strip(), "runtime": "CUDA"}
    except Exception:
        logger.debug("nvidia-smi not available")
    # Try reading from sysfs (works without tools)
    try:
        for card in sorted(Path("/sys/class/drm").glob("card*/device")):
            vendor = (card / "vendor").read_text().strip()
            if vendor == "0x1002":  # AMD
                name = (card / "product_name").read_text().strip() if (card / "product_name").exists() else "AMD GPU"
                return {"name": name, "runtime": "ROCm"}
            elif vendor == "0x10de":  # NVIDIA
                name = (card / "product_name").read_text().strip() if (card / "product_name").exists() else "NVIDIA GPU"
                return {"name": name, "runtime": "CUDA"}
    except Exception:
        logger.debug("sysfs GPU detection failed")
    # Fall back to ORT providers
    if providers:
        if "ROCMExecutionProvider" in providers:
            return {"name": "AMD GPU", "runtime": "ROCm"}
        if "CUDAExecutionProvider" in providers:
            return {"name": "NVIDIA GPU", "runtime": "CUDA"}
    return {"name": "Unknown", "runtime": "Unknown"}
