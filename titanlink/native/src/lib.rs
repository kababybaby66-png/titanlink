//! TitanLink Hardware Capture - Ultra-Low Latency Screen Capture

#![deny(clippy::all)]

mod capture;
mod encoder;
mod pipeline;
mod network;  // Custom UDP protocol

// Re-export NetworkClient for NAPI-RS bindings
pub use network::NetworkClient;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadSafeCallContext;
use napi_derive::napi;
use std::sync::atomic::{AtomicBool, Ordering};

static CAPTURE_RUNNING: AtomicBool = AtomicBool::new(false);

#[napi]
pub fn health_check() -> String {
    "TitanLink Capture Native Addon v0.1.0 - OK".to_string()
}

#[napi(object)]
pub struct EncoderSupport {
    pub nvenc: bool,
    pub amf: bool,
    pub quicksync: bool,
    pub software: bool,
}

#[napi]
pub fn get_encoder_support() -> EncoderSupport {
    EncoderSupport {
        nvenc: encoder::nvenc::is_available(),
        amf: false,
        quicksync: false,
        software: true,
    }
}

#[napi(object)]
#[derive(Clone)]
pub struct DisplayInfo {
    pub index: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

#[napi]
pub fn get_displays() -> Result<Vec<DisplayInfo>> {
    capture::dxgi::enumerate_displays()
        .map_err(|e| Error::from_reason(format!("Failed to enumerate displays: {}", e)))
}

#[napi(object)]
#[derive(Clone)]
pub struct CaptureSettings {
    pub display_index: u32,
    pub fps: u32,
    pub bitrate: u32,
    pub use_hardware_encoder: bool,
    pub codec: String, // "h264", "hevc", "av1"
}

impl Default for CaptureSettings {
    fn default() -> Self {
        Self {
            display_index: 0,
            fps: 60,
            bitrate: 10_000_000,
            use_hardware_encoder: true,
            codec: "h264".to_string(),
        }
    }
}

#[napi(object)]
pub struct EncodedFrame {
    pub frame_number: u32,
    pub timestamp_us: i64,
    pub is_keyframe: bool,
    pub data: Buffer,
}

#[napi]
pub fn start_capture(
    settings: CaptureSettings,
    #[napi(ts_arg_type = "(frame: EncodedFrame) => void")]
    callback: JsFunction,
) -> Result<()> {
    if CAPTURE_RUNNING.swap(true, Ordering::SeqCst) {
        return Err(Error::from_reason("Capture already running"));
    }

    let tsfn = callback.create_threadsafe_function(0, |ctx: ThreadSafeCallContext<EncodedFrame>| {
        Ok(vec![ctx.value])
    })?;

    std::thread::spawn(move || {
        if let Err(e) = pipeline::run_capture_pipeline(settings, tsfn.clone()) {
            eprintln!("[TitanLink] Pipeline error: {:?}", e);
        }
        CAPTURE_RUNNING.store(false, Ordering::SeqCst);
        tsfn.abort().ok();
    });

    Ok(())
}

#[napi]
pub fn stop_capture() -> Result<()> {
    if !CAPTURE_RUNNING.swap(false, Ordering::SeqCst) {
        return Err(Error::from_reason("Capture not running"));
    }
    Ok(())
}

#[napi]
pub fn is_capture_running() -> bool {
    CAPTURE_RUNNING.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_check() {
        assert!(health_check().contains("OK"));
    }
}
