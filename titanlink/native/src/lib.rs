//! TitanLink Hardware Capture - Ultra-Low Latency Screen Capture
//!
//! This native addon provides:
//! - DXGI Desktop Duplication for fast screen capture (~1-2ms)
//! - NVENC H264 encoding for hardware-accelerated compression (~3-5ms)
//! - Zero-copy GPU pipeline for minimal latency

#![deny(clippy::all)]

mod capture;
mod encoder;
mod pipeline;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadSafeCallContext;
use napi_derive::napi;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Check if the native addon loaded successfully
#[napi]
pub fn health_check() -> String {
    "TitanLink Capture Native Addon v0.1.0 - OK".to_string()
}

/// Hardware encoder availability
#[napi(object)]
pub struct EncoderSupport {
    /// NVIDIA NVENC available
    pub nvenc: bool,
    /// AMD AMF available (future)
    pub amf: bool,
    /// Intel QuickSync available (future)
    pub quicksync: bool,
    /// Software x264 fallback
    pub software: bool,
}

/// Check which hardware encoders are available on this system
#[napi]
pub fn get_encoder_support() -> EncoderSupport {
    // For now, just check if we can load NVENC
    let nvenc = encoder::nvenc::is_available();
    
    EncoderSupport {
        nvenc,
        amf: false,      // TODO: Implement AMD AMF detection
        quicksync: false, // TODO: Implement Intel QuickSync detection
        software: true,   // x264 always available as fallback
    }
}

/// Display information for capture
#[napi(object)]
#[derive(Clone)]
pub struct DisplayInfo {
    /// Display index (0-based)
    pub index: u32,
    /// Display name
    pub name: String,
    /// Width in pixels
    pub width: u32,
    /// Height in pixels
    pub height: u32,
    /// Primary display flag
    pub is_primary: bool,
}

/// Get list of available displays for capture
#[napi]
pub fn get_displays() -> Result<Vec<DisplayInfo>> {
    capture::dxgi::enumerate_displays()
        .map_err(|e| Error::from_reason(format!("Failed to enumerate displays: {}", e)))
}

/// Capture settings
#[napi(object)]
#[derive(Clone)]
pub struct CaptureSettings {
    /// Display index to capture
    pub display_index: u32,
    /// Target frames per second
    pub fps: u32,
    /// Target bitrate in bits per second
    pub bitrate: u32,
    /// Use hardware encoder (NVENC if available)
    pub use_hardware_encoder: bool,
}

impl Default for CaptureSettings {
    fn default() -> Self {
        Self {
            display_index: 0,
            fps: 60,
            bitrate: 10_000_000, // 10 Mbps
            use_hardware_encoder: true,
        }
    }
}

/// Encoded frame data
#[napi(object)]
pub struct EncodedFrame {
    /// Frame number (sequential)
    pub frame_number: u32,
    /// Timestamp in microseconds
    pub timestamp_us: i64,
    /// Is this a keyframe (I-frame)?
    pub is_keyframe: bool,
    /// Encoded H264 data (Annex B format)
    pub data: Buffer,
}

/// Capture pipeline state
static CAPTURE_RUNNING: AtomicBool = AtomicBool::new(false);

/// Start hardware capture and encoding
/// 
/// Returns a stream of encoded frames via the callback
#[napi]
pub fn start_capture(
    settings: CaptureSettings,
    #[napi(ts_arg_type = "(frame: EncodedFrame) => void")]
    callback: JsFunction,
) -> Result<()> {
    if CAPTURE_RUNNING.swap(true, Ordering::SeqCst) {
        return Err(Error::from_reason("Capture already running"));
    }

    // Create threadsafe callback
    let tsfn = callback.create_threadsafe_function(0, |ctx: ThreadSafeCallContext<EncodedFrame>| {
        Ok(vec![ctx.value])
    })?;

    // Start capture pipeline in background thread
    std::thread::spawn(move || {
        if let Err(e) = pipeline::run_capture_pipeline(settings, tsfn.clone()) {
            eprintln!("[TitanLink Capture] Pipeline error: {}", e);
        }
        CAPTURE_RUNNING.store(false, Ordering::SeqCst);
        tsfn.abort().ok();
    });

    Ok(())
}

/// Stop the running capture
#[napi]
pub fn stop_capture() -> Result<()> {
    if !CAPTURE_RUNNING.swap(false, Ordering::SeqCst) {
        return Err(Error::from_reason("Capture not running"));
    }
    Ok(())
}

/// Check if capture is currently running
#[napi]
pub fn is_capture_running() -> bool {
    CAPTURE_RUNNING.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_check() {
        let result = health_check();
        assert!(result.contains("OK"));
    }
}
