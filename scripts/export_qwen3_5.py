"""
Export Qwen3.5-0.8B vision-language model to ONNX for browser inference.

Exports three components:
  1. Vision encoder — pixel_values + grid_thw → image embeddings
  2. Embedding merger — merges vision embeddings into text token embeddings
  3. Decoder — inputs_embeds → logits (autoregressive)

Usage:
  python scripts/export_qwen3_5.py

Output:
  public/models/qwen3.5/vision_encoder.onnx
  public/models/qwen3.5/decoder.onnx
  public/models/qwen3.5/tokenizer.json
"""

import os
import json
import shutil
import torch
import torch.nn as nn
from transformers import Qwen3_5ForConditionalGeneration, AutoProcessor
from pathlib import Path

MODEL_ID = "Qwen/Qwen3.5-0.8B"
OUTPUT_DIR = Path("public/models/qwen3.5")
FLOAT_DIR = OUTPUT_DIR / "float32"  # intermediate float32 exports
OPSET = 17


class VisionEncoderWrapper(nn.Module):
    """Wraps the vision encoder with pre-computed positional embeddings.

    The Qwen3.5 vision encoder uses data-dependent ops (tolist, linspace,
    dynamic split/view) in rot_pos_emb and fast_pos_embed_interpolate that
    are untraceable by both torch.export and legacy TorchScript.

    We pre-compute these outputs eagerly for a fixed grid_thw and bake them
    as registered buffers, then monkey-patch the forward to use the constants.
    """

    def __init__(self, visual, fixed_grid_thw):
        super().__init__()
        self.visual = visual

        # Pre-compute the data-dependent outputs eagerly (on real Python)
        with torch.no_grad():
            pos_embeds = visual.fast_pos_embed_interpolate(fixed_grid_thw)
            rotary_pos_emb = visual.rot_pos_emb(fixed_grid_thw)
            import torch.nn.functional as F
            cu_seqlens = torch.repeat_interleave(
                fixed_grid_thw[:, 1] * fixed_grid_thw[:, 2], fixed_grid_thw[:, 0]
            ).cumsum(dim=0, dtype=torch.int32)
            cu_seqlens = F.pad(cu_seqlens, (1, 0), value=0)

        self.register_buffer("fixed_pos_embeds", pos_embeds)
        self.register_buffer("fixed_rotary_pos_emb", rotary_pos_emb)
        self.register_buffer("fixed_cu_seqlens", cu_seqlens)

    def forward(self, pixel_values):
        hidden_states = self.visual.patch_embed(pixel_values)

        # Use pre-computed positional embeddings (avoids data-dependent ops)
        hidden_states = hidden_states + self.fixed_pos_embeds

        seq_len, _ = hidden_states.size()
        hidden_states = hidden_states.reshape(seq_len, -1)
        rotary = self.fixed_rotary_pos_emb.reshape(seq_len, -1)
        emb = torch.cat((rotary, rotary), dim=-1)
        position_embeddings = (emb.cos(), emb.sin())

        for blk in self.visual.blocks:
            hidden_states = blk(
                hidden_states,
                cu_seqlens=self.fixed_cu_seqlens,
                position_embeddings=position_embeddings,
            )

        merged = self.visual.merger(hidden_states)
        return merged


class DecoderWrapper(nn.Module):
    """Wraps the language model layers directly to avoid untraceable mask creation.

    Bypasses the high-level language_model.forward() which uses create_causal_mask
    (fails under TorchScript tracing). Instead runs: rotary_emb → layers → norm → lm_head.
    """

    def __init__(self, language_model, lm_head):
        super().__init__()
        self.layers = language_model.layers
        self.norm = language_model.norm
        self.rotary_emb = language_model.rotary_emb
        self.lm_head = lm_head

    def forward(self, inputs_embeds, attention_mask):
        batch, seq_len, _ = inputs_embeds.shape

        # Build position_ids: (3, batch, seq_len) for mrope (temporal, height, width)
        pos = torch.arange(seq_len, device=inputs_embeds.device).unsqueeze(0).expand(batch, -1)
        pos_3d = pos.unsqueeze(0).expand(3, batch, seq_len)

        # Compute rotary embeddings
        position_embeddings = self.rotary_emb(inputs_embeds, pos_3d)

        # Build simple causal mask: [batch, 1, seq, seq]
        causal_mask = torch.triu(
            torch.full((seq_len, seq_len), float("-inf"), device=inputs_embeds.device),
            diagonal=1,
        ).unsqueeze(0).unsqueeze(0).expand(batch, 1, seq_len, seq_len)

        hidden_states = inputs_embeds
        for layer in self.layers:
            # Linear attention layers ignore causal_mask (use attention_mask=None internally)
            # Full attention layers use causal_mask
            # The layer branches internally based on layer_type
            layer_mask = None if layer.layer_type == "linear_attention" else causal_mask
            hidden_states = layer(
                hidden_states,
                position_embeddings=position_embeddings,
                attention_mask=layer_mask,
                position_ids=pos,
            )

        hidden_states = self.norm(hidden_states)
        logits = self.lm_head(hidden_states)
        return logits


def export_vision_encoder(model):
    """Export the vision encoder with a fixed input resolution.

    The Qwen3.5 vision encoder uses data-dependent shapes (grid interpolation,
    spatial merging) that prevent dynamic ONNX export. We bake the grid_thw as
    a constant for a fixed image size (448x448 → 28x28 patches → 14x14 merged).
    """
    print("\n=== Exporting vision encoder ===")

    # Use processor to get correct shapes for our target resolution
    from PIL import Image
    proc = AutoProcessor.from_pretrained(MODEL_ID)
    img = Image.new("RGB", (448, 448), color="white")
    messages = [{"role": "user", "content": [{"type": "image", "image": img}, {"type": "text", "text": "Hi"}]}]
    text = proc.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = proc(text=[text], images=[img], return_tensors="pt")

    pixel_values = inputs["pixel_values"]
    image_grid_thw = inputs["image_grid_thw"]
    print(f"  pixel_values shape: {pixel_values.shape}")
    print(f"  image_grid_thw: {image_grid_thw}")

    # Force eager attention — SDPA with enable_gqa=True isn't supported by ONNX export
    model.model.visual.config._attn_implementation = "eager"

    wrapper = VisionEncoderWrapper(model.model.visual, image_grid_thw)
    wrapper.eval()

    with torch.no_grad():
        test_out = wrapper(pixel_values)
        print(f"  Vision output shape: {test_out.shape}")  # merged embeddings

    output_path = FLOAT_DIR / "vision_encoder.onnx"
    torch.onnx.export(
        wrapper,
        (pixel_values,),
        str(output_path),
        opset_version=OPSET,
        input_names=["pixel_values"],
        output_names=["image_embeds"],
        dynamo=False,  # legacy tracing — dynamo fails on data-dependent shapes
    )
    size_mb = output_path.stat().st_size / 1e6
    print(f"  Saved: {output_path} ({size_mb:.1f} MB)")
    return test_out


def export_decoder(model):
    """Export the language model decoder."""
    print("\n=== Exporting decoder ===")

    # Force eager attention for ONNX export (SDPA masking doesn't trace)
    model.config.text_config._attn_implementation = "eager"
    model.model.language_model.config._attn_implementation = "eager"

    wrapper = DecoderWrapper(model.model.language_model, model.lm_head)
    wrapper.eval()

    # Dummy: sequence of 10 tokens worth of embeddings
    hidden_size = model.config.text_config.hidden_size
    seq_len = 10
    dummy_embeds = torch.randn(1, seq_len, hidden_size)
    dummy_mask = torch.ones(1, seq_len, dtype=torch.long)

    with torch.no_grad():
        test_out = wrapper(dummy_embeds, dummy_mask)
        print(f"  Decoder logits shape: {test_out.shape}")

    output_path = FLOAT_DIR / "decoder.onnx"
    torch.onnx.export(
        wrapper,
        (dummy_embeds, dummy_mask),
        str(output_path),
        opset_version=OPSET,
        input_names=["inputs_embeds", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "inputs_embeds": {0: "batch", 1: "seq_len"},
            "attention_mask": {0: "batch", 1: "seq_len"},
            "logits": {0: "batch", 1: "seq_len"},
        },
        dynamo=False,
    )
    size_mb = output_path.stat().st_size / 1e6
    print(f"  Saved: {output_path} ({size_mb:.1f} MB)")


def export_embed_tokens(model):
    """Export the text embedding layer separately for JS-side token→embedding lookup."""
    print("\n=== Exporting text embeddings ===")

    embed = model.model.language_model.embed_tokens

    dummy_ids = torch.tensor([[1, 2, 3]], dtype=torch.long)
    with torch.no_grad():
        test_out = embed(dummy_ids)
        print(f"  Embedding output shape: {test_out.shape}")

    output_path = FLOAT_DIR / "embed_tokens.onnx"
    torch.onnx.export(
        embed,
        dummy_ids,
        str(output_path),
        opset_version=OPSET,
        input_names=["input_ids"],
        output_names=["embeddings"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq_len"},
            "embeddings": {0: "batch", 1: "seq_len"},
        },
        dynamo=False,
    )
    size_mb = output_path.stat().st_size / 1e6
    print(f"  Saved: {output_path} ({size_mb:.1f} MB)")


def save_tokenizer_and_config(model):
    """Save tokenizer and config for JS-side use."""
    print("\n=== Saving tokenizer and config ===")

    proc = AutoProcessor.from_pretrained(MODEL_ID)
    proc.tokenizer.save_pretrained(str(OUTPUT_DIR))

    # Save key config values
    config = {
        "model_type": "qwen3_5",
        "hidden_size": model.config.text_config.hidden_size,
        "vision_hidden_size": model.config.vision_config.hidden_size,
        "vocab_size": model.config.text_config.vocab_size,
        "num_hidden_layers": model.config.text_config.num_hidden_layers,
        "eos_token_id": model.generation_config.eos_token_id,
        "patch_size": model.config.vision_config.patch_size,
        "spatial_merge_size": model.config.vision_config.spatial_merge_size,
        "temporal_patch_size": model.config.vision_config.temporal_patch_size,
    }
    with open(OUTPUT_DIR / "config.json", "w") as f:
        json.dump(config, f, indent=2)

    print(f"  Saved tokenizer and config to {OUTPUT_DIR}")


def quantize_models():
    """Quantize float32 ONNX models to uint8 dynamic quantization."""
    from onnxruntime.quantization import quantize_dynamic, QuantType
    import onnx
    from onnx.external_data_helper import convert_model_to_external_data, load_external_data_for_model

    print("\n=== Quantizing models ===")

    for name in ["vision_encoder", "embed_tokens", "decoder"]:
        float_path = FLOAT_DIR / f"{name}.onnx"
        quant_path = OUTPUT_DIR / f"{name}.onnx"

        if not float_path.exists():
            print(f"  Skipping {name} (not found)")
            continue

        print(f"  Quantizing {name}...")

        # Load model with external data
        model = onnx.load(str(float_path), load_external_data=True)

        # Save consolidated — use external data for large models (>2GB protobuf limit)
        tmp_path = FLOAT_DIR / f"{name}_consolidated.onnx"
        tmp_data = str(FLOAT_DIR / f"{name}_consolidated.data")
        model_size = sum(t.raw_data.__len__() for t in model.graph.initializer)

        if model_size > 1_500_000_000:  # >1.5 GB, use external data
            onnx.save(model, str(tmp_path),
                      save_as_external_data=True,
                      all_tensors_to_one_file=True,
                      location=f"{name}_consolidated.data")
        else:
            onnx.save(model, str(tmp_path))

        quantize_dynamic(
            str(tmp_path),
            str(quant_path),
            weight_type=QuantType.QUInt8,
        )

        quant_size = quant_path.stat().st_size
        print(f"  {name}: {model_size / 1e6:.1f} MB (f32) -> {quant_size / 1e6:.1f} MB (uint8)")

        # Clean up consolidated temp files
        tmp_path.unlink(missing_ok=True)
        Path(tmp_data).unlink(missing_ok=True)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    FLOAT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading {MODEL_ID}...")
    model = Qwen3_5ForConditionalGeneration.from_pretrained(
        MODEL_ID, torch_dtype=torch.float32
    )
    model.eval()

    total_params = sum(p.numel() for p in model.parameters()) / 1e6
    print(f"Model parameters: {total_params:.1f}M")

    # Export float32 components
    export_vision_encoder(model)
    export_embed_tokens(model)
    export_decoder(model)
    save_tokenizer_and_config(model)

    # Free the PyTorch model before quantization (saves memory)
    del model
    torch.cuda.empty_cache() if torch.cuda.is_available() else None
    import gc; gc.collect()

    # Quantize to uint8
    quantize_models()

    # Clean up float32 intermediates
    print("\n=== Cleaning up float32 intermediates ===")
    shutil.rmtree(FLOAT_DIR, ignore_errors=True)

    # Print summary
    print("\n=== Export complete ===")
    total = 0
    for f in sorted(OUTPUT_DIR.glob("*.onnx")):
        size = f.stat().st_size
        total += size
        print(f"  {f.name}: {size / 1e6:.1f} MB")
    print(f"  Total ONNX: {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
