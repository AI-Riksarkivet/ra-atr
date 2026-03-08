use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize)]
pub struct TokenizerConfig {
    pub model: TokenizerModel,
}

#[derive(Deserialize)]
pub struct TokenizerModel {
    pub vocab: HashMap<String, u32>,
    #[allow(dead_code)]
    pub merges: Vec<String>,
}

pub struct BpeTokenizer {
    id_to_token: HashMap<u32, String>,
    pub eos_token_id: u32,
    pub bos_token_id: u32,
    pub pad_token_id: u32,
}

impl BpeTokenizer {
    pub fn from_json(tokenizer_json: &str) -> Result<Self, serde_json::Error> {
        let config: TokenizerConfig = serde_json::from_str(tokenizer_json)?;
        let id_to_token: HashMap<u32, String> = config
            .model
            .vocab
            .iter()
            .map(|(k, v)| (*v, k.clone()))
            .collect();

        // TrOCR uses RobertaTokenizer: bos=0, eos=2, pad=1
        Ok(Self {
            id_to_token,
            bos_token_id: 0,
            eos_token_id: 2,
            pad_token_id: 1,
        })
    }

    pub fn decode(&self, token_ids: &[u32]) -> String {
        let tokens: Vec<String> = token_ids
            .iter()
            .filter(|&&id| {
                id != self.bos_token_id && id != self.eos_token_id && id != self.pad_token_id
            })
            .filter_map(|id| self.id_to_token.get(id).cloned())
            .collect();

        // RoBERTa BPE uses Ġ for space prefix
        tokens
            .join("")
            .replace('\u{0120}', " ")
            .trim()
            .to_string()
    }

    pub fn decode_token(&self, token_id: u32) -> Option<String> {
        self.id_to_token
            .get(&token_id)
            .map(|t| t.replace('\u{0120}', " "))
    }

    pub fn vocab_size(&self) -> usize {
        self.id_to_token.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_real_tokenizer() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("models/tokenizer.json");
        if !path.exists() {
            eprintln!("Skipping: models/tokenizer.json not found");
            return;
        }
        let json = std::fs::read_to_string(&path).unwrap();
        let tokenizer = BpeTokenizer::from_json(&json).unwrap();
        assert!(tokenizer.vocab_size() > 1000, "vocab too small: {}", tokenizer.vocab_size());
        // Check special tokens are mapped
        assert!(tokenizer.id_to_token.contains_key(&0), "missing bos token");
        assert!(tokenizer.id_to_token.contains_key(&1), "missing pad token");
        assert!(tokenizer.id_to_token.contains_key(&2), "missing eos token");
        eprintln!("Tokenizer loaded: {} tokens", tokenizer.vocab_size());
    }
}
