use std::sync::OnceLock;

use wasm_bindgen::prelude::*;

mod pipeline;
pub mod preprocessing;
pub mod tokenizer;
pub mod trocr;
mod utils;
pub mod yolo;

static YOLO_MODEL: OnceLock<yolo::YoloModel> = OnceLock::new();
static TROCR_MODEL: OnceLock<trocr::TrOCRModel> = OnceLock::new();

#[wasm_bindgen(start)]
pub fn init() {
    utils::set_panic_hook();
}

#[wasm_bindgen]
pub fn greet() -> String {
    "htr-wasm initialized (tract backend)".to_string()
}

#[wasm_bindgen]
pub fn load_yolo(model_bytes: &[u8]) -> Result<(), JsError> {
    let model =
        yolo::YoloModel::new(model_bytes).map_err(|e| JsError::new(&e.to_string()))?;
    YOLO_MODEL
        .set(model)
        .map_err(|_| JsError::new("YOLO model already loaded"))?;
    Ok(())
}

#[wasm_bindgen]
pub fn run_yolo(image_bytes: &[u8]) -> Result<String, JsError> {
    let img =
        image::load_from_memory(image_bytes).map_err(|e| JsError::new(&e.to_string()))?;
    let model = YOLO_MODEL
        .get()
        .ok_or_else(|| JsError::new("YOLO model not loaded"))?;
    let detections = model
        .detect(&img, 0.25, 0.45)
        .map_err(|e| JsError::new(&e.to_string()))?;
    serde_json::to_string(&detections).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn load_trocr(
    encoder_bytes: &[u8],
    decoder_bytes: &[u8],
    tokenizer_json: &str,
) -> Result<(), JsError> {
    let model = trocr::TrOCRModel::new(encoder_bytes, decoder_bytes, tokenizer_json)
        .map_err(|e| JsError::new(&e.to_string()))?;
    TROCR_MODEL
        .set(model)
        .map_err(|_| JsError::new("TrOCR model already loaded"))?;
    Ok(())
}

#[wasm_bindgen]
pub fn run_pipeline(
    image_bytes: &[u8],
    on_segmentation: &js_sys::Function,
    on_token: &js_sys::Function,
    on_line_done: &js_sys::Function,
    on_done: &js_sys::Function,
) -> Result<(), JsError> {
    let yolo = YOLO_MODEL
        .get()
        .ok_or_else(|| JsError::new("YOLO model not loaded"))?;
    let trocr = TROCR_MODEL
        .get()
        .ok_or_else(|| JsError::new("TrOCR model not loaded"))?;
    pipeline::run(yolo, trocr, image_bytes, on_segmentation, on_token, on_line_done, on_done)
        .map_err(|e| JsError::new(&e.to_string()))
}
