/**
 * Minimal BPE tokenizer for TrOCR decoding.
 * Parses HuggingFace tokenizer.json format.
 */
export class BpeTokenizer {
  private vocab: Map<number, string>;
  readonly eosTokenId: number;
  readonly bosTokenId: number;
  readonly padTokenId: number;

  constructor(tokenizerJson: string) {
    const data = JSON.parse(tokenizerJson);
    this.vocab = new Map();

    // Build id->token map from the vocab object
    const vocabObj: Record<string, number> = data.model?.vocab ?? {};
    for (const [token, id] of Object.entries(vocabObj)) {
      this.vocab.set(id, token);
    }

    // Also include added_tokens
    const addedTokens: Array<{ id: number; content: string }> = data.added_tokens ?? [];
    for (const t of addedTokens) {
      this.vocab.set(t.id, t.content);
    }

    // RoBERTa special token IDs
    this.bosTokenId = 0;
    this.padTokenId = 1;
    this.eosTokenId = 2;
  }

  /** Decode a single token ID to text. Returns null for special tokens. */
  decodeToken(id: number): string | null {
    if (id === this.bosTokenId || id === this.eosTokenId || id === this.padTokenId) {
      return null;
    }
    const token = this.vocab.get(id);
    if (!token) return null;
    // RoBERTa uses Ġ (U+0120) for leading space
    return token.replace(/\u0120/g, ' ');
  }

  /** Decode a sequence of token IDs to text. Skips BOS (first token). */
  decode(ids: number[]): string {
    let result = '';
    for (const id of ids) {
      const text = this.decodeToken(id);
      if (text !== null) result += text;
    }
    return result;
  }
}
