"""
Export Florence-2-base to ONNX for browser inference.

Exports three components:
  1. Vision encoder (DaViT) — image → visual embeddings
  2. Text embedding + encoder — prompt → encoder hidden states
  3. Decoder — autoregressive text generation

Usage:
  python scripts/export_florence2.py

Output:
  public/models/florence2/vision_encoder.onnx
  public/models/florence2/encoder.onnx
  public/models/florence2/decoder.onnx
  public/models/florence2/tokenizer.json
"""

import os
import json
import torch
import torch.nn as nn
from transformers import AutoProcessor, AutoModelForCausalLM
from pathlib import Path

MODEL_ID = "microsoft/Florence-2-base"
OUTPUT_DIR = Path("public/models/florence2")
OPSET = 17


def export_vision_encoder(model, processor):
    """Export the vision encoder (DaViT image backbone + projection)."""
    print("\n=== Exporting vision encoder ===")

    vision_tower = model.vision_tower

    class VisionEncoderWrapper(nn.Module):
        def __init__(self, vision_tower):
            super().__init__()
            self.vision_tower = vision_tower

        def forward(self, pixel_values):
            return self.vision_tower(pixel_values)

    wrapper = VisionEncoderWrapper(vision_tower)
    wrapper.eval()

    # Florence-2-base expects 768x768 images
    dummy_pixel_values = torch.randn(1, 3, 768, 768)

    with torch.no_grad():
        test_out = wrapper(dummy_pixel_values)
        print(f"  Vision output shape: {test_out.shape}")

    output_path = OUTPUT_DIR / "vision_encoder.onnx"
    torch.onnx.export(
        wrapper,
        (dummy_pixel_values,),
        str(output_path),
        opset_version=OPSET,
        input_names=["pixel_values"],
        output_names=["image_features"],
        dynamic_axes={
            "pixel_values": {0: "batch"},
            "image_features": {0: "batch"},
        },
    )
    print(f"  Saved: {output_path} ({output_path.stat().st_size / 1e6:.1f} MB)")
    return test_out


def export_encoder(model):
    """Export the text encoder (embedding + encoder layers).

    Takes input_ids (prompt tokens) and image features from vision encoder,
    merges them, and produces encoder hidden states.
    """
    print("\n=== Exporting encoder ===")

    class EncoderWrapper(nn.Module):
        def __init__(self, model):
            super().__init__()
            self.model = model

        def forward(self, input_ids, image_features):
            # Get text embeddings
            inputs_embeds = self.model.get_encoder().embed_tokens(input_ids)

            # Project image features to text dimension
            image_embeds = self.model._encode_image(image_features)

            # Merge: image embeddings + text embeddings
            merged = torch.cat([image_embeds, inputs_embeds], dim=1)

            # Create attention mask for merged sequence
            attention_mask = torch.ones(merged.shape[:2], dtype=torch.long, device=merged.device)

            # Run through encoder
            encoder_out = self.model.get_encoder()(
                inputs_embeds=merged,
                attention_mask=attention_mask,
            )
            return encoder_out.last_hidden_state

    wrapper = EncoderWrapper(model)
    wrapper.eval()

    # Dummy inputs
    dummy_input_ids = torch.tensor([[0, 2]], dtype=torch.long)  # <s></s> minimal prompt
    dummy_image_features = torch.randn(1, 577, 768)  # typical vision output

    with torch.no_grad():
        test_out = wrapper(dummy_input_ids, dummy_image_features)
        print(f"  Encoder output shape: {test_out.shape}")

    output_path = OUTPUT_DIR / "encoder.onnx"
    torch.onnx.export(
        wrapper,
        (dummy_input_ids, dummy_image_features),
        str(output_path),
        opset_version=OPSET,
        input_names=["input_ids", "image_features"],
        output_names=["encoder_hidden_states"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq_len"},
            "image_features": {0: "batch", 1: "num_patches"},
            "encoder_hidden_states": {0: "batch", 1: "seq_len"},
        },
    )
    print(f"  Saved: {output_path} ({output_path.stat().st_size / 1e6:.1f} MB)")


def export_decoder(model):
    """Export the decoder for autoregressive generation."""
    print("\n=== Exporting decoder ===")

    class DecoderWrapper(nn.Module):
        def __init__(self, model):
            super().__init__()
            self.model = model

        def forward(self, input_ids, encoder_hidden_states, encoder_attention_mask):
            decoder_out = self.model(
                decoder_input_ids=input_ids,
                encoder_outputs=(encoder_hidden_states,),
                encoder_attention_mask=encoder_attention_mask,
            )
            return decoder_out.logits

    wrapper = DecoderWrapper(model)
    wrapper.eval()

    # Dummy inputs
    dummy_decoder_ids = torch.tensor([[2]], dtype=torch.long)  # decoder start token
    dummy_encoder_hidden = torch.randn(1, 50, 768)
    dummy_encoder_mask = torch.ones(1, 50, dtype=torch.long)

    with torch.no_grad():
        test_out = wrapper(dummy_decoder_ids, dummy_encoder_hidden, dummy_encoder_mask)
        print(f"  Decoder logits shape: {test_out.shape}")

    output_path = OUTPUT_DIR / "decoder.onnx"
    torch.onnx.export(
        wrapper,
        (dummy_decoder_ids, dummy_encoder_hidden, dummy_encoder_mask),
        str(output_path),
        opset_version=OPSET,
        input_names=["input_ids", "encoder_hidden_states", "encoder_attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq_len"},
            "encoder_hidden_states": {0: "batch", 1: "enc_seq_len"},
            "encoder_attention_mask": {0: "batch", 1: "enc_seq_len"},
            "logits": {0: "batch", 1: "seq_len"},
        },
    )
    print(f"  Saved: {output_path} ({output_path.stat().st_size / 1e6:.1f} MB)")


def save_tokenizer_and_config(processor, model):
    """Save processor config and tokenizer for JS-side use."""
    print("\n=== Saving tokenizer and config ===")

    # Save the processor's tokenizer
    processor.tokenizer.save_pretrained(str(OUTPUT_DIR))

    # Save generation config
    gen_config = model.generation_config.to_dict()
    with open(OUTPUT_DIR / "generation_config.json", "w") as f:
        json.dump(gen_config, f, indent=2)

    # Save task prompts mapping
    task_prompts = {
        "caption": "<MORE_DETAILED_CAPTION>",
        "od": "<OD>",
        "ocr": "<OCR>",
        "ocr_with_region": "<OCR_WITH_REGION>",
        "region_proposal": "<REGION_PROPOSAL>",
        "dense_region_caption": "<DENSE_REGION_CAPTION>",
        "caption_to_grounding": "<CAPTION_TO_PHRASE_GROUNDING>",
    }
    with open(OUTPUT_DIR / "task_prompts.json", "w") as f:
        json.dump(task_prompts, f, indent=2)

    print(f"  Saved tokenizer and configs to {OUTPUT_DIR}")


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading {MODEL_ID}...")
    processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(MODEL_ID, trust_remote_code=True)
    model.eval()

    print(f"Model parameters: {sum(p.numel() for p in model.parameters()) / 1e6:.1f}M")

    # First verify the model works
    print("\n=== Verifying model works ===")
    from PIL import Image
    import requests

    # Use a simple test
    dummy_img = Image.new("RGB", (640, 480), color="white")
    inputs = processor(
        text="<MORE_DETAILED_CAPTION>",
        images=dummy_img,
        return_tensors="pt",
    )
    with torch.no_grad():
        generated = model.generate(
            **inputs,
            max_new_tokens=20,
        )
    result = processor.batch_decode(generated, skip_special_tokens=False)[0]
    print(f"  Test output: {result[:100]}")

    # Check vision encoder output shape
    with torch.no_grad():
        vision_out = model.vision_tower(inputs["pixel_values"])
        print(f"  Vision tower output: {vision_out.shape}")

    # Export components
    vision_features = export_vision_encoder(model, processor)
    export_encoder(model)
    export_decoder(model)
    save_tokenizer_and_config(processor, model)

    # Print summary
    print("\n=== Export complete ===")
    total = 0
    for f in OUTPUT_DIR.glob("*.onnx"):
        size = f.stat().st_size
        total += size
        print(f"  {f.name}: {size / 1e6:.1f} MB")
    print(f"  Total ONNX: {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
