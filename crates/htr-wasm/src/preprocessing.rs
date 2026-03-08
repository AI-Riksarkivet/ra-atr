use image::{DynamicImage, GenericImageView, imageops::FilterType};
use tract_onnx::prelude::*;

/// Resize image to target_size, pad to square with letterboxing.
/// Returns (preprocessed tensor, scale, pad_x, pad_y).
pub fn preprocess_yolo(
    img: &DynamicImage,
    target_size: u32,
) -> (Tensor, f32, f32, f32) {
    let (orig_w, orig_h) = img.dimensions();
    let scale = (target_size as f32 / orig_w as f32).min(target_size as f32 / orig_h as f32);
    let new_w = (orig_w as f32 * scale) as u32;
    let new_h = (orig_h as f32 * scale) as u32;

    let resized = img.resize_exact(new_w, new_h, FilterType::Lanczos3);
    let mut padded = DynamicImage::new_rgb8(target_size, target_size);
    let pad_x = (target_size - new_w) / 2;
    let pad_y = (target_size - new_h) / 2;

    image::imageops::overlay(&mut padded, &resized, pad_x as i64, pad_y as i64);

    let ts = target_size as usize;
    let mut data = vec![0f32; 3 * ts * ts];
    for y in 0..target_size {
        for x in 0..target_size {
            let pixel = padded.get_pixel(x, y);
            let idx = y as usize * ts + x as usize;
            data[idx] = pixel[0] as f32 / 255.0;
            data[ts * ts + idx] = pixel[1] as f32 / 255.0;
            data[2 * ts * ts + idx] = pixel[2] as f32 / 255.0;
        }
    }

    let tensor = tract_ndarray::Array4::from_shape_vec((1, 3, ts, ts), data)
        .unwrap()
        .into_tensor();

    (tensor, scale, pad_x as f32, pad_y as f32)
}

/// Resize and normalize a cropped line image for TrOCR.
/// Returns tensor of shape [1, 3, 384, 384].
pub fn preprocess_trocr(img: &DynamicImage) -> Tensor {
    let resized = img.resize_exact(384, 384, FilterType::Lanczos3);
    let mean = [0.5f32, 0.5, 0.5];
    let std = [0.5f32, 0.5, 0.5];

    let mut data = vec![0f32; 3 * 384 * 384];
    for y in 0..384u32 {
        for x in 0..384u32 {
            let pixel = resized.get_pixel(x, y);
            let idx = y as usize * 384 + x as usize;
            data[idx] = (pixel[0] as f32 / 255.0 - mean[0]) / std[0];
            data[384 * 384 + idx] = (pixel[1] as f32 / 255.0 - mean[1]) / std[1];
            data[2 * 384 * 384 + idx] = (pixel[2] as f32 / 255.0 - mean[2]) / std[2];
        }
    }

    tract_ndarray::Array4::from_shape_vec((1, 3, 384, 384), data)
        .unwrap()
        .into_tensor()
}
