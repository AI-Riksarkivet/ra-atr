use std::sync::Arc;

use image::GenericImageView;
use serde::Serialize;
use tract_onnx::prelude::*;

use crate::preprocessing::preprocess_yolo;

#[derive(Serialize, Clone, Debug)]
pub struct Detection {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub confidence: f32,
    pub class_id: usize,
}

pub struct YoloModel {
    model: Arc<TypedRunnableModel>,
}

impl YoloModel {
    pub fn new(model_bytes: &[u8]) -> TractResult<Self> {
        let model = tract_onnx::onnx()
            .model_for_read(&mut std::io::Cursor::new(model_bytes))?
            .into_optimized()?
            .into_runnable()?;
        Ok(Self { model })
    }

    pub fn detect(
        &self,
        img: &image::DynamicImage,
        conf_threshold: f32,
        iou_threshold: f32,
    ) -> TractResult<Vec<Detection>> {
        let (tensor, scale, pad_x, pad_y) = preprocess_yolo(img, 640);

        let result = self.model.run(tvec![tensor.into()])?;
        let output = result[0].to_array_view::<f32>()?;

        // Output shape: [1, 4+num_classes, num_detections]
        let shape = output.shape();
        let num_features = shape[1];
        let num_detections = shape[2];
        let num_classes = num_features - 4;

        let (orig_w, orig_h) = img.dimensions();
        let mut detections = Vec::new();

        for j in 0..num_detections {
            let cx = output[[0, 0, j]];
            let cy = output[[0, 1, j]];
            let w = output[[0, 2, j]];
            let h = output[[0, 3, j]];

            // Find best class
            let mut best_class = 0;
            let mut best_score = f32::NEG_INFINITY;
            for c in 0..num_classes {
                let score = output[[0, 4 + c, j]];
                if score > best_score {
                    best_score = score;
                    best_class = c;
                }
            }

            if best_score < conf_threshold {
                continue;
            }

            // Convert from padded 640x640 coords to original image coords
            let x = ((cx - w / 2.0) - pad_x) / scale;
            let y = ((cy - h / 2.0) - pad_y) / scale;
            let bw = w / scale;
            let bh = h / scale;

            detections.push(Detection {
                x: x.max(0.0).min(orig_w as f32),
                y: y.max(0.0).min(orig_h as f32),
                w: bw.min(orig_w as f32 - x),
                h: bh.min(orig_h as f32 - y),
                confidence: best_score,
                class_id: best_class,
            });
        }

        nms(&mut detections, iou_threshold);
        Ok(detections)
    }
}

fn nms(detections: &mut Vec<Detection>, iou_threshold: f32) {
    detections.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap());
    let mut keep = vec![true; detections.len()];

    for i in 0..detections.len() {
        if !keep[i] {
            continue;
        }
        for j in (i + 1)..detections.len() {
            if !keep[j] {
                continue;
            }
            if iou(&detections[i], &detections[j]) > iou_threshold {
                keep[j] = false;
            }
        }
    }

    let mut idx = 0;
    detections.retain(|_| {
        let k = keep[idx];
        idx += 1;
        k
    });
}

fn iou(a: &Detection, b: &Detection) -> f32 {
    let x1 = a.x.max(b.x);
    let y1 = a.y.max(b.y);
    let x2 = (a.x + a.w).min(b.x + b.w);
    let y2 = (a.y + a.h).min(b.y + b.h);

    let intersection = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
    let area_a = a.w * a.h;
    let area_b = b.w * b.h;
    let union = area_a + area_b - intersection;

    if union <= 0.0 {
        0.0
    } else {
        intersection / union
    }
}
