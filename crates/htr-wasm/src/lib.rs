use wasm_bindgen::prelude::*;

mod utils;

#[wasm_bindgen(start)]
pub fn init() {
    utils::set_panic_hook();
}

#[wasm_bindgen]
pub fn greet() -> String {
    "htr-wasm initialized (tract backend)".to_string()
}
