use std::sync::Arc;

use tract_onnx::prelude::*;

use crate::preprocessing::preprocess_trocr;
use crate::tokenizer::BpeTokenizer;

pub struct TrOCRModel {
    encoder: Arc<TypedRunnableModel>,
    decoder_bytes: Vec<u8>,
    pub tokenizer: BpeTokenizer,
}

impl TrOCRModel {
    pub fn new(
        encoder_bytes: &[u8],
        decoder_bytes: &[u8],
        tokenizer_json: &str,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let mut encoder_model = tract_onnx::onnx()
            .model_for_read(&mut std::io::Cursor::new(encoder_bytes))?;
        encoder_model.set_input_fact(0, f32::fact([1, 3, 384, 384]).into())?;
        let encoder = encoder_model.into_optimized()?.into_runnable()?;

        let tokenizer = BpeTokenizer::from_json(tokenizer_json)?;

        Ok(Self {
            encoder,
            decoder_bytes: decoder_bytes.to_vec(),
            tokenizer,
        })
    }

    fn build_decoder(&self, seq_len: usize) -> Result<Arc<TypedRunnableModel>, Box<dyn std::error::Error>> {
        let mut model = tract_onnx::onnx()
            .model_for_read(&mut std::io::Cursor::new(&self.decoder_bytes))?;
        model.set_input_fact(0, i64::fact([1, seq_len]).into())?;
        model.set_input_fact(1, i64::fact([1, seq_len]).into())?;
        model.set_input_fact(2, f32::fact([1, 577, 768]).into())?;
        Ok(model.into_optimized()?.into_runnable()?)
    }

    pub fn transcribe_line(
        &self,
        img: &image::DynamicImage,
        max_length: usize,
        on_token: &dyn Fn(u32, &str),
    ) -> Result<String, Box<dyn std::error::Error>> {
        // Encode
        let pixel_values = preprocess_trocr(img);
        let encoder_output = self.encoder.run(tvec![pixel_values.into()])?;
        let hidden_states = encoder_output[0].clone();

        // Decode autoregressively
        let decoder_start_id = 2u32;
        let mut token_ids: Vec<u32> = vec![decoder_start_id];

        for _ in 0..max_length {
            let seq_len = token_ids.len();

            // Build decoder for current sequence length
            let decoder = self.build_decoder(seq_len)?;

            let input_ids_data: Vec<i64> = token_ids.iter().map(|&id| id as i64).collect();
            let input_ids =
                tract_ndarray::Array2::from_shape_vec((1, seq_len), input_ids_data)?.into_tensor();
            let attention_mask =
                tract_ndarray::Array2::<i64>::ones((1, seq_len)).into_tensor();

            let decoder_output = decoder.run(tvec![
                input_ids.into(),
                attention_mask.into(),
                hidden_states.clone(),
            ])?;

            let logits = decoder_output[0].to_array_view::<f32>()?;

            // Get last token logits, argmax
            let vocab_size = logits.shape()[2];
            let mut best_token = 0u32;
            let mut best_score = f32::NEG_INFINITY;
            for i in 0..vocab_size {
                let score = logits[[0, seq_len - 1, i]];
                if score > best_score {
                    best_score = score;
                    best_token = i as u32;
                }
            }

            if best_token == self.tokenizer.eos_token_id {
                break;
            }

            if let Some(text) = self.tokenizer.decode_token(best_token) {
                on_token(best_token, &text);
            }

            token_ids.push(best_token);
        }

        Ok(self.tokenizer.decode(&token_ids[1..]))
    }
}
