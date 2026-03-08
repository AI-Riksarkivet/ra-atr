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
}
