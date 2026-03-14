"""TrOCR transcription."""

import json
from pathlib import Path

import numpy as np


class Tokenizer:
    """Simple BPE tokenizer from HuggingFace tokenizer.json."""

    def __init__(self, path: Path):
        with open(path) as f:
            data = json.load(f)
        self.vocab = {v: k for k, v in data["model"]["vocab"].items()}
        self.bos_id = 0
        self.eos_id = 2
        self.pad_id = 1

        # Byte-to-unicode mapping (RoBERTa BPE)
        bs = list(range(33, 127)) + list(range(161, 173)) + list(range(174, 256))
        cs = bs[:]
        n = 0
        for b in range(256):
            if b not in bs:
                bs.append(b)
                cs.append(256 + n)
                n += 1
        self.byte2unicode = {b: chr(c) for b, c in zip(bs, cs)}
        self.unicode2byte = {v: k for k, v in self.byte2unicode.items()}

    def decode(self, ids: list[int]) -> str:
        tokens = []
        for id in ids:
            if id in (self.bos_id, self.eos_id, self.pad_id):
                continue
            token = self.vocab.get(id, "")
            tokens.append(token)
        text = "".join(tokens)
        byte_list = [self.unicode2byte.get(c, ord(c)) for c in text]
        return bytes(byte_list).decode("utf-8", errors="replace")


def transcribe_line(
    encoder_session,
    decoder_session,
    tokenizer: Tokenizer,
    line_tensor: np.ndarray,
    max_length: int = 256,
) -> tuple[str, float]:
    """Run TrOCR encoder + decoder on a preprocessed line image.

    Args:
        line_tensor: [1, 3, 384, 384] float32 normalized
    Returns:
        (text, confidence)
    """
    # Encoder
    encoder_out = encoder_session.run(None, {
        encoder_session.get_inputs()[0].name: line_tensor,
    })
    hidden_states = encoder_out[0]  # [1, seq_len, hidden_dim]

    # Greedy decode
    input_ids = np.array([[tokenizer.bos_id]], dtype=np.int64)
    generated = []
    total_logprob = 0.0

    for _ in range(max_length):
        attention_mask = np.ones_like(input_ids, dtype=np.int64)

        decoder_out = decoder_session.run(None, {
            "input_ids": input_ids,
            "attention_mask": attention_mask,
            "encoder_hidden_states": hidden_states,
        })

        logits = decoder_out[0]  # [1, seq_len, vocab_size]
        next_logits = logits[0, -1]

        # Suppress pad token
        next_logits[tokenizer.pad_id] = -float("inf")

        # No-repeat trigram
        if len(generated) >= 2:
            for i in range(len(generated) - 1):
                if generated[i] == generated[-2] and generated[i + 1] == generated[-1]:
                    if i + 2 < len(generated):
                        next_logits[generated[i + 2]] = -float("inf")

        # Argmax
        next_id = int(np.argmax(next_logits))
        if next_id == tokenizer.eos_id:
            break

        # Log probability for confidence
        probs = np.exp(next_logits - np.max(next_logits))
        probs = probs / probs.sum()
        total_logprob += np.log(probs[next_id] + 1e-10)

        generated.append(next_id)
        input_ids = np.array([generated], dtype=np.int64)
        input_ids = np.concatenate([
            np.array([[tokenizer.bos_id]], dtype=np.int64),
            input_ids,
        ], axis=1)

    text = tokenizer.decode(generated)
    confidence = float(np.exp(total_logprob / max(len(generated), 1)))
    return text, confidence
