use std::path::Path;

fn models_dir() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("models")
}

#[test]
fn test_load_yolo_model() {
    // Try unquantized first, then int8
    let yolo_path = if models_dir().join("yolo-lines.onnx").exists() {
        models_dir().join("yolo-lines.onnx")
    } else {
        models_dir().join("yolo-lines-int8.onnx")
    };
    if !yolo_path.exists() {
        eprintln!("Skipping: yolo-lines-int8.onnx not found");
        return;
    }
    eprintln!("Loading YOLO model ({:.1} MB)...", std::fs::metadata(&yolo_path).unwrap().len() as f64 / 1024.0 / 1024.0);

    let bytes = std::fs::read(&yolo_path).unwrap();
    let model = htr_wasm::yolo::YoloModel::new(&bytes);
    match model {
        Ok(_) => eprintln!("YOLO model loaded successfully!"),
        Err(e) => panic!("Failed to load YOLO model: {e}"),
    }
}

#[test]
fn test_load_trocr_encoder() {
    let path = if models_dir().join("encoder.onnx").exists() {
        models_dir().join("encoder.onnx")
    } else {
        models_dir().join("encoder-int8.onnx")
    };
    if !path.exists() {
        eprintln!("Skipping: encoder-int8.onnx not found");
        return;
    }
    eprintln!("Loading TrOCR encoder ({:.1} MB)...", std::fs::metadata(&path).unwrap().len() as f64 / 1024.0 / 1024.0);

    let bytes = std::fs::read(&path).unwrap();
    let result = tract_onnx::onnx()
        .model_for_read(&mut std::io::Cursor::new(&bytes));
    match result {
        Ok(model) => {
            eprintln!("  Parsed OK, optimizing...");
            match model.into_optimized() {
                Ok(opt) => {
                    eprintln!("  Optimized! Inputs: {:?}", opt.input_fact(0));
                    match opt.into_runnable() {
                        Ok(_) => eprintln!("  Runnable! TrOCR encoder ready."),
                        Err(e) => panic!("Failed to make runnable: {e}"),
                    }
                }
                Err(e) => panic!("Failed to optimize encoder: {e}"),
            }
        }
        Err(e) => panic!("Failed to parse encoder ONNX: {e}"),
    }
}

#[test]
fn test_load_trocr_decoder() {
    let path = if models_dir().join("decoder.onnx").exists() {
        models_dir().join("decoder.onnx")
    } else {
        models_dir().join("decoder-int8.onnx")
    };
    if !path.exists() {
        eprintln!("Skipping: decoder-int8.onnx not found");
        return;
    }
    eprintln!("Loading TrOCR decoder ({:.1} MB)...", std::fs::metadata(&path).unwrap().len() as f64 / 1024.0 / 1024.0);

    let bytes = std::fs::read(&path).unwrap();
    let result = tract_onnx::onnx()
        .model_for_read(&mut std::io::Cursor::new(&bytes));
    match result {
        Ok(model) => {
            eprintln!("  Parsed OK, optimizing...");
            match model.into_optimized() {
                Ok(opt) => {
                    eprintln!("  Optimized! Inputs: {:?}", opt.input_fact(0));
                    match opt.into_runnable() {
                        Ok(_) => eprintln!("  Runnable! TrOCR decoder ready."),
                        Err(e) => panic!("Failed to make runnable: {e}"),
                    }
                }
                Err(e) => panic!("Failed to optimize decoder: {e}"),
            }
        }
        Err(e) => panic!("Failed to parse decoder ONNX: {e}"),
    }
}

use tract_onnx::prelude::*;

#[test]
fn test_load_encoder_with_fixed_shapes() {
    let path = models_dir().join("encoder.onnx");
    if !path.exists() {
        eprintln!("Skipping: encoder.onnx not found");
        return;
    }
    eprintln!("Loading encoder with fixed input shapes...");
    let bytes = std::fs::read(&path).unwrap();
    let mut model = tract_onnx::onnx()
        .model_for_read(&mut std::io::Cursor::new(&bytes))
        .expect("Failed to parse");

    // Set concrete input shape: [1, 3, 384, 384]
    model.set_input_fact(0, f32::fact([1, 3, 384, 384]).into()).expect("set input");
    eprintln!("  Input set, optimizing...");

    match model.into_optimized() {
        Ok(opt) => {
            eprintln!("  Optimized! Making runnable...");
            let runnable = opt.into_runnable().expect("into_runnable");

            // Test with dummy input
            let input = tract_ndarray::Array4::<f32>::zeros((1, 3, 384, 384)).into_tensor();
            let result = runnable.run(tvec![input.into()]).expect("run");
            eprintln!("  Output shape: {:?}", result[0].shape());
            assert_eq!(result[0].shape()[0], 1);
            eprintln!("  Encoder works!");
        }
        Err(e) => panic!("Optimize failed: {e}"),
    }
}

#[test]
fn test_load_decoder_with_fixed_shapes() {
    let path = models_dir().join("decoder.onnx");
    if !path.exists() {
        eprintln!("Skipping: decoder.onnx not found");
        return;
    }
    eprintln!("Loading decoder with fixed input shapes...");
    let bytes = std::fs::read(&path).unwrap();
    let mut model = tract_onnx::onnx()
        .model_for_read(&mut std::io::Cursor::new(&bytes))
        .expect("Failed to parse");

    // Set concrete input shapes for first token: input_ids=[1,1], mask=[1,1], hidden=[1,577,768]
    model.set_input_fact(0, i64::fact([1, 1]).into()).expect("set input_ids");
    model.set_input_fact(1, i64::fact([1, 1]).into()).expect("set mask");
    model.set_input_fact(2, f32::fact([1, 577, 768]).into()).expect("set hidden");
    eprintln!("  Inputs set, optimizing...");

    match model.into_optimized() {
        Ok(opt) => {
            eprintln!("  Optimized! Making runnable...");
            let runnable = opt.into_runnable().expect("into_runnable");

            let ids = tract_ndarray::Array2::<i64>::from_elem((1, 1), 2).into_tensor();
            let mask = tract_ndarray::Array2::<i64>::ones((1, 1)).into_tensor();
            let hidden = tract_ndarray::Array3::<f32>::zeros((1, 577, 768)).into_tensor();

            let result = runnable.run(tvec![ids.into(), mask.into(), hidden.into()]).expect("run");
            eprintln!("  Output shape: {:?}", result[0].shape());
            // Should be [1, 1, 50265]
            assert_eq!(result[0].shape(), &[1, 1, 50265]);
            eprintln!("  Decoder works!");
        }
        Err(e) => panic!("Optimize failed: {e}"),
    }
}

#[test]
fn test_yolo_detect_on_dummy_image() {
    let yolo_path = if models_dir().join("yolo-lines.onnx").exists() {
        models_dir().join("yolo-lines.onnx")
    } else {
        eprintln!("Skipping: no YOLO model found");
        return;
    };
    let bytes = std::fs::read(&yolo_path).unwrap();
    let model = htr_wasm::yolo::YoloModel::new(&bytes).unwrap();

    // Create a simple white 800x600 image
    let img = image::DynamicImage::new_rgb8(800, 600);
    let detections = model.detect(&img, 0.25, 0.45).unwrap();
    eprintln!("Detections on blank image: {}", detections.len());
    // Blank image should have few/no detections
    assert!(detections.len() < 50, "too many detections on blank image: {}", detections.len());
    eprintln!("YOLO detect works!");
}

#[test]
fn test_full_trocr_pipeline() {
    let enc_path = models_dir().join("encoder.onnx");
    let dec_path = models_dir().join("decoder.onnx");
    let tok_path = models_dir().join("tokenizer.json");
    if !enc_path.exists() || !dec_path.exists() || !tok_path.exists() {
        eprintln!("Skipping: TrOCR model files not found");
        return;
    }

    let enc_bytes = std::fs::read(&enc_path).unwrap();
    let dec_bytes = std::fs::read(&dec_path).unwrap();
    let tok_json = std::fs::read_to_string(&tok_path).unwrap();

    eprintln!("Loading TrOCR model...");
    let model = htr_wasm::trocr::TrOCRModel::new(&enc_bytes, &dec_bytes, &tok_json).unwrap();

    // Create a simple 384x48 white image (like a text line)
    let img = image::DynamicImage::new_rgb8(384, 48);
    eprintln!("Transcribing dummy line...");
    let tokens = std::cell::RefCell::new(Vec::new());
    let text = model.transcribe_line(&img, 20, &|id, t| {
        tokens.borrow_mut().push((id, t.to_string()));
        eprint!("{t}");
    }).unwrap();
    eprintln!();
    let token_count = tokens.borrow().len();
    eprintln!("Transcribed text: '{text}' ({} tokens)", token_count);
    // Just verify it doesn't crash and produces some output
    eprintln!("TrOCR pipeline works!");
}
