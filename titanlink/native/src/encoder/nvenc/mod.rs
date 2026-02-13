//! NVENC Hardware Encoder - Working Implementation
//!
//! This module provides NVENC hardware encoding for H.264/H.265/AV1.
//! Uses NVIDIA's NVENC API with zero-copy D3D11 texture encoding.

mod nvenc_ffi;
use nvenc_ffi::*;

use anyhow::{anyhow, Result};
use std::ffi::c_void;
use std::ptr;
use std::sync::Once;

use windows::core::{Interface, PCSTR};
use windows::Win32::{
    Foundation::HMODULE,
    Graphics::{
        Direct3D::D3D_DRIVER_TYPE_UNKNOWN,
        Direct3D11::{
            D3D11CreateDevice, ID3D11Device, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
        },
        Dxgi::{CreateDXGIFactory1, IDXGIAdapter, IDXGIAdapter1, IDXGIFactory1, DXGI_ADAPTER_DESC},
    },
    System::LibraryLoader::{GetProcAddress, LoadLibraryW},
};

static INIT: Once = Once::new();
static mut API: Option<&'static NV_ENCODE_API_FUNCTION_LIST> = None;
static mut LIB_HANDLE: Option<HMODULE> = None;

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

fn hmodule_as_ptr(handle: windows::Win32::Foundation::HMODULE) -> *mut c_void {
    handle.0 as *mut c_void
}

fn load_nvenc_library() -> Option<windows::Win32::Foundation::HMODULE> {
    let dll_names = ["nvEncodeAPI64.dll", "nvEncodeAPI.dll"];

    for dll_name in &dll_names {
        let dll_name_wide: Vec<u16> = format!("{}\0", dll_name).encode_utf16().collect();
        let h = unsafe { LoadLibraryW(windows::core::PCWSTR(dll_name_wide.as_ptr())) };
        if let Ok(module) = h {
            if !module.0.is_null() {
                return Some(module);
            }
        }
    }
    None
}

fn get_nvenc_create_instance_proc(
    handle: windows::Win32::Foundation::HMODULE,
) -> Option<NvEncodeAPICreateInstanceFn> {
    let func_name = b"NvEncodeAPICreateInstance\0";
    let maybe_proc = unsafe { GetProcAddress(handle, PCSTR(func_name.as_ptr())) };
    if let Some(proc) = maybe_proc {
        Some(unsafe { std::mem::transmute(proc) })
    } else {
        None
    }
}

fn create_nvenc_api_instance(
    handle: windows::Win32::Foundation::HMODULE,
) -> Result<NV_ENCODE_API_FUNCTION_LIST> {
    let create_instance = get_nvenc_create_instance_proc(handle)
        .ok_or_else(|| anyhow!("NvEncodeAPICreateInstance not found in DLL"))?;

    eprintln!(
        "[NVENC] NVENCAPI_VERSION = {} (0x{:X})",
        NVENCAPI_VERSION(),
        NVENCAPI_VERSION()
    );

    // Use default implementation which correctly calculates version using NVENCAPI_STRUCT_VERSION macro
    let mut api = NV_ENCODE_API_FUNCTION_LIST::default();

    eprintln!("[NVENC] Calling NvEncodeAPICreateInstance with functionList version: 0x{:X}", api.version);
    let status = unsafe { create_instance(&mut api) };

    if status == NV_ENC_SUCCESS {
        eprintln!(
            "[NVENC] SUCCESS! NVENC API initialized. Driver version: {} (0x{:X})",
            api.version, api.version
        );
        Ok(api)
    } else {
        return Err(anyhow!(
            "NvEncodeAPICreateInstance failed with status: {}. Check: (1) NVENC supported by GPU, (2) Latest NVIDIA drivers, (3) Not in virtualized env.",
            status
        ));
    }
}

fn init_api_internal() -> Result<()> {
    let handle = load_nvenc_library().ok_or_else(|| {
        anyhow!("Failed to load nvEncodeAPI64.dll. Please install NVIDIA Game Ready Driver.")
    })?;

    let api = create_nvenc_api_instance(handle)?;

    let leaked_api: &'static NV_ENCODE_API_FUNCTION_LIST = Box::leak(Box::new(api));

    unsafe {
        LIB_HANDLE = Some(handle);
        API = Some(leaked_api);
    }

    eprintln!("[NVENC] Loaded nvEncodeAPI64.dll successfully");
    eprintln!(
        "[NVENC] API version: {}.{}",
        leaked_api.version >> 8,
        leaked_api.version & 0xFF
    );

    if leaked_api.nvEncOpenEncodeSessionEx.is_some() {
        eprintln!("[NVENC] nvEncOpenEncodeSessionEx: available");
    }
    if leaked_api.nvEncInitializeEncoder.is_some() {
        eprintln!("[NVENC] nvEncInitializeEncoder: available");
    }

    Ok(())
}

fn init_api() -> Result<&'static NV_ENCODE_API_FUNCTION_LIST> {
    INIT.call_once(|| {
        if let Err(e) = init_api_internal() {
            eprintln!("[NVENC] Initialization failed: {:#}", e);
        }
    });

    unsafe { API.ok_or_else(|| anyhow!("NVENC not available")) }
}

fn create_d3d11_device_for_nvenc() -> Result<*mut c_void> {
    eprintln!("[NVENC] create_d3d11_device_for_nvenc() called");
    unsafe {
        let factory: IDXGIFactory1 =
            CreateDXGIFactory1().map_err(|e| anyhow!("Failed to create DXGI Factory: {:?}", e))?;
        eprintln!("[NVENC] DXGI factory created");

        let nvidia_vendor_id: u32 = 0x10DE;
        let mut adapter: Option<IDXGIAdapter1> = None;

        for i in 0.. {
            match factory.EnumAdapters1(i) {
                Ok(a) => {
                    let desc = a.GetDesc();
                    if let Ok(d) = desc {
                        let gpu_name = String::from_utf16_lossy(
                            &d.Description
                                [..d.Description.iter().position(|&c| c == 0).unwrap_or(32)],
                        );
                        eprintln!(
                            "[NVENC] Enumerated GPU: {}, VendorId: 0x{:X}",
                            gpu_name, d.VendorId
                        );
                        if d.VendorId == nvidia_vendor_id {
                            adapter = Some(a);
                            eprintln!("[NVENC] Found NVIDIA GPU: {}", gpu_name);
                            break;
                        }
                    }
                }
                Err(_) => break,
            }
        }

        let adapter = adapter.ok_or_else(|| anyhow!("No NVIDIA GPU found for NVENC."))?;

        let mut device: Option<ID3D11Device> = None;
        let mut _context = None;

        let adapter_cast = adapter
            .cast::<IDXGIAdapter>()
            .map_err(|e| anyhow!("Failed to cast adapter: {:?}", e))?;
        eprintln!("[NVENC] Adapter cast successful, creating D3D11 device");

        D3D11CreateDevice(
            Some(&adapter_cast),
            D3D_DRIVER_TYPE_UNKNOWN,
            None,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut _context),
        )
        .map_err(|e| anyhow!("Failed to create D3D11 device: {:?}", e))?;

        let device = device.ok_or_else(|| anyhow!("D3D11 device is null"))?;

        eprintln!("[NVENC] D3D11 device created successfully");
        Ok(std::mem::transmute(device))
    }
}

#[derive(Debug)]
pub struct NvencUnavailableReason {
    pub reason: NvencUnavailableReasonType,
    pub details: String,
}

#[derive(Debug)]
pub enum NvencUnavailableReasonType {
    NoNvidiaGpu,
    DriverTooOld,
    DriverMissingDll,
    ApiVersionMismatch,
    D3d11CreationFailed,
    EncodeSessionFailed,
    VirtualizedEnvironment,
    Unknown,
}

pub fn check_availability() -> Result<(), NvencUnavailableReason> {
    let dll_name = "nvEncodeAPI64.dll\0";
    let dll_name_wide: Vec<u16> = dll_name.encode_utf16().collect();
    let h = unsafe { LoadLibraryW(windows::core::PCWSTR(dll_name_wide.as_ptr())) };

    let h = match h {
        Ok(module) if !module.0.is_null() => module,
        _ => {
            // Fallback: Try explicit path in System32
            // Issue: In some Electron dev environments, PATH might be stripped or shadowed
            let abs_path = "C:\\Windows\\System32\\nvEncodeAPI64.dll\0";
            let abs_path_wide: Vec<u16> = abs_path.encode_utf16().collect();
            let h_abs = unsafe { LoadLibraryW(windows::core::PCWSTR(abs_path_wide.as_ptr())) };
            
            match h_abs {
                Ok(module) if !module.0.is_null() => {
                    eprintln!("[NVENC] Loaded DLL from explicit path: C:\\Windows\\System32\\nvEncodeAPI64.dll");
                    module
                },
                _ => {
                    return Err(NvencUnavailableReason {
                        reason: NvencUnavailableReasonType::DriverMissingDll,
                        details: format!("nvEncodeAPI64.dll not found (checked PATH and System32). Error: {:?}", h.err()),
                    });
                }
            }
        }
    };

    let func_name = b"NvEncodeAPICreateInstance\0";
    let maybe_proc = unsafe { GetProcAddress(h, PCSTR(func_name.as_ptr())) };

    // Note: We don't call FreeLibrary here as it's not available in the current windows crate version.
    // The library will be freed when the process exits.

    if maybe_proc.is_none() {
        return Err(NvencUnavailableReason {
            reason: NvencUnavailableReasonType::DriverTooOld,
            details: "NvEncodeAPICreateInstance not found. Driver may be too old.".to_string(),
        });
    }

    match create_d3d11_device_for_nvenc() {
        Ok(_dev) => Ok(()),
        Err(e) => Err(NvencUnavailableReason {
            reason: NvencUnavailableReasonType::D3d11CreationFailed,
            details: format!(
                "Failed to create D3D11 device: {}. Ensure GPU driver is properly installed.",
                e
            ),
        }),
    }
}

pub fn get_nvenc_status_message() -> String {
    match check_availability() {
        Ok(_) => "NVENC is available and ready to use.".to_string(),
        Err(reason) => format!(
            "NVENC unavailable: {:?} - {}",
            reason.reason, reason.details
        ),
    }
}

pub struct NvencConfig {
    pub bitrate: u32,
    pub max_bitrate: u32,
    pub framerate: u32,
    pub gop_length: u32,
    pub b_frames: u32,
    pub preset: NvencPreset,
    pub codec: VideoCodec,
    pub profile: H264Profile,
    pub rate_control: RateControl,
}

impl Clone for NvencConfig {
    fn clone(&self) -> Self {
        Self {
            bitrate: self.bitrate,
            max_bitrate: self.max_bitrate,
            framerate: self.framerate,
            gop_length: self.gop_length,
            b_frames: self.b_frames,
            preset: self.preset,
            codec: self.codec,
            profile: self.profile,
            rate_control: self.rate_control,
        }
    }
}

impl Default for NvencConfig {
    fn default() -> Self {
        Self {
            bitrate: 10_000_000,
            max_bitrate: 20_000_000,
            framerate: 60,
            gop_length: 120,
            b_frames: 0,
            preset: NvencPreset::LowLatencyHighPerformance,
            codec: VideoCodec::H264,
            profile: H264Profile::Baseline,
            rate_control: RateControl::CbrLowDelay,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum VideoCodec {
    H264,
    HEVC,
    AV1,
}

impl VideoCodec {
    fn to_guid(&self) -> GUID {
        match self {
            VideoCodec::H264 => NV_ENC_CODEC_H264_GUID,
            VideoCodec::HEVC => NV_ENC_CODEC_HEVC_GUID,
            VideoCodec::AV1 => NV_ENC_CODEC_AV1_GUID,
        }
    }
}

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

pub struct EncodedPacket {
    pub frame_number: u32,
    pub timestamp_us: i64,
    pub is_keyframe: bool,
    pub data: Vec<u8>,
    pub encode_time_us: u64,
}

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

unsafe impl Send for NvencEncoder {}

impl NvencEncoder {
    pub fn new(width: u32, height: u32, config: NvencConfig) -> Result<Self> {
        let api = init_api()?;

        let open_fn = api
            .nvEncOpenEncodeSessionEx
            .ok_or_else(|| anyhow!("nvEncOpenEncodeSessionEx not available"))?;

        let device = create_d3d11_device_for_nvenc()?;

        // Use the current SDK version first
        let api_versions = vec![
            ((13 << 24) | 0, 13, 0), // 13.0 in newer format
            ((12 << 24) | 1, 12, 1), // 12.1 in newer format
            ((12 << 24) | 0, 12, 0), // 12.0 in newer format
            (3073, 12, 1),           // 12.1 in old format
            (2816, 11, 0),           // 11.0 in old format
            (2048, 8, 0),            // 8.0 in old format
        ];

        let mut last_error = None;

        for (api_ver, major, minor) in api_versions {
            let mut encoder: *mut c_void = ptr::null_mut();
            let mut session_params = NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS::default();
            // version is set by Default::default() using correct macro
            session_params.device = device;
            session_params.apiVersion = api_ver;

            eprintln!(
                "[NVENC] Trying API version {}.{} (struct ver: 0x{:X}, api ver: 0x{:X})",
                major, minor, session_params.version, session_params.apiVersion
            );
            eprintln!(
                "[NVENC DEBUG] Struct Size: {}, Expected: 1552",
                std::mem::size_of::<NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS>()
            );
            // Verify offsets manually via pointer arithmetic (unsafe but informative)
            let _dummy = NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS::default();
            eprintln!(
                "[NVENC DEBUG] Offsets: version={}, deviceType={}, device={}, reserved={}, apiVersion={}, reserved1={}, reserved2={}",
                (&_dummy.version as *const _ as usize) - (&_dummy as *const _ as usize),
                (&_dummy.deviceType as *const _ as usize) - (&_dummy as *const _ as usize),
                (&_dummy.device as *const _ as usize) - (&_dummy as *const _ as usize),
                (&_dummy.reserved as *const _ as usize) - (&_dummy as *const _ as usize),
                (&_dummy.apiVersion as *const _ as usize) - (&_dummy as *const _ as usize),
                (&_dummy.reserved1 as *const _ as usize) - (&_dummy as *const _ as usize),
                (&_dummy.reserved2 as *const _ as usize) - (&_dummy as *const _ as usize),
            );

            let status = unsafe { open_fn(&mut session_params, &mut encoder) };

            if status == NV_ENC_SUCCESS {
                eprintln!(
                    "[NVENC] Successfully opened session with API version {}.{}",
                    major, minor
                );
                return Self::init_encoder_session(api, encoder, width, height, &config);
            }

            eprintln!(
                "[NVENC] API version {}.{} failed with status: {} ({})",
                major,
                minor,
                status,
                match status {
                    NV_ENC_ERR_INVALID_VERSION => "INVALID_VERSION",
                    NV_ENC_ERR_INVALID_ENCODERDEVICE => "INVALID_ENCODERDEVICE",
                    NV_ENC_ERR_UNSUPPORTED_DEVICE => "UNSUPPORTED_DEVICE",
                    _ => "Unknown",
                }
            );
            last_error = Some(status);
        }

        return Err(anyhow!(
            "Failed to open NVENC session with all API versions. Last error: {}. \
            Check: (1) GPU supports NVENC, (2) Not running in virtualized environment without GPU-Pv, (3) Latest NVIDIA drivers installed.",
            last_error.map(|s| s as i32).unwrap_or(-1)
        ));
    }

    pub fn new_from_device(
        device: *mut c_void,
        width: u32,
        height: u32,
        config: NvencConfig,
    ) -> Result<Self> {
        eprintln!("[NVENC] new_from_device called, device ptr: {:p}", device);
        let api = init_api()?;

        eprintln!(
            "[NVENC] Driver NVENC API version reported during init: {}.{}",
            api.version >> 8,
            api.version & 0xFF
        );

        let mut encoder: *mut c_void = ptr::null_mut();

        let open_fn = api
            .nvEncOpenEncodeSessionEx
            .ok_or_else(|| anyhow!("nvEncOpenEncodeSessionEx not available"))?;

        let mut session_params: NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS = Default::default();
        session_params.device = device;
        session_params.deviceType = NV_ENC_DEVICE_TYPE::NV_ENC_DEVICE_TYPE_DIRECTX11;
        session_params.apiVersion = NVENCAPI_VERSION_FALLBACK();

        eprintln!(
            "[NVENC] Session params - apiVersion: {}, structVersion: 0x{:X}",
            session_params.apiVersion, session_params.version
        );

        let status = unsafe { open_fn(&mut session_params, &mut encoder) };
        eprintln!(
            "[NVENC] nvEncOpenEncodeSessionEx returned status: {} ({})",
            status,
            match status {
                _ if status == NV_ENC_SUCCESS => "Success",
                _ if status == NV_ENC_ERR_INVALID_VERSION =>
                    "INVALID_VERSION - Driver doesn't support requested API version",
                _ if status == NV_ENC_ERR_INVALID_ENCODERDEVICE =>
                    "INVALID_ENCODERDEVICE - D3D11 device not supported by NVENC",
                _ if status == NV_ENC_ERR_UNSUPPORTED_DEVICE =>
                    "UNSUPPORTED_DEVICE - GPU doesn't support NVENC",
                _ if status == NV_ENC_ERR_INVALID_DEVICE => "INVALID_DEVICE - No GPU device",
                _ if status == NV_ENC_ERR_DEVICE_NOT_EXIST => "DEVICE_NOT_EXIST",
                _ if status == NV_ENC_ERR_NO_ENCODE_DEVICE => "NO_ENCODE_DEVICE",
                _ => "Unknown error",
            }
        );

        if status != NV_ENC_SUCCESS {
            return Err(anyhow!(
                "Failed to open NVENC session. Status: {}. This could mean: (1) D3D11 device not compatible with NVENC, (2) Running in virtualized environment without GPU-Pv support, (3) GPU doesn't have encoding capability. Try: Update NVIDIA drivers, check if GPU supports NVENC, or use software encoding.",
                status
            ));
        }

        Self::init_encoder_session(api, encoder, width, height, &config)
    }

    fn init_encoder_session(
        api: &'static NV_ENCODE_API_FUNCTION_LIST,
        encoder: *mut c_void,
        width: u32,
        height: u32,
        config: &NvencConfig,
    ) -> Result<Self> {
        let get_preset_fn = api
            .nvEncGetEncodePresetConfigEx
            .ok_or_else(|| anyhow!("nvEncGetEncodePresetConfigEx not available"))?;

        let mut preset_config: NV_ENC_PRESET_CONFIG = unsafe { std::mem::zeroed() };
        preset_config.version = NVENCAPI_STRUCT_VERSION(4, 1);

        let status = unsafe {
            get_preset_fn(
                encoder,
                config.codec.to_guid(),
                config.preset.to_guid(),
                NV_ENC_TUNING_INFO::NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY,
                &mut preset_config as *mut _ as *mut c_void,
            )
        };

        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to get preset configuration: {}", status));
        }

        let mut enc_config = preset_config.presetCfg;
        enc_config.profileGUID = config.profile.to_guid();
        enc_config.gopLength = config.gop_length;
        enc_config.frameIntervalP = 1;
        enc_config.rcParams.rateControlMode = config.rate_control.to_mode();
        enc_config.rcParams.averageBitRate = config.bitrate;
        enc_config.rcParams.maxBitRate = config.max_bitrate;
        enc_config.rcParams.lowDelayKeyFrameScale = 1;

        unsafe {
            match config.codec {
                VideoCodec::H264 => {
                    enc_config.encodeCodecConfig.h264Config.idrPeriod = config.gop_length;
                    enc_config.encodeCodecConfig.h264Config.reservedBitFields |= 1 << 11;
                    enc_config.encodeCodecConfig.h264Config.maxNumRefFrames = 1;
                }
                VideoCodec::HEVC => {
                    enc_config.encodeCodecConfig.hevcConfig.idrPeriod = config.gop_length;
                }
                VideoCodec::AV1 => {
                    enc_config.encodeCodecConfig.av1Config.idrPeriod = config.gop_length;
                }
            }
        }

        let mut init_params: NV_ENC_INITIALIZE_PARAMS = unsafe { std::mem::zeroed() };
        init_params.version = NVENCAPI_STRUCT_VERSION(5, 1);
        init_params.encodeGUID = config.codec.to_guid();
        init_params.presetGUID = config.preset.to_guid();
        init_params.encodeWidth = width;
        init_params.encodeHeight = height;
        init_params.darWidth = width;
        init_params.darHeight = height;
        init_params.frameRateNum = config.framerate;
        init_params.frameRateDen = 1;
        init_params.reservedBitFields = 2;
        init_params.encodeConfig = &mut enc_config;
        init_params.tuningInfo = NV_ENC_TUNING_INFO::NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY;

        let init_fn = api
            .nvEncInitializeEncoder
            .ok_or_else(|| anyhow!("nvEncInitializeEncoder not available"))?;

        let status = unsafe { init_fn(encoder, &mut init_params) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to initialize NVENC encoder: {}", status));
        }

        let mut input_buffer_params = NV_ENC_CREATE_INPUT_BUFFER::default();
        input_buffer_params.width = width;
        input_buffer_params.height = height;
        input_buffer_params.bufferFmt = NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_ABGR;

        let create_input_fn = api
            .nvEncCreateInputBuffer
            .ok_or_else(|| anyhow!("nvEncCreateInputBuffer not available"))?;

        let status = unsafe { create_input_fn(encoder, &mut input_buffer_params) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to create NVENC input buffer: {}", status));
        }

        let mut output_buffer_params = NV_ENC_CREATE_BITSTREAM_BUFFER::default();

        let create_output_fn = api
            .nvEncCreateBitstreamBuffer
            .ok_or_else(|| anyhow!("nvEncCreateBitstreamBuffer not available"))?;

        let status = unsafe { create_output_fn(encoder, &mut output_buffer_params) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to create NVENC output buffer: {}", status));
        }

        Ok(Self {
            encoder,
            input_buffer: input_buffer_params.inputBuffer,
            output_buffer: output_buffer_params.bitstreamBuffer,
            config: config.clone(),
            frame_number: 0,
            width,
            height,
            initialized: true,
        })
    }

    pub fn encode_texture(
        &mut self,
        texture: *mut c_void,
        force_keyframe: bool,
    ) -> Result<EncodedPacket> {
        if !self.initialized {
            return Err(anyhow!("Encoder not initialized"));
        }

        let start = std::time::Instant::now();
        let api = init_api()?;

        let is_keyframe = force_keyframe || (self.frame_number % self.config.gop_length == 0);

        let mut reg_res = NV_ENC_REGISTER_RESOURCE::default();
        reg_res.resourceType = NV_ENC_INPUT_RESOURCE_TYPE::NV_ENC_INPUT_RESOURCE_TYPE_DIRECTX;
        reg_res.width = self.width;
        reg_res.height = self.height;
        reg_res.pitch = self.width * 4;
        reg_res.resourceToRegister = texture;
        reg_res.bufferFormat = NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_ARGB;

        let register_fn = api
            .nvEncRegisterResource
            .ok_or_else(|| anyhow!("nvEncRegisterResource not available"))?;

        let status = unsafe { register_fn(self.encoder, &mut reg_res as *mut _ as *mut c_void) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to register resource: {}", status));
        }

        let registered_resource = reg_res.registeredResource;

        let mut map_res = NV_ENC_MAP_INPUT_RESOURCE::default();
        map_res.registeredResource = registered_resource;

        let map_fn = api
            .nvEncMapInputResource
            .ok_or_else(|| anyhow!("nvEncMapInputResource not available"))?;

        let status = unsafe { map_fn(self.encoder, &mut map_res as *mut _ as *mut c_void) };
        if status != NV_ENC_SUCCESS {
            unsafe {
                (api.nvEncUnregisterResource.unwrap())(self.encoder, registered_resource);
            }
            return Err(anyhow!("Failed to map resource: {}", status));
        }

        let mut pic_params = NV_ENC_PIC_PARAMS::default();
        pic_params.inputWidth = self.width;
        pic_params.inputHeight = self.height;
        pic_params.inputPitch = self.width * 4;
        pic_params.inputBuffer = map_res.mappedResource;
        pic_params.outputBitstream = self.output_buffer;
        pic_params.bufferFmt = NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_ARGB;
        pic_params.frameIdx = self.frame_number;
        pic_params.inputTimeStamp = self.frame_number as u64;

        if is_keyframe {
            pic_params.encodePicFlags = (NV_ENC_PIC_FLAGS::NV_ENC_PIC_FLAG_FORCEIDR as u32)
                | (NV_ENC_PIC_FLAGS::NV_ENC_PIC_FLAG_OUTPUT_SPSPPS as u32);
        }

        let encode_fn = api
            .nvEncEncodePicture
            .ok_or_else(|| anyhow!("nvEncEncodePicture not available"))?;

        let status = unsafe { encode_fn(self.encoder, &mut pic_params) };

        let unmap_fn = api.nvEncUnmapInputResource.unwrap();
        unsafe { unmap_fn(self.encoder, map_res.mappedResource) };

        let unreg_fn = api.nvEncUnregisterResource.unwrap();
        unsafe { unreg_fn(self.encoder, registered_resource) };

        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to encode frame: {}", status));
        }

        self.retrieve_bitstream(start, is_keyframe)
    }

    fn retrieve_bitstream(
        &mut self,
        start_time: std::time::Instant,
        _request_keyframe: bool,
    ) -> Result<EncodedPacket> {
        let api = init_api()?;

        let mut lock_bitstream = NV_ENC_LOCK_BITSTREAM::default();
        lock_bitstream.outputBitstreamBuffer = self.output_buffer;

        let lock_bitstream_fn = api
            .nvEncLockBitstream
            .ok_or_else(|| anyhow!("nvEncLockBitstream not available"))?;

        let status = unsafe { lock_bitstream_fn(self.encoder, &mut lock_bitstream) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to lock bitstream: {}", status));
        }

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

        let unlock_bitstream_fn = api
            .nvEncUnlockBitstream
            .ok_or_else(|| anyhow!("nvEncUnlockBitstream not available"))?;

        let status = unsafe { unlock_bitstream_fn(self.encoder, self.output_buffer) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to unlock bitstream: {}", status));
        }

        let encode_time_us = start_time.elapsed().as_micros() as u64;
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

    pub fn encode_bgra(&mut self, data: &[u8], force_keyframe: bool) -> Result<EncodedPacket> {
        if !self.initialized {
            return Err(anyhow!("Encoder not initialized"));
        }

        let start = std::time::Instant::now();
        let api = init_api()?;

        let mut lock_params = NV_ENC_LOCK_INPUT_BUFFER::default();
        lock_params.inputBuffer = self.input_buffer;

        let lock_fn = api
            .nvEncLockInputBuffer
            .ok_or_else(|| anyhow!("nvEncLockInputBuffer not available"))?;

        let status = unsafe { lock_fn(self.encoder, &mut lock_params) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to lock input buffer: {}", status));
        }

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

                    *dst_row.add(dst_idx + 0) = src_row[src_idx + 3];
                    *dst_row.add(dst_idx + 1) = src_row[src_idx + 0];
                    *dst_row.add(dst_idx + 2) = src_row[src_idx + 1];
                    *dst_row.add(dst_idx + 3) = src_row[src_idx + 2];
                }
            }
        }

        let unlock_fn = api
            .nvEncUnlockInputBuffer
            .ok_or_else(|| anyhow!("nvEncUnlockInputBuffer not available"))?;

        let status = unsafe { unlock_fn(self.encoder, self.input_buffer) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to unlock input buffer: {}", status));
        }

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
            pic_params.encodePicFlags = (NV_ENC_PIC_FLAGS::NV_ENC_PIC_FLAG_FORCEIDR as u32)
                | (NV_ENC_PIC_FLAGS::NV_ENC_PIC_FLAG_OUTPUT_SPSPPS as u32);
        }

        let encode_fn = api
            .nvEncEncodePicture
            .ok_or_else(|| anyhow!("nvEncEncodePicture not available"))?;

        let status = unsafe { encode_fn(self.encoder, &mut pic_params) };
        if status != NV_ENC_SUCCESS {
            return Err(anyhow!("Failed to encode frame: {}", status));
        }

        self.retrieve_bitstream(start, is_keyframe)
    }

    pub fn force_keyframe(&mut self) -> Result<EncodedPacket> {
        let dummy_data = vec![0u8; (self.width * self.height * 4) as usize];
        self.encode_bgra(&dummy_data, true)
    }

    pub fn stats(&self) -> EncoderStats {
        EncoderStats {
            frames_encoded: self.frame_number,
            average_bitrate: self.config.bitrate,
            average_encode_time_ms: 0.0,
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
                if let Some(destroy_input) = api.nvEncDestroyInputBuffer {
                    destroy_input(self.encoder, self.input_buffer);
                }

                if let Some(destroy_output) = api.nvEncDestroyBitstreamBuffer {
                    destroy_output(self.encoder, self.output_buffer);
                }

                if let Some(destroy_encoder) = api.nvEncDestroyEncoder {
                    destroy_encoder(self.encoder);
                }
            }
        }
    }
}

pub struct EncoderStats {
    pub frames_encoded: u32,
    pub average_bitrate: u32,
    pub average_encode_time_ms: f64,
}
