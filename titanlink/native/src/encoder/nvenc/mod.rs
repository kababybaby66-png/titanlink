//! NVENC Hardware Encoder
//!
//! This module wraps NVIDIA's NVENC API for ultra-low latency H264 encoding.
//! Uses direct FFI calls to nvEncodeAPI64.dll for maximum performance.

use anyhow::{anyhow, Result};
use std::ffi::c_void;
use std::ptr;
use std::sync::Once;

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HMODULE;
#[cfg(target_os = "windows")]
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
#[cfg(target_os = "windows")]
use windows::core::{PCSTR, PCWSTR};

mod nvenc_ffi;
use nvenc_ffi::*;

// Global API function list
static INIT: Once = Once::new();
static mut API: Option<NV_ENCODE_API_FUNCTION_LIST> = None;
static mut LIB_HANDLE: Option<HMODULE> = None;

/// Check if NVENC is available on this system
pub fn is_available() -> bool {
    #[cfg(target_os = "windows")]
    {
        init_api().is_ok()
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Initialize the NVENC API
#[cfg(target_os = "windows")]
fn init_api() -> Result<&'static NV_ENCODE_API_FUNCTION_LIST> {
    unsafe {
        INIT.call_once(|| {
            // Load nvEncodeAPI64.dll
            let dll_name: Vec<u16> = "nvEncodeAPI64.dll\0".encode_utf16().collect();
            if let Ok(handle) = LoadLibraryW(PCWSTR(dll_name.as_ptr())) {
                LIB_HANDLE = Some(handle);

                // Get NvEncodeAPICreateInstance function
                let func_name = b"NvEncodeAPICreateInstance\0";
                if let Some(proc) = GetProcAddress(handle, PCSTR(func_name.as_ptr())) {
                    let create_instance: NvEncodeAPICreateInstanceFn = std::mem::transmute(proc);

                    // Create function list
                    let mut api = NV_ENCODE_API_FUNCTION_LIST::default();
                    let status = create_instance(&mut api);

                    if status == NV_ENC_SUCCESS {
                        API = Some(api);
                    }
                }
            }
        });

        API.as_ref().ok_or_else(|| anyhow!("Failed to initialize NVENC API"))
    }
}

#[cfg(not(target_os = "windows"))]
fn init_api() -> Result<&'static NV_ENCODE_API_FUNCTION_LIST> {
    Err(anyhow!("NVENC is only available on Windows"))
}

/// NVENC encoder configuration
#[derive(Clone, Debug)]
pub struct NvencConfig {
    /// Target bitrate in bits per second
    pub bitrate: u32,
    /// Maximum bitrate for VBR
    pub max_bitrate: u32,
    /// Target framerate
    pub framerate: u32,
    /// GOP (Group of Pictures) length in frames
    pub gop_length: u32,
    /// Use B-frames (should be 0 for low latency)
    pub b_frames: u32,
    /// Preset (lower = faster, higher = quality)
    pub preset: NvencPreset,
    /// H264 profile
    pub profile: H264Profile,
    /// Rate control mode
    pub rate_control: RateControl,
}

impl Default for NvencConfig {
    fn default() -> Self {
        Self {
            bitrate: 10_000_000,      // 10 Mbps
            max_bitrate: 20_000_000,  // 20 Mbps max
            framerate: 60,
            gop_length: 120,          // Keyframe every 2 seconds at 60fps
            b_frames: 0,              // No B-frames for low latency
            preset: NvencPreset::LowLatencyHighPerformance,
            profile: H264Profile::Baseline,
            rate_control: RateControl::CbrLowDelay,
        }
    }
}

/// NVENC encoding preset
#[derive(Clone, Copy, Debug)]
pub enum NvencPreset {
    LowLatencyHighPerformance,
    LowLatencyHighQuality,
    HighPerformance,
    HighQuality,
}

impl NvencPreset {
    fn to_guid(&self) -> GUID {
        match self {
            NvencPreset::LowLatencyHighPerformance => NV_ENC_PRESET_LOW_LATENCY_HP_GUID,
            NvencPreset::LowLatencyHighQuality => NV_ENC_PRESET_LOW_LATENCY_HQ_GUID,
            NvencPreset::HighPerformance => NV_ENC_PRESET_P1_GUID,
            NvencPreset::HighQuality => NV_ENC_PRESET_P4_GUID,
        }
    }
}

/// H264 profile
#[derive(Clone, Copy, Debug)]
pub enum H264Profile {
    Baseline,
    Main,
    High,
}

impl H264Profile {
    fn to_guid(&self) -> GUID {
        match self {
            H264Profile::Baseline => NV_ENC_H264_PROFILE_BASELINE_GUID,
            H264Profile::Main => NV_ENC_H264_PROFILE_MAIN_GUID,
            H264Profile::High => NV_ENC_H264_PROFILE_HIGH_GUID,
        }
    }
}

/// Rate control mode
#[derive(Clone, Copy, Debug)]
pub enum RateControl {
    CbrLowDelay,
    Vbr,
    ConstQp,
}

impl RateControl {
    fn to_mode(&self) -> NV_ENC_PARAMS_RC_MODE {
        match self {
            RateControl::CbrLowDelay => NV_ENC_PARAMS_RC_MODE::NV_ENC_PARAMS_RC_CBR_LOWDELAY_HQ,
            RateControl::Vbr => NV_ENC_PARAMS_RC_MODE::NV_ENC_PARAMS_RC_VBR_HQ,
            RateControl::ConstQp => NV_ENC_PARAMS_RC_MODE::NV_ENC_PARAMS_RC_CONSTQP,
        }
    }
}

/// Encoded frame output
pub struct EncodedPacket {
    /// Frame number
    pub frame_number: u32,
    /// Timestamp in microseconds
    pub timestamp_us: i64,
    /// Is this a keyframe (IDR)?
    pub is_keyframe: bool,
    /// Encoded H264 data (Annex B format with start codes)
    pub data: Vec<u8>,
    /// Encoding time in microseconds
    pub encode_time_us: u64,
}

/// NVENC encoder
pub struct NvencEncoder {
    encoder: *mut c_void,
    input_buffer: NV_ENC_INPUT_PTR,
    output_buffer: NV_ENC_OUTPUT_PTR,
    config: NvencConfig,
    frame_number: u32,
    width: u32,
    height: u32,
    initialized: bool,
}

// NVENC encoder can be sent between threads
unsafe impl Send for NvencEncoder {}

impl NvencEncoder {
    /// Create a new NVENC encoder
    pub fn new(width: u32, height: u32, config: NvencConfig) -> Result<Self> {
        let api = init_api()?;

        // Create a D3D11 device for NVENC
        let device = create_d3d11_device()?;

        // Open encode session
        let mut encoder: *mut c_void = ptr::null_mut();
        let mut session_params = NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS::default();
        session_params.device = device;
        session_params.deviceType = NV_ENC_DEVICE_TYPE::NV_ENC_DEVICE_TYPE_DIRECTX;

        let open_fn = api.nvEncOpenEncodeSessionEx
            .ok_or_else(|| anyhow!("nvEncOpenEncodeSessionEx not available"))?;

        let status = unsafe { open_fn(&mut session_params, &mut encoder) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to open NVENC session: {}", status));
        }

        // Initialize encoder
        let mut enc_config = NV_ENC_CONFIG::default();
        enc_config.profileGUID = config.profile.to_guid();
        enc_config.gopLength = config.gop_length;
        enc_config.frameIntervalP = 1; // No B-frames
        enc_config.rcParams.rateControlMode = config.rate_control.to_mode();
        enc_config.rcParams.averageBitRate = config.bitrate;
        enc_config.rcParams.maxBitRate = config.max_bitrate;
        enc_config.rcParams.lowDelayKeyFrameScale = 1;

        // Configure H.264 specific settings for low latency
        unsafe {
            enc_config.encodeCodecConfig.h264Config.idrPeriod = config.gop_length;
            enc_config.encodeCodecConfig.h264Config.repeatSPSPPS = 1;
            enc_config.encodeCodecConfig.h264Config.maxNumRefFrames = 1;
            enc_config.encodeCodecConfig.h264Config.sliceMode = 0;
            enc_config.encodeCodecConfig.h264Config.sliceModeData = 0;
        }

        let mut init_params = NV_ENC_INITIALIZE_PARAMS::default();
        init_params.encodeGUID = NV_ENC_CODEC_H264_GUID;
        init_params.presetGUID = config.preset.to_guid();
        init_params.encodeWidth = width;
        init_params.encodeHeight = height;
        init_params.darWidth = width;
        init_params.darHeight = height;
        init_params.frameRateNum = config.framerate;
        init_params.frameRateDen = 1;
        init_params.enablePTD = 1;
        init_params.encodeConfig = &mut enc_config;
        init_params.tuningInfo = NV_ENC_TUNING_INFO::NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY;

        let init_fn = api.nvEncInitializeEncoder
            .ok_or_else(|| anyhow!("nvEncInitializeEncoder not available"))?;

        let status = unsafe { init_fn(encoder, &mut init_params) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to initialize NVENC encoder: {}", status));
        }

        // Create input buffer (ARGB format - we'll convert BGRA on CPU or use ABGR)
        let mut input_buffer_params = NV_ENC_CREATE_INPUT_BUFFER::default();
        input_buffer_params.width = width;
        input_buffer_params.height = height;
        input_buffer_params.bufferFmt = NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_ABGR;

        let create_input_fn = api.nvEncCreateInputBuffer
            .ok_or_else(|| anyhow!("nvEncCreateInputBuffer not available"))?;

        let status = unsafe { create_input_fn(encoder, &mut input_buffer_params) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to create NVENC input buffer: {}", status));
        }

        // Create output bitstream buffer
        let mut output_buffer_params = NV_ENC_CREATE_BITSTREAM_BUFFER::default();

        let create_output_fn = api.nvEncCreateBitstreamBuffer
            .ok_or_else(|| anyhow!("nvEncCreateBitstreamBuffer not available"))?;

        let status = unsafe { create_output_fn(encoder, &mut output_buffer_params) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to create NVENC output buffer: {}", status));
        }

        Ok(Self {
            encoder,
            input_buffer: input_buffer_params.inputBuffer,
            output_buffer: output_buffer_params.bitstreamBuffer,
            config,
            frame_number: 0,
            width,
            height,
            initialized: true,
        })
    }

    /// Encode a frame from BGRA pixel data
    pub fn encode_bgra(&mut self, data: &[u8], force_keyframe: bool) -> Result<EncodedPacket> {
        if !self.initialized {
            return Err(anyhow!("Encoder not initialized"));
        }

        let start = std::time::Instant::now();
        let api = init_api()?;

        // Lock input buffer
        let mut lock_params = NV_ENC_LOCK_INPUT_BUFFER::default();
        lock_params.inputBuffer = self.input_buffer;

        let lock_fn = api.nvEncLockInputBuffer
            .ok_or_else(|| anyhow!("nvEncLockInputBuffer not available"))?;

        let status = unsafe { lock_fn(self.encoder, &mut lock_params) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to lock input buffer: {}", status));
        }

        // Copy BGRA data to ABGR buffer (swap R and B)
        // NVENC expects ABGR, we have BGRA
        unsafe {
            let dst = lock_params.bufferDataPtr as *mut u8;
            let pitch = lock_params.pitch as usize;
            let src_pitch = (self.width * 4) as usize;

            for y in 0..self.height as usize {
                let src_row = &data[y * src_pitch..];
                let dst_row = dst.add(y * pitch);

                for x in 0..self.width as usize {
                    let src_idx = x * 4;
                    let dst_idx = x * 4;
                    
                    // BGRA -> ABGR: swap positions
                    *dst_row.add(dst_idx + 0) = src_row[src_idx + 3]; // A
                    *dst_row.add(dst_idx + 1) = src_row[src_idx + 2]; // R (was at +2 in BGR)
                    *dst_row.add(dst_idx + 2) = src_row[src_idx + 1]; // G
                    *dst_row.add(dst_idx + 3) = src_row[src_idx + 0]; // B
                }
            }
        }

        // Unlock input buffer
        let unlock_fn = api.nvEncUnlockInputBuffer
            .ok_or_else(|| anyhow!("nvEncUnlockInputBuffer not available"))?;

        let status = unsafe { unlock_fn(self.encoder, self.input_buffer) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to unlock input buffer: {}", status));
        }

        // Encode the frame
        let is_keyframe = force_keyframe || (self.frame_number % self.config.gop_length == 0);

        let mut pic_params = NV_ENC_PIC_PARAMS::default();
        pic_params.inputWidth = self.width;
        pic_params.inputHeight = self.height;
        pic_params.inputPitch = self.width * 4;
        pic_params.inputBuffer = self.input_buffer;
        pic_params.outputBitstream = self.output_buffer;
        pic_params.bufferFmt = NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_ABGR;
        pic_params.frameIdx = self.frame_number;
        pic_params.inputTimeStamp = self.frame_number as u64;

        if is_keyframe {
            pic_params.encodePicFlags = NV_ENC_PIC_FLAGS::NV_ENC_PIC_FLAG_FORCEIDR as u32
                | NV_ENC_PIC_FLAGS::NV_ENC_PIC_FLAG_OUTPUT_SPSPPS as u32;
        }

        let encode_fn = api.nvEncEncodePicture
            .ok_or_else(|| anyhow!("nvEncEncodePicture not available"))?;

        let status = unsafe { encode_fn(self.encoder, &mut pic_params) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to encode frame: {}", status));
        }

        // Lock bitstream to get output
        let mut lock_bitstream = NV_ENC_LOCK_BITSTREAM::default();
        lock_bitstream.outputBitstreamBuffer = self.output_buffer;

        let lock_bitstream_fn = api.nvEncLockBitstream
            .ok_or_else(|| anyhow!("nvEncLockBitstream not available"))?;

        let status = unsafe { lock_bitstream_fn(self.encoder, &mut lock_bitstream) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to lock bitstream: {}", status));
        }

        // Copy encoded data
        let encoded_data = unsafe {
            std::slice::from_raw_parts(
                lock_bitstream.bitstreamBufferPtr as *const u8,
                lock_bitstream.bitstreamSizeInBytes as usize,
            )
            .to_vec()
        };

        let actual_keyframe = matches!(
            lock_bitstream.pictureType,
            NV_ENC_PIC_TYPE::NV_ENC_PIC_TYPE_IDR | NV_ENC_PIC_TYPE::NV_ENC_PIC_TYPE_I
        );

        // Unlock bitstream
        let unlock_bitstream_fn = api.nvEncUnlockBitstream
            .ok_or_else(|| anyhow!("nvEncUnlockBitstream not available"))?;

        let status = unsafe { unlock_bitstream_fn(self.encoder, self.output_buffer) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to unlock bitstream: {}", status));
        }

        let encode_time_us = start.elapsed().as_micros() as u64;
        let frame_number = self.frame_number;
        self.frame_number += 1;

        Ok(EncodedPacket {
            frame_number,
            timestamp_us: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_micros() as i64,
            is_keyframe: actual_keyframe,
            data: encoded_data,
            encode_time_us,
        })
    }

    /// Force an IDR frame
    pub fn force_keyframe(&mut self) -> Result<EncodedPacket> {
        let dummy_data = vec![0u8; (self.width * self.height * 4) as usize];
        self.encode_bgra(&dummy_data, true)
    }

    /// Get encoder statistics
    pub fn stats(&self) -> EncoderStats {
        EncoderStats {
            frames_encoded: self.frame_number,
            average_bitrate: self.config.bitrate,
            average_encode_time_ms: 0.0, // TODO: Track actual average
        }
    }
}

impl Drop for NvencEncoder {
    fn drop(&mut self) {
        if !self.initialized {
            return;
        }

        if let Ok(api) = init_api() {
            unsafe {
                // Destroy input buffer
                if let Some(destroy_input) = api.nvEncDestroyInputBuffer {
                    destroy_input(self.encoder, self.input_buffer);
                }

                // Destroy output buffer
                if let Some(destroy_output) = api.nvEncDestroyBitstreamBuffer {
                    destroy_output(self.encoder, self.output_buffer);
                }

                // Destroy encoder
                if let Some(destroy_encoder) = api.nvEncDestroyEncoder {
                    destroy_encoder(self.encoder);
                }
            }
        }
    }
}

/// Encoder statistics
pub struct EncoderStats {
    pub frames_encoded: u32,
    pub average_bitrate: u32,
    pub average_encode_time_ms: f64,
}

/// Create a D3D11 device for NVENC
#[cfg(target_os = "windows")]
fn create_d3d11_device() -> Result<*mut c_void> {
    use windows::Win32::Graphics::Direct3D::*;
    use windows::Win32::Graphics::Direct3D11::*;
    use windows::Win32::Graphics::Dxgi::*;

    unsafe {
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;

        let feature_levels = [D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_10_0];

        let result = D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            None,
            D3D11_CREATE_DEVICE_FLAG(0),
            Some(&feature_levels),
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        );

        if result.is_err() {
            return Err(anyhow!("Failed to create D3D11 device"));
        }

        let device = device.ok_or_else(|| anyhow!("D3D11 device is null"))?;
        
        // Get the raw pointer
        Ok(std::mem::transmute(device))
    }
}

#[cfg(not(target_os = "windows"))]
fn create_d3d11_device() -> Result<*mut c_void> {
    Err(anyhow!("D3D11 is only available on Windows"))
}
