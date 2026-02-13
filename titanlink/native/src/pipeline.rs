use crate::capture::dxgi::DxgiCapturer;
use crate::encoder::nvenc::{NvencConfig, NvencEncoder};
use crate::encoder::quicksync::QuickSyncEncoder;
use crate::encoder::software::SoftwareEncoder;
use crate::{CaptureSettings, EncodedFrame};
use anyhow::{Context, Result};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use windows::core::Interface;
use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;

/// Global flag to signal capture loop to stop
static SHOULD_STOP: AtomicBool = AtomicBool::new(false);

/// Signal the capture loop to stop
pub fn signal_stop() {
    SHOULD_STOP.store(true, Ordering::SeqCst);
}

/// Check if stop was signaled
fn should_stop() -> bool {
    SHOULD_STOP.load(Ordering::SeqCst)
}

/// Encoder wrapper for either hardware or software encoding
enum Encoder {
    Nvenc(NvencEncoder),
    QuickSync(QuickSyncEncoder),
    Software(SoftwareEncoder),
}

impl Encoder {
    fn encode_cpu(&mut self, data: &[u8], force_keyframe: bool) -> Result<(Vec<u8>, bool)> {
        match self {
            Encoder::Nvenc(enc) => {
                let packet = enc.encode_bgra(data, force_keyframe)?;
                Ok((packet.data, packet.is_keyframe))
            }
            Encoder::QuickSync(enc) => {
                let data = enc.encode_bgra(data, force_keyframe)?;
                Ok((data, force_keyframe))
            }
            Encoder::Software(enc) => {
                let data = enc.encode(data)?;
                Ok((data, force_keyframe))
            }
        }
    }

    fn encode_gpu(
        &mut self,
        texture: *mut c_void,
        force_keyframe: bool,
    ) -> Result<(Vec<u8>, bool)> {
        match self {
            Encoder::Nvenc(enc) => {
                let packet = enc.encode_texture(texture, force_keyframe)?;
                Ok((packet.data, packet.is_keyframe))
            }
            Encoder::QuickSync(_) | Encoder::Software(_) => {
                anyhow::bail!(
                    "QuickSync/Software encoder cannot handle GPU textures (use CPU capture)"
                )
            }
        }
    }
}

/// Run the capture pipeline
///
/// This function runs in a background thread and captures/encodes frames
/// continuously until stop is signaled.
pub fn run_capture_pipeline(
    settings: CaptureSettings,
    callback: ThreadsafeFunction<EncodedFrame>,
) -> Result<()> {
    // Reset stop flag
    SHOULD_STOP.store(false, Ordering::SeqCst);

    // Calculate frame interval - supports 1-240 Hz
    let frame_interval = Duration::from_secs_f64(1.0 / settings.fps as f64);
    eprintln!(
        "[Pipeline] === CAPTURE SETTINGS ===\n\
         [Pipeline]   FPS: {} (interval: {:?})\n\
         [Pipeline]   Bitrate: {} bps ({:.1} Mbps)\n\
         [Pipeline]   Codec: {}\n\
         [Pipeline]   Bitrate Mode: {}\n\
         [Pipeline]   Hardware Encoder: {}\n\
         [Pipeline]   Display Index: {}\n\
         [Pipeline] ========================",
        settings.fps, frame_interval,
        settings.bitrate, settings.bitrate as f64 / 1_000_000.0,
        settings.codec,
        settings.bitrate_mode,
        settings.use_hardware_encoder,
        settings.display_index,
    );

    // Initialize DXGI capturer
    let mut capturer =
        DxgiCapturer::new(settings.display_index).context("Failed to initialize DXGI capturer")?;

    let (width, height) = capturer.dimensions();
    println!(
        "[Pipeline] Initialized capture: {}x{} @ {}fps (interval: {:?})",
        width, height, settings.fps, frame_interval
    );

    // Initialize encoder
    let mut encoder = if settings.use_hardware_encoder && crate::encoder::nvenc::is_available() {
        println!(
            "[Pipeline] Using NVENC hardware encoder ({})",
            settings.codec
        );

        let codec = match settings.codec.to_lowercase().as_str() {
            "hevc" | "h265" => crate::encoder::nvenc::VideoCodec::HEVC,
            "av1" => crate::encoder::nvenc::VideoCodec::AV1,
            _ => crate::encoder::nvenc::VideoCodec::H264,
        };

        let rate_control = match settings.bitrate_mode.to_lowercase().as_str() {
            "vbr" => crate::encoder::nvenc::RateControl::Vbr,
            _ => crate::encoder::nvenc::RateControl::CbrLowDelay,
        };

        let max_bitrate = if matches!(rate_control, crate::encoder::nvenc::RateControl::Vbr) {
            settings.bitrate * 2 // VBR allows up to 2x average
        } else {
            settings.bitrate
        };

        let config = NvencConfig {
            bitrate: settings.bitrate,
            max_bitrate,
            framerate: settings.fps,
            codec,
            rate_control,
            ..Default::default()
        };

        match NvencEncoder::new(width, height, config) {
            Ok(enc) => Encoder::Nvenc(enc),
            Err(e) => {
                println!("[Pipeline] NVENC init failed, trying QuickSync: {}", e);
                if crate::encoder::quicksync::is_available() {
                    println!(
                        "[Pipeline] Using QuickSync hardware encoder ({})",
                        settings.codec
                    );
                    match QuickSyncEncoder::new(width, height) {
                        Ok(enc) => Encoder::QuickSync(enc),
                        Err(e2) => {
                            println!("[Pipeline] QuickSync init failed, using software: {}", e2);
                            Encoder::Software(SoftwareEncoder::new(width, height))
                        }
                    }
                } else {
                    println!("[Pipeline] Using software encoder");
                    Encoder::Software(SoftwareEncoder::new(width, height))
                }
            }
        }
    } else if settings.use_hardware_encoder && crate::encoder::quicksync::is_available() {
        println!(
            "[Pipeline] Using QuickSync hardware encoder ({})",
            settings.codec
        );
        match QuickSyncEncoder::new(width, height) {
            Ok(enc) => Encoder::QuickSync(enc),
            Err(e) => {
                println!("[Pipeline] QuickSync init failed, using software: {}", e);
                Encoder::Software(SoftwareEncoder::new(width, height))
            }
        }
    } else {
        println!("[Pipeline] Using software encoder");
        Encoder::Software(SoftwareEncoder::new(width, height))
    };

    let mut frame_number: u32 = 0;
    let mut last_frame_time = Instant::now();
    let keyframe_interval = settings.fps.max(60); // At least every second, more frequent for high FPS
    let log_interval = (settings.fps * 2).max(60); // Log every 2 seconds, at minimum every second

    println!(
        "[Pipeline] Starting {}fps capture loop (keyframe every {} frames, log every {} frames)",
        settings.fps, keyframe_interval, log_interval
    );

    loop {
        if should_stop() {
            println!("[Pipeline] Stop signal received");
            break;
        }

        // Calculate time until next frame
        let elapsed = last_frame_time.elapsed();
        if elapsed < frame_interval {
            // High-performance spin-wait for precise timing
            let spin_wait = frame_interval - elapsed;
            let start_spin = Instant::now();
            while start_spin.elapsed() < spin_wait {
                std::hint::spin_loop();
            }
        }

        let capture_start = Instant::now();
        let remaining = 0; // No timeout needed with precise timing

        let frame_result = match encoder {
            Encoder::Nvenc(_) => {
                // Capture GPU texture, copy to CPU, encode (copy-based path)
                match capturer.capture_frame_cpu(remaining) {
                    Ok(Some(pixels)) => {
                        let capture_time = capture_start.elapsed();
                        let encode_start = Instant::now();
                        let force_keyframe = frame_number % keyframe_interval == 0;

                        match encoder.encode_cpu(&pixels, force_keyframe) {
                            Ok((data, is_keyframe)) => {
                                Some((data, is_keyframe, capture_time, encode_start.elapsed()))
                            }
                            Err(e) => {
                                eprintln!("[Pipeline] NVENC Encode error: {}", e);
                                None
                            }
                        }
                    }
                    Ok(None) => None,
                    Err(e) => {
                        eprintln!("[Pipeline] CPU Capture error: {}", e);
                        if e.to_string().contains("Access lost") {
                            println!("[NVENC] Access lost, restarting...");
                            match DxgiCapturer::new(settings.display_index) {
                                Ok(new_cap) => capturer = new_cap,
                                Err(_) => break,
                            }
                        }
                        None
                    }
                }
            }
            Encoder::QuickSync(_) => {
                // CPU capture -> QuickSync encode
                match capturer.capture_frame_cpu(remaining) {
                    Ok(Some(pixels)) => {
                        let capture_time = capture_start.elapsed();
                        let encode_start = Instant::now();
                        let force_keyframe = frame_number % keyframe_interval == 0;

                        match encoder.encode_cpu(&pixels, force_keyframe) {
                            Ok((data, is_keyframe)) => {
                                Some((data, is_keyframe, capture_time, encode_start.elapsed()))
                            }
                            Err(e) => {
                                eprintln!("[Pipeline] QuickSync Encode error: {}", e);
                                None
                            }
                        }
                    }
                    Ok(None) => None,
                    Err(e) => {
                        eprintln!("[QuickSync] CPU Capture error: {}", e);
                        if e.to_string().contains("Access lost") {
                            println!("[QuickSync] Access lost, restarting...");
                            match DxgiCapturer::new(settings.display_index) {
                                Ok(new_cap) => capturer = new_cap,
                                Err(_) => break,
                            }
                        }
                        None
                    }
                }
            }
            Encoder::Software(_) => {
                // Fallback: CPU Capture -> Encode
                match capturer.capture_frame_cpu(remaining) {
                    Ok(Some(pixels)) => {
                        let capture_time = capture_start.elapsed();
                        let encode_start = Instant::now();
                        let force_keyframe = frame_number % keyframe_interval == 0;

                        match encoder.encode_cpu(&pixels, force_keyframe) {
                            Ok((data, is_keyframe)) => {
                                Some((data, is_keyframe, capture_time, encode_start.elapsed()))
                            }
                            Err(e) => {
                                eprintln!("[Pipeline] CPU Encode error: {}", e);
                                None
                            }
                        }
                    }
                    Ok(None) => None,
                    Err(e) => {
                        eprintln!("[Pipeline] CPU Capture error: {}", e);
                        if e.to_string().contains("Access lost") {
                            // Recreate capturer logic (removed for brevity, but needed in prod)
                            println!("[Pipeline] Access lost, restarting...");
                            match DxgiCapturer::new(settings.display_index) {
                                Ok(new_cap) => capturer = new_cap,
                                Err(_) => break,
                            }
                        }
                        None
                    }
                }
            }
        };

        match frame_result {
            Some((data, is_keyframe, capture_time, encode_time)) => {
                // Create encoded frame
                let timestamp_us = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_micros() as i64;

                let frame = EncodedFrame {
                    frame_number,
                    timestamp_us,
                    is_keyframe,
                    data: data.into(),
                };

                // Send to JavaScript callback
                let call_result = callback.call(Ok(frame), ThreadsafeFunctionCallMode::NonBlocking);
                if call_result != napi::Status::Ok {
                    eprintln!("[Pipeline] Failed to call JS callback");
                }

                // Log timing periodically (every 2 seconds)
                if frame_number % log_interval == 0 {
                    println!(
                        "[Pipeline] Frame {} ({}fps log) - Capture: {:?}, Encode: {:?}",
                        frame_number, settings.fps, capture_time, encode_time
                    );
                }

                frame_number += 1;
                last_frame_time = Instant::now();
            }
            None => {
                // Missed frame - continue immediately
            }
        }
    }

    println!(
        "[Pipeline] Capture loop ended after {} frames",
        frame_number
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: These tests require a display to be available
    // They may fail in headless CI environments
}
