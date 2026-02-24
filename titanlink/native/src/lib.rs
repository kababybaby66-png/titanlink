//! TitanLink Hardware Capture - Ultra-Low Latency Screen Capture

#![deny(clippy::all)]

#[cfg(target_os = "windows")]
mod capture;
#[cfg(target_os = "windows")]
mod encoder;
mod network;
#[cfg(target_os = "windows")]
mod pipeline; // Custom UDP protocol


// Re-export NetworkClient for NAPI-RS bindings
pub use network::NetworkClient;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadSafeCallContext;
use napi_derive::napi;
use std::sync::atomic::{AtomicBool, Ordering};

static CAPTURE_RUNNING: AtomicBool = AtomicBool::new(false);

#[napi]
pub fn health_check() -> String {
    "TitanLink Capture Native Addon v0.1.0 - NVENC FIX ENABLED (Build v2)".to_string()
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
    #[cfg(target_os = "windows")]
    {
        EncoderSupport {
            nvenc: encoder::nvenc::is_available(),
            amf: false,
            quicksync: encoder::quicksync::is_available(),
            software: true,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        EncoderSupport {
            nvenc: false,
            amf: false,
            quicksync: false,
            software: true,
        }
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
    #[cfg(target_os = "windows")]
    {
        capture::dxgi::enumerate_displays()
            .map_err(|e| Error::from_reason(format!("Failed to enumerate displays: {}", e)))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![])
    }
}

#[napi(object)]
#[derive(Clone)]
pub struct CaptureSettings {
    pub display_index: u32,
    pub fps: u32,
    pub bitrate: u32,
    pub use_hardware_encoder: bool,
    pub codec: String,       // "h264", "hevc", "av1"
    pub bitrate_mode: String, // "cbr" or "vbr"
}

impl Default for CaptureSettings {
    fn default() -> Self {
        Self {
            display_index: 0,
            fps: 60,
            bitrate: 10_000_000,
            use_hardware_encoder: true,
            codec: "h264".to_string(),
            bitrate_mode: "cbr".to_string(),
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
    #[napi(ts_arg_type = "(frame: EncodedFrame) => void")] callback: JsFunction,
) -> Result<()> {
    if CAPTURE_RUNNING.swap(true, Ordering::SeqCst) {
        return Err(Error::from_reason("Capture already running"));
    }

    let tsfn = callback
        .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<EncodedFrame>| {
            Ok(vec![ctx.value])
        })?;

    #[cfg(target_os = "windows")]
    {
        std::thread::spawn(move || {
            if let Err(e) = pipeline::run_capture_pipeline(settings, tsfn.clone()) {
                eprintln!("[TitanLink] Pipeline error: {:?}", e);
            }
            CAPTURE_RUNNING.store(false, Ordering::SeqCst);
            tsfn.abort().ok();
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::thread::spawn(move || {
            eprintln!("[TitanLink] Hardware capture is not yet implemented on this platform");
            CAPTURE_RUNNING.store(false, Ordering::SeqCst);
            tsfn.abort().ok();
        });
    }

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

// ============================================
// Audio Capture (WASAPI)
// ============================================

static AUDIO_RUNNING: AtomicBool = AtomicBool::new(false);

#[napi(object)]
pub struct AudioCaptureSettings {
    pub sample_rate: u32,       // 44100 or 48000
    pub quality_mode: String,   // "game" or "voice"
}

#[napi(object)]
pub struct AudioFrame {
    pub data: Buffer,
    pub sample_rate: u32,
    pub channels: u32,
    pub bits_per_sample: u32,
    pub frame_count: u32,
    pub timestamp_us: i64,
}

#[napi]
pub fn is_audio_available() -> bool {
    #[cfg(target_os = "windows")]
    {
        capture::audio::wasapi::is_available()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[napi]
pub fn start_audio_capture(
    settings: AudioCaptureSettings,
    #[napi(ts_arg_type = "(frame: AudioFrame) => void")] callback: JsFunction,
) -> Result<()> {
    if AUDIO_RUNNING.swap(true, Ordering::SeqCst) {
        return Err(Error::from_reason("Audio capture already running"));
    }

    let tsfn: napi::threadsafe_function::ThreadsafeFunction<AudioFrame> = callback
        .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<AudioFrame>| {
            Ok(vec![ctx.value])
        })?;

    #[cfg(target_os = "windows")]
    {
        let wasapi_settings = capture::audio::wasapi::AudioCaptureSettings {
            sample_rate: settings.sample_rate,
            quality_mode: settings.quality_mode,
        };

        std::thread::spawn(move || {
            let tsfn_clone = tsfn.clone();
            let result = capture::audio::wasapi::run_audio_capture(wasapi_settings, move |buffer| {
                let frame = AudioFrame {
                    data: Buffer::from(buffer.data),
                    sample_rate: buffer.format.sample_rate,
                    channels: buffer.format.channels as u32,
                    bits_per_sample: buffer.format.bits_per_sample as u32,
                    frame_count: buffer.frame_count,
                    timestamp_us: buffer.timestamp_us,
                };
                tsfn_clone.call(Ok(frame), napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking);
            });

            if let Err(e) = result {
                eprintln!("[TitanLink] Audio capture error: {:?}", e);
            }

            AUDIO_RUNNING.store(false, Ordering::SeqCst);
            tsfn.abort().ok();
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::thread::spawn(move || {
            eprintln!("[TitanLink] Audio capture is not yet implemented on this platform");
            AUDIO_RUNNING.store(false, Ordering::SeqCst);
            tsfn.abort().ok();
        });
    }

    Ok(())
}

#[napi]
pub fn stop_audio_capture() -> Result<()> {
    if !AUDIO_RUNNING.swap(false, Ordering::SeqCst) {
        return Err(Error::from_reason("Audio capture not running"));
    }
    #[cfg(target_os = "windows")]
    {
        capture::audio::wasapi::stop_capture();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_check() {
        assert!(health_check().contains("OK"));
    }
}
