//! macOS ScreenCaptureKit and CoreAudio based capture logic.
//! This module will act as the Rust-side pipeline driver if we were fetching raw frames directly into Rust. 
//! However, for performance we're acquiring and encoding directly in C++ via MacVideoDecoder & ScreenCaptureKit in Objective-C.
//! This module represents the stub for Phase 2 rust-level orchestration.

use anyhow::Result;

pub struct MacCapturer {
    pub display_index: u32,
}

impl MacCapturer {
    pub fn new(display_index: u32) -> Result<Self> {
        Ok(Self { display_index })
    }
}
