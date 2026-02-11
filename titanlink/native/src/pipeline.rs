use crate::capture::dxgi::DxgiCapturer;
use crate::encoder::nvenc::{NvencConfig, NvencEncoder};
use crate::encoder::software::SoftwareEncoder;
use crate::{CaptureSettings, EncodedFrame};
use anyhow::{Context, Result};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;
use windows::core::Interface;

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
    Software(SoftwareEncoder),
}

impl Encoder {
    fn encode_cpu(&mut self, data: &[u8], force_keyframe: bool) -> Result<(Vec<u8>, bool)> {
        match self {
            Encoder::Nvenc(enc) => {
                // Fallback for NVENC if we have CPU data for some reason
                let packet = enc.encode_bgra(data, force_keyframe)?;
                Ok((packet.data, packet.is_keyframe))
            }
            Encoder::Software(enc) => {
                let data = enc.encode(data)?;
                Ok((data, force_keyframe))
            }
        }
    }

    fn encode_gpu(&mut self, texture: *mut c_void, force_keyframe: bool) -> Result<(Vec<u8>, bool)> {
        match self {
            Encoder::Nvenc(enc) => {
                let packet = enc.encode_texture(texture, force_keyframe)?;
                Ok((packet.data, packet.is_keyframe))
            }
            Encoder::Software(_) => anyhow::bail!("Software encoder cannot handle GPU textures"),
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

    // Calculate frame interval
    let frame_interval = Duration::from_secs_f64(1.0 / settings.fps as f64);
    
    // Initialize DXGI capturer
    let mut capturer = DxgiCapturer::new(settings.display_index)
        .context("Failed to initialize DXGI capturer")?;

    let (width, height) = capturer.dimensions();
    println!("[Pipeline] Initialized DXGI capture: {}x{} @ {}fps", width, height, settings.fps);

    // Initialize encoder
    let mut encoder = if settings.use_hardware_encoder && crate::encoder::nvenc::is_available() {
        println!("[Pipeline] Using NVENC hardware encoder ({})", settings.codec);
        
        let codec = match settings.codec.to_lowercase().as_str() {
            "hevc" | "h265" => crate::encoder::nvenc::VideoCodec::HEVC,
            "av1" => crate::encoder::nvenc::VideoCodec::AV1,
            _ => crate::encoder::nvenc::VideoCodec::H264,
        };

        let config = NvencConfig {
            bitrate: settings.bitrate,
            framerate: settings.fps,
            codec,
            ..Default::default()
        };

        // Share the D3D11 device with NVENC for Zero-Copy
        // NvencEncoder expects *mut c_void, standard windows-rs Interface gives us a way to cast
        let device_ptr: *mut c_void = unsafe { std::mem::transmute_copy(capturer.device()) };

        match NvencEncoder::new_from_device(device_ptr, width, height, config) {
            Ok(enc) => Encoder::Nvenc(enc),
            Err(e) => {
                println!("[Pipeline] NVENC init failed, falling back to software: {}", e);
                Encoder::Software(SoftwareEncoder::new(width, height))
            }
        }
    } else {
        println!("[Pipeline] Using software encoder");
        Encoder::Software(SoftwareEncoder::new(width, height))
    };

    let mut frame_number: u32 = 0;
    let mut last_frame_time = Instant::now();
    let keyframe_interval = settings.fps; // Keyframe every 1 second

    println!("[Pipeline] Starting capture loop");

    loop {
        if should_stop() {
            println!("[Pipeline] Stop signal received");
            break;
        }

        // Try to capture a frame
        let capture_start = Instant::now();
        
        // Calculate timeout based on remaining time in frame interval
        let elapsed_since_last = last_frame_time.elapsed();
        let remaining = if elapsed_since_last < frame_interval {
            (frame_interval - elapsed_since_last).as_millis() as u32
        } else {
            1 // At least 1ms timeout
        };

        let frame_result = match encoder {
            Encoder::Nvenc(_) => {
                // Happy Path: Zero-Copy GPU Capture -> Encode
                match capturer.capture_frame_gpu(remaining) {
                    Ok(Some(texture)) => {
                        let capture_time = capture_start.elapsed();
                        let encode_start = Instant::now();
                        let force_keyframe = frame_number % keyframe_interval == 0;

                        // Cast texture to raw pointer for NVENC
                        let texture_ptr: *mut c_void = unsafe { std::mem::transmute_copy(&texture) };

                        let res = encoder.encode_gpu(texture_ptr, force_keyframe);
                        
                        // CRITICAL: Release frame immediately after encode submission
                        capturer.release_frame().ok();
                        
                        match res {
                            Ok((data, is_keyframe)) => Some((data, is_keyframe, capture_time, encode_start.elapsed())),
                            Err(e) => {
                                eprintln!("[Pipeline] GPU Encode error: {}", e);
                                None
                            }
                        }
                    }
                    Ok(None) => None, // No new frame
                    Err(e) => {
                        eprintln!("[Pipeline] GPU Capture error: {}", e);
                        // Access lost handling is complex with shared device...
                        // For now, let loop continue and try to recover next frame or break
                        if e.to_string().contains("Access lost") {
                             // Recreating capturer here is tricky because Encoder holds ref to Device?
                             // Actually Encoder holds the pointer. If Device is recreated, pointer is invalid.
                             // We would need to recreate Encoder too.
                             // For this iteration, just break/log implementation gap.
                             eprintln!("[Pipeline] Critical: Access lost with shared device. Restart required.");
                             break; 
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
                            Ok((data, is_keyframe)) => Some((data, is_keyframe, capture_time, encode_start.elapsed())),
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

                // Log timing periodically
                if frame_number % 60 == 0 {
                    println!(
                        "[Pipeline] Frame {} - Capture: {:?}, Encode: {:?}",
                        frame_number, capture_time, encode_time
                    );
                }

                frame_number += 1;
                last_frame_time = Instant::now();
            }
            None => {
                // Sleep to prevent busy-wait if no frame
                // Especially important if we returned 'None' due to timeout or error
                std::thread::sleep(Duration::from_millis(1));
            }
        }

        // Sleep to maintain frame rate
        let frame_time = last_frame_time.elapsed();
        if frame_time < frame_interval {
            std::thread::sleep(frame_interval - frame_time);
        }
    }

    println!("[Pipeline] Capture loop ended after {} frames", frame_number);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: These tests require a display to be available
    // They may fail in headless CI environments
}
