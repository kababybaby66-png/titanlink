//! Capture pipeline - orchestrates capture and encoding
//!
//! This module runs the main capture loop in a background thread,
//! capturing frames from DXGI and encoding with NVENC.

use crate::capture::dxgi::DxgiCapturer;
use crate::encoder::nvenc::{NvencConfig, NvencEncoder};
use crate::encoder::software::SoftwareEncoder;
use crate::{CaptureSettings, EncodedFrame};
use anyhow::{Context, Result};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

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
    fn encode(&mut self, data: &[u8], force_keyframe: bool) -> Result<(Vec<u8>, bool)> {
        match self {
            Encoder::Nvenc(enc) => {
                let packet = enc.encode_bgra(data, force_keyframe)?;
                Ok((packet.data, packet.is_keyframe))
            }
            Encoder::Software(enc) => {
                let data = enc.encode(data)?;
                Ok((data, force_keyframe))
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

    // Calculate frame interval
    let frame_interval = Duration::from_secs_f64(1.0 / settings.fps as f64);
    
    // Initialize DXGI capturer
    let mut capturer = DxgiCapturer::new(settings.display_index)
        .context("Failed to initialize DXGI capturer")?;

    let (width, height) = capturer.dimensions();
    println!("[Pipeline] Initialized DXGI capture: {}x{} @ {}fps", width, height, settings.fps);

    // Initialize encoder
    let mut encoder = if settings.use_hardware_encoder && crate::encoder::nvenc::is_available() {
        println!("[Pipeline] Using NVENC hardware encoder");
        let config = NvencConfig {
            bitrate: settings.bitrate,
            framerate: settings.fps,
            ..Default::default()
        };
        match NvencEncoder::new(width, height, config) {
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
    let mut keyframe_interval = settings.fps; // Keyframe every 1 second

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

        match capturer.capture_frame_cpu(remaining) {
            Ok(Some(pixels)) => {
                let capture_time = capture_start.elapsed();
                
                // Encode the frame
                let encode_start = Instant::now();
                let force_keyframe = frame_number % keyframe_interval == 0;
                
                match encoder.encode(&pixels, force_keyframe) {
                    Ok((data, is_keyframe)) => {
                        let encode_time = encode_start.elapsed();
                        
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
                    }
                    Err(e) => {
                        eprintln!("[Pipeline] Encode error: {}", e);
                    }
                }

                last_frame_time = Instant::now();
            }
            Ok(None) => {
                // No new frame, that's okay - DXGI only updates when screen changes
            }
            Err(e) => {
                eprintln!("[Pipeline] Capture error: {}", e);
                
                // If access lost, try to recreate capturer
                if e.to_string().contains("Access lost") {
                    println!("[Pipeline] Attempting to recreate capturer...");
                    std::thread::sleep(Duration::from_millis(500));
                    
                    match DxgiCapturer::new(settings.display_index) {
                        Ok(new_capturer) => {
                            capturer = new_capturer;
                            println!("[Pipeline] Capturer recreated successfully");
                        }
                        Err(e) => {
                            eprintln!("[Pipeline] Failed to recreate capturer: {}", e);
                            break;
                        }
                    }
                }
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
