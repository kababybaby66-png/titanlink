//! WASAPI Loopback Audio Capture
//!
//! Captures desktop/system audio using WASAPI in loopback mode.
//! This provides zero-overhead audio capture directly from the audio endpoint
//! that the system is rendering to.
//!
//! Replaces the old WebRTC getUserMedia approach for audio capture.

use anyhow::{anyhow, Result};
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};

// WASAPI constants (not all exported by the windows crate as typed constants)
const AUDCLNT_STREAMFLAGS_LOOPBACK: u32 = 0x0002_0000;
const AUDCLNT_STREAMFLAGS_EVENTCALLBACK: u32 = 0x0004_0000;

static AUDIO_STOP: AtomicBool = AtomicBool::new(false);

/// Audio sample format for captured data
#[derive(Debug, Clone)]
pub struct AudioFormat {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
    pub block_align: u16,
}

/// A captured audio buffer
#[derive(Debug, Clone)]
pub struct AudioBuffer {
    pub data: Vec<u8>,
    pub format: AudioFormat,
    pub timestamp_us: i64,
    pub frame_count: u32,
}

/// Audio capture settings
#[derive(Debug, Clone)]
pub struct AudioCaptureSettings {
    pub sample_rate: u32,
    pub quality_mode: String,
}

impl Default for AudioCaptureSettings {
    fn default() -> Self {
        Self {
            sample_rate: 48000,
            quality_mode: "game".to_string(),
        }
    }
}

/// Check if WASAPI audio capture is available
pub fn is_available() -> bool {
    #[cfg(target_os = "windows")]
    {
        // WASAPI is available on all modern Windows systems
        true
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Stop the currently running audio capture
pub fn stop_capture() {
    AUDIO_STOP.store(true, Ordering::SeqCst);
}

/// Run the WASAPI loopback audio capture pipeline.
///
/// Captures system audio in loopback mode and calls the callback with audio buffers.
/// This function blocks until `stop_capture()` is called.
#[cfg(target_os = "windows")]
pub fn run_audio_capture<F>(settings: AudioCaptureSettings, callback: F) -> Result<()>
where
    F: Fn(AudioBuffer) + Send + 'static,
{
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;

    AUDIO_STOP.store(false, Ordering::SeqCst);

    unsafe {
        // Initialize COM for this thread
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        // Get the default audio render endpoint (speakers/headphones)
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| anyhow!("Failed to create device enumerator: {:?}", e))?;

        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| anyhow!("Failed to get default audio endpoint: {:?}", e))?;

        eprintln!("[AudioCapture] Got default render device");

        // Activate the audio client
        let audio_client: IAudioClient = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| anyhow!("Failed to activate audio client: {:?}", e))?;

        // Get the mix format (what the device is rendering)
        let mix_format_ptr = audio_client
            .GetMixFormat()
            .map_err(|e| anyhow!("Failed to get mix format: {:?}", e))?;

        let mix_format = &*mix_format_ptr;
        let format = AudioFormat {
            sample_rate: mix_format.nSamplesPerSec,
            channels: mix_format.nChannels,
            bits_per_sample: mix_format.wBitsPerSample,
            block_align: mix_format.nBlockAlign,
        };

        eprintln!(
            "[AudioCapture] Mix format: {}Hz, {} ch, {} bits, align={}",
            format.sample_rate, format.channels, format.bits_per_sample, format.block_align
        );

        // Initialize in loopback mode (captures what's playing on speakers)
        let buffer_duration: i64 = 100_000; // 10ms in 100ns units (REFERENCE_TIME)

        audio_client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                buffer_duration,
                0,
                mix_format_ptr,
                None,
            )
            .map_err(|e| anyhow!("Failed to initialize audio client: {:?}", e))?;

        // Create event for buffer notifications
        let event = windows::Win32::System::Threading::CreateEventW(None, false, false, None)
            .map_err(|e| anyhow!("Failed to create event: {:?}", e))?;

        audio_client
            .SetEventHandle(event)
            .map_err(|e| anyhow!("Failed to set event handle: {:?}", e))?;

        // Get the capture client
        let capture_client: IAudioCaptureClient = audio_client
            .GetService()
            .map_err(|e| anyhow!("Failed to get capture client: {:?}", e))?;

        // Start capturing
        audio_client
            .Start()
            .map_err(|e| anyhow!("Failed to start audio capture: {:?}", e))?;

        eprintln!(
            "[AudioCapture] WASAPI loopback capture started ({}Hz, {} mode)",
            settings.sample_rate, settings.quality_mode
        );

        // Capture loop
        loop {
            if AUDIO_STOP.load(Ordering::SeqCst) {
                break;
            }

            // Wait for audio data (10ms timeout)
            windows::Win32::System::Threading::WaitForSingleObject(event, 10);

            // Process all available packets
            loop {
                let packet_length = match capture_client.GetNextPacketSize() {
                    Ok(len) => len,
                    Err(_) => break,
                };

                if packet_length == 0 {
                    break;
                }

                let mut buffer_ptr: *mut u8 = ptr::null_mut();
                let mut num_frames: u32 = 0;
                let mut flags: u32 = 0;
                let mut device_position: u64 = 0;
                let mut qpc_position: u64 = 0;

                if capture_client
                    .GetBuffer(
                        &mut buffer_ptr,
                        &mut num_frames,
                        &mut flags,
                        Some(&mut device_position),
                        Some(&mut qpc_position),
                    )
                    .is_err()
                {
                    break;
                }

                if num_frames > 0 && !buffer_ptr.is_null() {
                    let data_size = (num_frames as usize) * (format.block_align as usize);

                    // Check for silence flag (AUDCLNT_BUFFERFLAGS_SILENT = 0x2)
                    let is_silent = (flags & 0x2) != 0;

                    let data = if is_silent {
                        vec![0u8; data_size]
                    } else {
                        std::slice::from_raw_parts(buffer_ptr, data_size).to_vec()
                    };

                    let timestamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_micros() as i64;

                    callback(AudioBuffer {
                        data,
                        format: format.clone(),
                        timestamp_us: timestamp,
                        frame_count: num_frames,
                    });
                }

                let _ = capture_client.ReleaseBuffer(num_frames);
            }
        }

        // Stop and cleanup
        let _ = audio_client.Stop();
        let _ = windows::Win32::Foundation::CloseHandle(event);
        CoUninitialize();

        eprintln!("[AudioCapture] WASAPI loopback capture stopped");
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn run_audio_capture<F>(_settings: AudioCaptureSettings, _callback: F) -> Result<()>
where
    F: Fn(AudioBuffer) + Send + 'static,
{
    Err(anyhow!("WASAPI audio capture is only available on Windows"))
}
