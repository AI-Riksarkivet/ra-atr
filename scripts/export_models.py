"""Export and quantize YOLO + TrOCR models to ONNX for WASM inference."""

from pathlib import Path
from ultralytics import YOLO
from optimum.onnxruntime import ORTModelForVision2Seq
from onnxruntime.quantization import quantize_dynamic, QuantType
from transformers import TrOCRProcessor

OUTPUT_DIR = Path("models")


def export_yolo():
    model = YOLO("Riksarkivet/yolov9-lines-within-regions-1")
    model.export(format="onnx", imgsz=640)
    # Quantize
    quantize_dynamic(
        "yolov9-lines-within-regions-1.onnx",
        str(OUTPUT_DIR / "yolo-lines-int8.onnx"),
        weight_type=QuantType.QInt8,
    )


def export_trocr():
    model_id = "Riksarkivet/trocr-base-handwritten-hist-swe-2"
    model = ORTModelForVision2Seq.from_pretrained(model_id, export=True)
    model.save_pretrained(OUTPUT_DIR / "trocr")
    # Quantize encoder and decoder separately
    for name in ["encoder_model.onnx", "decoder_model.onnx"]:
        quantize_dynamic(
            str(OUTPUT_DIR / "trocr" / name),
            str(OUTPUT_DIR / f"trocr-{name.replace('_model.onnx', '')}-int8.onnx"),
            weight_type=QuantType.QInt8,
        )
    # Export tokenizer
    processor = TrOCRProcessor.from_pretrained(model_id)
    processor.tokenizer.save_pretrained(OUTPUT_DIR / "tokenizer")


if __name__ == "__main__":
    OUTPUT_DIR.mkdir(exist_ok=True)
    print("Exporting YOLO...")
    export_yolo()
    print("Exporting TrOCR...")
    export_trocr()
    print("Done! Models saved to", OUTPUT_DIR)
