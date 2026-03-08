use image::GenericImageView;
use wasm_bindgen::prelude::*;

use crate::trocr::TrOCRModel;
use crate::yolo::YoloModel;

pub fn run(
    yolo: &YoloModel,
    trocr: &TrOCRModel,
    image_bytes: &[u8],
    on_segmentation: &js_sys::Function,
    on_token: &js_sys::Function,
    on_line_done: &js_sys::Function,
    on_done: &js_sys::Function,
) -> Result<(), Box<dyn std::error::Error>> {
    let img = image::load_from_memory(image_bytes)?;

    // 1. Run YOLO segmentation
    let mut detections = yolo.detect(&img, 0.25, 0.45)?;

    // 2. Sort by Y then X (reading order)
    detections.sort_by(|a, b| {
        a.y.partial_cmp(&b.y)
            .unwrap()
            .then(a.x.partial_cmp(&b.x).unwrap())
    });

    // 3. Send segmentation results
    let det_json = serde_json::to_string(&detections)?;
    let this = JsValue::NULL;
    on_segmentation
        .call1(&this, &JsValue::from_str(&det_json))
        .map_err(|e| format!("on_segmentation callback failed: {e:?}"))?;

    // 4. For each detection, crop and run TrOCR
    let (img_w, img_h) = img.dimensions();
    for (i, det) in detections.iter().enumerate() {
        let x = (det.x.max(0.0) as u32).min(img_w);
        let y = (det.y.max(0.0) as u32).min(img_h);
        let w = (det.w as u32).min(img_w.saturating_sub(x)).max(1);
        let h = (det.h as u32).min(img_h.saturating_sub(y)).max(1);

        let cropped = img.crop_imm(x, y, w, h);
        let line_idx = i as u32;

        let text = trocr.transcribe_line(&cropped, 256, &|_token_id, token_text| {
            let _ = on_token.call2(
                &this,
                &JsValue::from(line_idx),
                &JsValue::from_str(token_text),
            );
        })?;

        // Compute average confidence (use detection confidence as proxy)
        let confidence = det.confidence;
        let _ = on_line_done.call3(
            &this,
            &JsValue::from(line_idx),
            &JsValue::from_str(&text),
            &JsValue::from_f64(confidence as f64),
        );
    }

    // 5. Done
    on_done
        .call0(&this)
        .map_err(|e| format!("on_done callback failed: {e:?}"))?;

    Ok(())
}
