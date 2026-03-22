/**
 * Minimal BPE tokenizer for TrOCR decoding.
 * Parses HuggingFace tokenizer.json format.
 * Handles RoBERTa byte-level BPE: tokens are sequences of Unicode codepoints
 * that map to raw bytes, which must be reassembled into UTF-8.
 */
export class BpeTokenizer {
	private vocab: Map<number, string>;
	private byteDecoder: Map<string, number>;
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

		// Build byte decoder: maps Unicode codepoints back to byte values
		// This is the inverse of GPT-2/RoBERTa's bytes_to_unicode() mapping
		this.byteDecoder = new Map();
		const bs: number[] = [];
		// Printable ASCII ranges that map to themselves
		for (let i = 0x21; i <= 0x7e; i++) bs.push(i); // ! to ~
		for (let i = 0xa1; i <= 0xac; i++) bs.push(i); // ¡ to ¬
		for (let i = 0xae; i <= 0xff; i++) bs.push(i); // ® to ÿ
		const cs = [...bs];
		let n = 0;
		for (let b = 0; b < 256; b++) {
			if (!bs.includes(b)) {
				bs.push(b);
				cs.push(256 + n);
				n++;
			}
		}
		for (let i = 0; i < bs.length; i++) {
			this.byteDecoder.set(String.fromCodePoint(cs[i]), bs[i]);
		}
	}

	/** Decode a single token ID to its raw BPE string (for streaming display). */
	decodeToken(id: number): string | null {
		if (id === this.bosTokenId || id === this.eosTokenId || id === this.padTokenId) {
			return null;
		}
		const token = this.vocab.get(id);
		if (!token) return null;
		// Convert byte-level BPE token to actual bytes, then to UTF-8 string
		return this.bytesToString(token);
	}

	/** Decode a sequence of token IDs to text. */
	decode(ids: number[]): string {
		// Collect all raw BPE characters, then convert to bytes in one pass
		// This handles multi-byte UTF-8 chars that may span token boundaries
		let raw = '';
		for (const id of ids) {
			if (id === this.bosTokenId || id === this.eosTokenId || id === this.padTokenId) continue;
			const token = this.vocab.get(id);
			if (token) raw += token;
		}
		return this.bytesToString(raw);
	}

	/** Convert a BPE token string (using RoBERTa's byte mapping) to a UTF-8 string. */
	private bytesToString(bpeStr: string): string {
		const bytes: number[] = [];
		for (const ch of bpeStr) {
			const b = this.byteDecoder.get(ch);
			if (b !== undefined) {
				bytes.push(b);
			}
		}
		return new TextDecoder().decode(new Uint8Array(bytes));
	}
}
