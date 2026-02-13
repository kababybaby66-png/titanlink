//! NVENC FFI Bindings
//!
//! This module contains the raw FFI definitions for NVIDIA's NVENC API.
//! Based on nvEncodeAPI.h from the NVIDIA Video Codec SDK.

#![allow(non_camel_case_types)]
#![allow(non_snake_case)]
#![allow(dead_code)]

use std::ffi::c_void;

// ============================================
// Basic Types
// ============================================

pub type NVENCSTATUS = i32;
pub type NV_ENC_INPUT_PTR = *mut c_void;
pub type NV_ENC_OUTPUT_PTR = *mut c_void;
pub type NV_ENC_REGISTERED_PTR = *mut c_void;

// ============================================
// Status Codes
// ============================================

pub const NV_ENC_SUCCESS: NVENCSTATUS = 0;
pub const NV_ENC_ERR_NO_ENCODE_DEVICE: NVENCSTATUS = 1;
pub const NV_ENC_ERR_UNSUPPORTED_DEVICE: NVENCSTATUS = 2;
pub const NV_ENC_ERR_INVALID_ENCODERDEVICE: NVENCSTATUS = 3;
pub const NV_ENC_ERR_INVALID_DEVICE: NVENCSTATUS = 4;
pub const NV_ENC_ERR_DEVICE_NOT_EXIST: NVENCSTATUS = 5;
pub const NV_ENC_ERR_INVALID_PTR: NVENCSTATUS = 6;
pub const NV_ENC_ERR_INVALID_EVENT: NVENCSTATUS = 7;
pub const NV_ENC_ERR_INVALID_PARAM: NVENCSTATUS = 8;
pub const NV_ENC_ERR_INVALID_CALL: NVENCSTATUS = 9;
pub const NV_ENC_ERR_OUT_OF_MEMORY: NVENCSTATUS = 10;
pub const NV_ENC_ERR_ENCODER_NOT_INITIALIZED: NVENCSTATUS = 11;
pub const NV_ENC_ERR_UNSUPPORTED_PARAM: NVENCSTATUS = 12;
pub const NV_ENC_ERR_LOCK_BUSY: NVENCSTATUS = 13;
pub const NV_ENC_ERR_NOT_ENOUGH_BUFFER: NVENCSTATUS = 14;
pub const NV_ENC_ERR_INVALID_VERSION: NVENCSTATUS = 15;
pub const NV_ENC_ERR_MAP_FAILED: NVENCSTATUS = 16;
pub const NV_ENC_ERR_NEED_MORE_INPUT: NVENCSTATUS = 17;
pub const NV_ENC_ERR_ENCODER_BUSY: NVENCSTATUS = 18;
pub const NV_ENC_ERR_EVENT_NOT_REGISTERD: NVENCSTATUS = 19;
pub const NV_ENC_ERR_GENERIC: NVENCSTATUS = 20;
pub const NV_ENC_ERR_INCOMPATIBLE_CLIENT_KEY: NVENCSTATUS = 21;
pub const NV_ENC_ERR_UNIMPLEMENTED: NVENCSTATUS = 22;
pub const NV_ENC_ERR_RESOURCE_REGISTER_FAILED: NVENCSTATUS = 23;
pub const NV_ENC_ERR_RESOURCE_NOT_REGISTERED: NVENCSTATUS = 24;
pub const NV_ENC_ERR_RESOURCE_NOT_MAPPED: NVENCSTATUS = 25;

// ============================================
// GUIDs
// ============================================

#[repr(C)]
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct GUID {
    pub Data1: u32,
    pub Data2: u16,
    pub Data3: u16,
    pub Data4: [u8; 8],
}

// Codec GUIDs
pub const NV_ENC_CODEC_H264_GUID: GUID = GUID {
    Data1: 0x6BC82762,
    Data2: 0x4E63,
    Data3: 0x4CA4,
    Data4: [0xAA, 0x85, 0x1E, 0x50, 0xF3, 0x21, 0xF6, 0xBF],
};

pub const NV_ENC_CODEC_HEVC_GUID: GUID = GUID {
    Data1: 0x790CDC88,
    Data2: 0x4522,
    Data3: 0x4D7B,
    Data4: [0x94, 0x25, 0xBD, 0xA9, 0x97, 0x5F, 0x76, 0x03],
};

pub const NV_ENC_CODEC_AV1_GUID: GUID = GUID {
    Data1: 0x078F5783,
    Data2: 0x059F,
    Data3: 0x4B30,
    Data4: [0xAD, 0x35, 0xAA, 0x79, 0xC4, 0x51, 0x65, 0x88],
};

// Preset GUIDs
pub const NV_ENC_PRESET_P1_GUID: GUID = GUID {
    Data1: 0xFC0A8D3E,
    Data2: 0x45F8,
    Data3: 0x4CF8,
    Data4: [0x80, 0xC7, 0x29, 0x88, 0x71, 0x59, 0x0E, 0xBF],
};

pub const NV_ENC_PRESET_P4_GUID: GUID = GUID {
    Data1: 0x8B85FB75,
    Data2: 0xB288,
    Data3: 0x4B8F,
    Data4: [0xB8, 0x70, 0xE9, 0x6B, 0x0F, 0xAD, 0x14, 0x79],
};

pub const NV_ENC_PRESET_LOW_LATENCY_HP_GUID: GUID = GUID {
    Data1: 0x67082A44,
    Data2: 0x4BAD,
    Data3: 0x48FA,
    Data4: [0x98, 0xEA, 0x93, 0x05, 0x6D, 0x15, 0x0A, 0x58],
};

pub const NV_ENC_PRESET_LOW_LATENCY_HQ_GUID: GUID = GUID {
    Data1: 0xC5F733B9,
    Data2: 0xEA97,
    Data3: 0x4CF9,
    Data4: [0xBE, 0xC2, 0xBF, 0x78, 0xA7, 0x42, 0x95, 0x01],
};

// Profile GUIDs
pub const NV_ENC_H264_PROFILE_BASELINE_GUID: GUID = GUID {
    Data1: 0x0727BCAA,
    Data2: 0x78C4,
    Data3: 0x4C83,
    Data4: [0x8C, 0x2F, 0xEF, 0x3D, 0xFF, 0x26, 0x7C, 0x6A],
};

pub const NV_ENC_H264_PROFILE_MAIN_GUID: GUID = GUID {
    Data1: 0x60B5C1D4,
    Data2: 0x67FE,
    Data3: 0x4790,
    Data4: [0x94, 0xD5, 0xC4, 0x72, 0x6D, 0x7B, 0x6E, 0x6D],
};

pub const NV_ENC_H264_PROFILE_HIGH_GUID: GUID = GUID {
    Data1: 0xE7CBC309,
    Data2: 0x4F7A,
    Data3: 0x4B89,
    Data4: [0xAF, 0x2A, 0xD5, 0x37, 0xC9, 0x2B, 0xE3, 0x10],
};

// ============================================
// Enums
// ============================================

#[repr(u32)]
#[derive(Copy, Clone, Debug)]
pub enum NV_ENC_DEVICE_TYPE {
    NV_ENC_DEVICE_TYPE_DIRECTX = 0,
    NV_ENC_DEVICE_TYPE_CUDA = 1,
    NV_ENC_DEVICE_TYPE_OPENGL = 2,
    NV_ENC_DEVICE_TYPE_DIRECTX11 = 3,
    NV_ENC_DEVICE_TYPE_DIRECTX12 = 4,
}

#[repr(u32)]
#[derive(Copy, Clone, Debug)]
pub enum NV_ENC_BUFFER_FORMAT {
    NV_ENC_BUFFER_FORMAT_UNDEFINED = 0x00000000,
    NV_ENC_BUFFER_FORMAT_NV12 = 0x00000001,
    NV_ENC_BUFFER_FORMAT_YV12 = 0x00000010,
    NV_ENC_BUFFER_FORMAT_IYUV = 0x00000100,
    NV_ENC_BUFFER_FORMAT_YUV444 = 0x00001000,
    NV_ENC_BUFFER_FORMAT_YUV420_10BIT = 0x00010000,
    NV_ENC_BUFFER_FORMAT_YUV444_10BIT = 0x00100000,
    NV_ENC_BUFFER_FORMAT_ARGB = 0x01000000,
    NV_ENC_BUFFER_FORMAT_ARGB10 = 0x02000000,
    NV_ENC_BUFFER_FORMAT_AYUV = 0x04000000,
    NV_ENC_BUFFER_FORMAT_ABGR = 0x10000000,
    NV_ENC_BUFFER_FORMAT_ABGR10 = 0x20000000,
}

#[repr(u32)]
#[derive(Copy, Clone, Debug)]
pub enum NV_ENC_PIC_TYPE {
    NV_ENC_PIC_TYPE_P = 0,
    NV_ENC_PIC_TYPE_B = 1,
    NV_ENC_PIC_TYPE_I = 2,
    NV_ENC_PIC_TYPE_IDR = 3,
    NV_ENC_PIC_TYPE_BI = 4,
    NV_ENC_PIC_TYPE_SKIPPED = 5,
    NV_ENC_PIC_TYPE_INTRA_REFRESH = 6,
    NV_ENC_PIC_TYPE_NONREF_P = 7,
    NV_ENC_PIC_TYPE_UNKNOWN = 0xFF,
}

#[repr(u32)]
#[derive(Copy, Clone, Debug)]
pub enum NV_ENC_PARAMS_RC_MODE {
    NV_ENC_PARAMS_RC_CONSTQP = 0x0,
    NV_ENC_PARAMS_RC_VBR = 0x1,
    NV_ENC_PARAMS_RC_CBR = 0x2,
    NV_ENC_PARAMS_RC_CBR_LOWDELAY_HQ = 0x8,
    NV_ENC_PARAMS_RC_CBR_HQ = 0x10,
    NV_ENC_PARAMS_RC_VBR_HQ = 0x20,
}

#[repr(u32)]
#[derive(Copy, Clone, Debug)]
pub enum NV_ENC_TUNING_INFO {
    NV_ENC_TUNING_INFO_UNDEFINED = 0,
    NV_ENC_TUNING_INFO_HIGH_QUALITY = 1,
    NV_ENC_TUNING_INFO_LOW_LATENCY = 2,
    NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY = 3,
    NV_ENC_TUNING_INFO_LOSSLESS = 4,
}

#[repr(u32)]
#[derive(Copy, Clone, Debug)]
pub enum NV_ENC_PIC_FLAGS {
    NV_ENC_PIC_FLAG_FORCEINTRA = 0x1,
    NV_ENC_PIC_FLAG_FORCEIDR = 0x2,
    NV_ENC_PIC_FLAG_OUTPUT_SPSPPS = 0x4,
    NV_ENC_PIC_FLAG_EOS = 0x8,
}

// ============================================
// Structures - API Version
// ============================================

// Use SDK 13.0 for broad compatibility (matches installed header)
pub const NVENCAPI_MAJOR_VERSION: u32 = 13;
pub const NVENCAPI_MINOR_VERSION: u32 = 0;

// Alternative versions for fallback
pub const NVENCAPI_MAJOR_VERSION_FALLBACK: u32 = 12;
pub const NVENCAPI_MINOR_VERSION_FALLBACK: u32 = 0;

// NVENC version format: per NVIDIA header
// #define NVENCAPI_VERSION (NVENCAPI_MAJOR_VERSION | (NVENCAPI_MINOR_VERSION << 24))
pub const fn NVENCAPI_VERSION() -> u32 {
    NVENCAPI_MAJOR_VERSION | (NVENCAPI_MINOR_VERSION << 24)
}

pub const fn NVENCAPI_VERSION_FALLBACK() -> u32 {
    NVENCAPI_MAJOR_VERSION_FALLBACK | (NVENCAPI_MINOR_VERSION_FALLBACK << 24)
}

pub const fn NVENCAPI_STRUCT_VERSION(ver: u32, size: u32) -> u32 {
    ver | (size << 16) | (0x7 << 28)
}

// ============================================
// Structures - Open Encode Session
// ============================================

#[repr(C)]
pub struct NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS {
    pub version: u32,
    pub deviceType: NV_ENC_DEVICE_TYPE,
    pub device: *mut c_void,
    pub reserved: *mut c_void,
    pub apiVersion: u32,
    pub reserved1: [u32; 253],
    pub reserved2: [*mut c_void; 64],
}

impl Default for NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS {
    fn default() -> Self {
        Self {
            version: NVENCAPI_STRUCT_VERSION(1, std::mem::size_of::<NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS>() as u32),
            deviceType: NV_ENC_DEVICE_TYPE::NV_ENC_DEVICE_TYPE_DIRECTX11,
            device: std::ptr::null_mut(),
            reserved: std::ptr::null_mut(),
            apiVersion: NVENCAPI_VERSION(),
            reserved1: [0; 253],
            reserved2: [std::ptr::null_mut(); 64],
        }
    }
}

// ============================================
// Structures - Preset Config
// ============================================

#[repr(C)]
pub struct NV_ENC_PRESET_CONFIG {
    pub version: u32,
    pub presetCfg: NV_ENC_CONFIG,
    pub reserved1: [u32; 255],
    pub reserved2: [*mut c_void; 64],
}

impl Default for NV_ENC_PRESET_CONFIG {
    fn default() -> Self {
        Self {
            version: NVENCAPI_STRUCT_VERSION(4, std::mem::size_of::<NV_ENC_PRESET_CONFIG>() as u32),
            presetCfg: NV_ENC_CONFIG::default(),
            reserved1: [0; 255],
            reserved2: [std::ptr::null_mut(); 64],
        }
    }
}

// ============================================
// Structures - Initialize Encoder
// ============================================

#[repr(C)]
pub struct NV_ENC_INITIALIZE_PARAMS {
    pub version: u32,
    pub encodeGUID: GUID,
    pub presetGUID: GUID,
    pub encodeWidth: u32,
    pub encodeHeight: u32,
    pub darWidth: u32,
    pub darHeight: u32,
    pub frameRateNum: u32,
    pub frameRateDen: u32,
    pub reservedBitFields: u32,
    pub privDataSize: u32,
    pub privData: *mut c_void,
    pub encodeConfig: *mut NV_ENC_CONFIG,
    pub maxEncodeWidth: u32,
    pub maxEncodeHeight: u32,
    pub maxMEHintCountsPerBlock: [u32; 2],
    pub tuningInfo: NV_ENC_TUNING_INFO,
    pub bufferFmt: NV_ENC_BUFFER_FORMAT,
    pub reserved: [u32; 286],
    pub reserved2: [*mut c_void; 64],
}

impl Default for NV_ENC_INITIALIZE_PARAMS {
    fn default() -> Self {
        Self {
            version: NVENCAPI_STRUCT_VERSION(5, std::mem::size_of::<NV_ENC_INITIALIZE_PARAMS>() as u32),
            encodeGUID: NV_ENC_CODEC_H264_GUID,
            presetGUID: NV_ENC_PRESET_LOW_LATENCY_HP_GUID,
            encodeWidth: 1920,
            encodeHeight: 1080,
            darWidth: 1920,
            darHeight: 1080,
            frameRateNum: 60,
            frameRateDen: 1,
            reservedBitFields: 2, // enablePTD = 1 (bit 1)
            privDataSize: 0,
            privData: std::ptr::null_mut(),
            encodeConfig: std::ptr::null_mut(),
            maxEncodeWidth: 0,
            maxEncodeHeight: 0,
            maxMEHintCountsPerBlock: [0; 2],
            tuningInfo: NV_ENC_TUNING_INFO::NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY,
            bufferFmt: NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_ABGR,
            reserved: [0; 286],
            reserved2: [std::ptr::null_mut(); 64],
        }
    }
}

// ============================================
// Structures - Encode Config
// ============================================

#[repr(C)]
pub struct NV_ENC_CONFIG {
    pub version: u32,
    pub profileGUID: GUID,
    pub encodeCodecConfig: NV_ENC_CODEC_CONFIG,
    pub monoChromeEncoding: u32,
    pub frameIntervalP: i32,
    pub gopLength: u32,
    pub frameFieldMode: u32,
    pub mvPrecision: u32,
    pub rcParams: NV_ENC_RC_PARAMS,
    pub reserved1: [u32; 255],
    pub reserved2: [*mut c_void; 64],
}

impl Default for NV_ENC_CONFIG {
    fn default() -> Self {
        Self {
            version: NVENCAPI_STRUCT_VERSION(7, std::mem::size_of::<NV_ENC_CONFIG>() as u32),
            profileGUID: NV_ENC_H264_PROFILE_BASELINE_GUID,
            encodeCodecConfig: NV_ENC_CODEC_CONFIG::default(),
            monoChromeEncoding: 0,
            frameIntervalP: 0,
            gopLength: 0,
            frameFieldMode: 0,
            mvPrecision: 0,
            rcParams: NV_ENC_RC_PARAMS::default(),
            reserved1: [0; 255],
            reserved2: [std::ptr::null_mut(); 64],
        }
    }
}

#[repr(C)]
pub struct NV_ENC_RC_PARAMS {
    pub version: u32,
    pub rateControlMode: NV_ENC_PARAMS_RC_MODE,
    pub constQP: NV_ENC_QP,
    pub averageBitRate: u32,
    pub maxBitRate: u32,
    pub vbvBufferSize: u32,
    pub vbvInitialDelay: u32,
    pub reservedBitFields: u32,
    pub minQP: NV_ENC_QP,
    pub maxQP: NV_ENC_QP,
    pub initialRCQP: NV_ENC_QP,
    pub temporallayerIdxMask: u32,
    pub temporalLayerQP: [u8; 8],
    pub targetQuality: u8,
    pub targetQualityLSB: u8,
    pub lookaheadDepth: u16,
    pub lowDelayKeyFrameScale: u8,
    pub reserved1: [u8; 3],
    pub qpMapMode: u32,
    pub multiPass: u32,
    pub alphaLayerBitrateRatio: u32,
    pub cbQPIndexOffset: i32,
    pub crQPIndexOffset: i32,
    pub reserved: [u32; 5],
}

impl Default for NV_ENC_RC_PARAMS {
    fn default() -> Self {
        Self {
            version: NVENCAPI_STRUCT_VERSION(1, std::mem::size_of::<NV_ENC_RC_PARAMS>() as u32),
            rateControlMode: NV_ENC_PARAMS_RC_MODE::NV_ENC_PARAMS_RC_CBR_LOWDELAY_HQ,
            constQP: NV_ENC_QP::default(),
            averageBitRate: 10_000_000,
            maxBitRate: 20_000_000,
            vbvBufferSize: 0,
            vbvInitialDelay: 0,
            reservedBitFields: 8, // enableAQ = 1 (bit 3)
            minQP: NV_ENC_QP::default(),
            maxQP: NV_ENC_QP::default(),
            initialRCQP: NV_ENC_QP::default(),
            temporallayerIdxMask: 0,
            temporalLayerQP: [0; 8],
            targetQuality: 0,
            targetQualityLSB: 0,
            lookaheadDepth: 0,
            lowDelayKeyFrameScale: 1,
            reserved1: [0; 3],
            qpMapMode: 0,
            multiPass: 0,
            alphaLayerBitrateRatio: 0,
            cbQPIndexOffset: 0,
            crQPIndexOffset: 0,
            reserved: [0; 5],
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct NV_ENC_QP {
    pub qpInterP: u32,
    pub qpInterB: u32,
    pub qpIntra: u32,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub union NV_ENC_CODEC_CONFIG {
    pub h264Config: NV_ENC_CONFIG_H264,
    pub hevcConfig: NV_ENC_CONFIG_HEVC,
    pub av1Config: NV_ENC_CONFIG_AV1,
    pub reserved: [u32; 256],
}

impl Default for NV_ENC_CODEC_CONFIG {
    fn default() -> Self {
        Self { reserved: [0; 256] }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct NV_ENC_CONFIG_H264 {
    pub reservedBitFields: u32,
    pub level: u32,
    pub idrPeriod: u32,
    pub separateColourPlaneFlag: u32,
    pub disableDeblockingFilterIDC: u32,
    pub numTemporalLayers: u32,
    pub spsId: u32,
    pub ppsId: u32,
    pub adaptiveTransformMode: u32,
    pub fmoMode: u32,
    pub bdirectMode: u32,
    pub entropyCodingMode: u32,
    pub stereoMode: u32,
    pub intraRefreshPeriod: u32,
    pub intraRefreshCnt: u32,
    pub maxNumRefFrames: u32,
    pub sliceMode: u32,
    pub sliceModeData: u32,
    pub h264VUIParameters: NV_ENC_CONFIG_H264_VUI_PARAMETERS,
    pub ltrNumFrames: u32,
    pub ltrTrustMode: u32,
    pub chromaFormatIDC: u32,
    pub maxTemporalLayers: u32,
    pub useBFramesAsRef: u32,
    pub numRefL0: u32,
    pub numRefL1: u32,
    pub reserved1: [u32; 267],
    pub reserved2: [*mut c_void; 64],
}

impl Default for NV_ENC_CONFIG_H264 {
    fn default() -> Self {
        // Use unsafe zeroed to handle large arrays
        unsafe { std::mem::zeroed() }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct NV_ENC_CONFIG_HEVC {
    pub level: u32,
    pub tier: u32,
    pub minQP: NV_ENC_QP,
    pub maxQP: NV_ENC_QP,
    pub constQP: NV_ENC_QP,
    pub idrPeriod: u32,
    pub gopLength: u32,
    pub reservedBitFields: u32,
    pub reserved: [u32; 244],
}

impl Default for NV_ENC_CONFIG_HEVC {
    fn default() -> Self {
        unsafe { std::mem::zeroed() }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct NV_ENC_CONFIG_AV1 {
    pub level: u32,
    pub tier: u32,
    pub minQP: NV_ENC_QP,
    pub maxQP: NV_ENC_QP,
    pub constQP: NV_ENC_QP,
    pub idrPeriod: u32,
    pub gopLength: u32,
    pub reservedBitFields: u32,
    pub reserved: [u32; 244],
}

impl Default for NV_ENC_CONFIG_AV1 {
    fn default() -> Self {
        unsafe { std::mem::zeroed() }
    }
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct NV_ENC_CONFIG_H264_VUI_PARAMETERS {
    pub overscanInfoPresentFlag: u32,
    pub overscanInfo: u32,
    pub videoSignalTypePresentFlag: u32,
    pub videoFormat: u32,
    pub videoFullRangeFlag: u32,
    pub colourDescriptionPresentFlag: u32,
    pub colourPrimaries: u32,
    pub transferCharacteristics: u32,
    pub colourMatrix: u32,
    pub chromaSampleLocationFlag: u32,
    pub chromaSampleLocationTop: u32,
    pub chromaSampleLocationBot: u32,
    pub bitstreamRestrictionFlag: u32,
    pub reserved: [u32; 15],
}

// ============================================
// Structures - Create Input Buffer
// ============================================

#[repr(C)]
pub struct NV_ENC_CREATE_INPUT_BUFFER {
    pub version: u32,
    pub width: u32,
    pub height: u32,
    pub memoryHeap: u32,
    pub bufferFmt: NV_ENC_BUFFER_FORMAT,
    pub reserved: u32,
    pub inputBuffer: NV_ENC_INPUT_PTR,
    pub pSysMemBuffer: *mut c_void,
    pub reserved1: [u32; 57],
    pub reserved2: [*mut c_void; 63],
}

impl Default for NV_ENC_CREATE_INPUT_BUFFER {
    fn default() -> Self {
        Self {
            version: NVENCAPI_STRUCT_VERSION(1, std::mem::size_of::<NV_ENC_CREATE_INPUT_BUFFER>() as u32),
            width: 0,
            height: 0,
            memoryHeap: 0,
            bufferFmt: NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_ARGB,
            reserved: 0,
            inputBuffer: std::ptr::null_mut(),
            pSysMemBuffer: std::ptr::null_mut(),
            reserved1: [0; 57],
            reserved2: [std::ptr::null_mut(); 63],
        }
    }
}

// ============================================
// Structures - Create Bitstream Buffer
// ============================================

#[repr(C)]
pub struct NV_ENC_CREATE_BITSTREAM_BUFFER {
    pub version: u32,
    pub size: u32,
    pub memoryHeap: u32,
    pub reserved: u32,
    pub bitstreamBuffer: NV_ENC_OUTPUT_PTR,
    pub bitstreamBufferPtr: *mut c_void,
    pub reserved1: [u32; 58],
    pub reserved2: [*mut c_void; 64],
}

impl Default for NV_ENC_CREATE_BITSTREAM_BUFFER {
    fn default() -> Self {
        Self {
            version: NVENCAPI_STRUCT_VERSION(1, std::mem::size_of::<NV_ENC_CREATE_BITSTREAM_BUFFER>() as u32),
            size: 0,
            memoryHeap: 0,
            reserved: 0,
            bitstreamBuffer: std::ptr::null_mut(),
            bitstreamBufferPtr: std::ptr::null_mut(),
            reserved1: [0; 58],
            reserved2: [std::ptr::null_mut(); 64],
        }
    }
}

// ============================================
// Structures - Lock Input Buffer
// ============================================

#[repr(C)]
pub struct NV_ENC_LOCK_INPUT_BUFFER {
    pub version: u32,
    pub reservedBitFields: u32,
    pub inputBuffer: NV_ENC_INPUT_PTR,
    pub bufferDataPtr: *mut c_void,
    pub pitch: u32,
    pub reserved1: [u32; 251],
    pub reserved2: [*mut c_void; 64],
}

impl Default for NV_ENC_LOCK_INPUT_BUFFER {
    fn default() -> Self {
        Self {
            version: NVENCAPI_STRUCT_VERSION(1, std::mem::size_of::<NV_ENC_LOCK_INPUT_BUFFER>() as u32),
            reservedBitFields: 0,
            inputBuffer: std::ptr::null_mut(),
            bufferDataPtr: std::ptr::null_mut(),
            pitch: 0,
            reserved1: [0; 251],
            reserved2: [std::ptr::null_mut(); 64],
        }
    }
}

// ============================================
// Structures - Lock Bitstream
// ============================================

#[repr(C)]
pub struct NV_ENC_LOCK_BITSTREAM {
    pub version: u32,
    pub reservedBitFields: u32,
    pub frameIdx: u32,
    pub hwEncodeStatus: u32,
    pub numSlices: u32,
    pub bitstreamSizeInBytes: u32,
    pub outputTimeStamp: u64,
    pub outputDuration: u64,
    pub bitstreamBufferPtr: *mut c_void,
    pub pictureType: NV_ENC_PIC_TYPE,
    pub pictureStruct: u32,
    pub frameAvgQP: u32,
    pub frameSatd: u32,
    pub ltrFrameIdx: u32,
    pub ltrFrameBitmap: u32,
    pub temporalId: u32,
    pub reserved: [u32; 13],
    pub intraMBCount: u32,
    pub interMBCount: u32,
    pub averageMVX: i32,
    pub averageMVY: i32,
    pub alphaLayerSizeInBytes: u32,
    pub outputBitstreamBuffer: NV_ENC_OUTPUT_PTR,
    pub reserved1: [u32; 216],
    pub reserved2: [*mut c_void; 64],
}

impl Default for NV_ENC_LOCK_BITSTREAM {
    fn default() -> Self {
        Self {
            version: NVENCAPI_STRUCT_VERSION(2, std::mem::size_of::<NV_ENC_LOCK_BITSTREAM>() as u32),
            reservedBitFields: 0,
            frameIdx: 0,
            hwEncodeStatus: 0,
            numSlices: 0,
            bitstreamSizeInBytes: 0,
            outputTimeStamp: 0,
            outputDuration: 0,
            bitstreamBufferPtr: std::ptr::null_mut(),
            pictureType: NV_ENC_PIC_TYPE::NV_ENC_PIC_TYPE_UNKNOWN,
            pictureStruct: 0,
            frameAvgQP: 0,
            frameSatd: 0,
            ltrFrameIdx: 0,
            ltrFrameBitmap: 0,
            temporalId: 0,
            reserved: [0; 13],
            intraMBCount: 0,
            interMBCount: 0,
            averageMVX: 0,
            averageMVY: 0,
            alphaLayerSizeInBytes: 0,
            outputBitstreamBuffer: std::ptr::null_mut(),
            reserved1: [0; 216],
            reserved2: [std::ptr::null_mut(); 64],
        }
    }
}

// ============================================
// Structures - Encode Picture
// ============================================

#[repr(C)]
pub struct NV_ENC_PIC_PARAMS {
    pub version: u32,
    pub inputWidth: u32,
    pub inputHeight: u32,
    pub inputPitch: u32,
    pub encodePicFlags: u32,
    pub frameIdx: u32,
    pub inputTimeStamp: u64,
    pub inputDuration: u64,
    pub inputBuffer: NV_ENC_INPUT_PTR,
    pub outputBitstream: NV_ENC_OUTPUT_PTR,
    pub completionEvent: *mut c_void,
    pub bufferFmt: NV_ENC_BUFFER_FORMAT,
    pub pictureStruct: u32,
    pub pictureType: NV_ENC_PIC_TYPE,
    pub codecPicParams: NV_ENC_CODEC_PIC_PARAMS,
    pub meHintCountsPerBlock: [u32; 2],
    pub meExternalHints: *mut c_void,
    pub reserved1: [u32; 6],
    pub reserved2: [*mut c_void; 2],
    pub qpDeltaMap: *mut i8,
    pub qpDeltaMapSize: u32,
    pub reservedBitFields: u32,
    pub meHintRefPicDist: [u32; 2],
    pub alphaBuffer: NV_ENC_INPUT_PTR,
    pub reserved3: [u32; 286],
    pub reserved4: [*mut c_void; 60],
}

impl Default for NV_ENC_PIC_PARAMS {
    fn default() -> Self {
        Self {
            version: NVENCAPI_STRUCT_VERSION(6, std::mem::size_of::<NV_ENC_PIC_PARAMS>() as u32),
            inputWidth: 0,
            inputHeight: 0,
            inputPitch: 0,
            encodePicFlags: 0,
            frameIdx: 0,
            inputTimeStamp: 0,
            inputDuration: 0,
            inputBuffer: std::ptr::null_mut(),
            outputBitstream: std::ptr::null_mut(),
            completionEvent: std::ptr::null_mut(),
            bufferFmt: NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_ARGB,
            pictureStruct: 0,
            pictureType: NV_ENC_PIC_TYPE::NV_ENC_PIC_TYPE_P,
            codecPicParams: NV_ENC_CODEC_PIC_PARAMS::default(),
            meHintCountsPerBlock: [0; 2],
            meExternalHints: std::ptr::null_mut(),
            reserved1: [0; 6],
            reserved2: [std::ptr::null_mut(); 2],
            qpDeltaMap: std::ptr::null_mut(),
            qpDeltaMapSize: 0,
            reservedBitFields: 0,
            meHintRefPicDist: [0; 2],
            alphaBuffer: std::ptr::null_mut(),
            reserved3: [0; 286],
            reserved4: [std::ptr::null_mut(); 60],
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub union NV_ENC_CODEC_PIC_PARAMS {
    pub h264PicParams: NV_ENC_PIC_PARAMS_H264,
    pub hevcPicParams: NV_ENC_PIC_PARAMS_HEVC,
    pub reserved: [u32; 256],
}

impl Default for NV_ENC_CODEC_PIC_PARAMS {
    fn default() -> Self {
        Self { reserved: [0; 256] }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct NV_ENC_PIC_PARAMS_H264 {
    pub displayPOCSyntax: u32,
    pub reserved3: u32,
    pub refPicFlag: u32,
    pub colourPlaneId: u32,
    pub forceIntraRefreshWithFrameCnt: u32,
    pub constrainedFrame: u32,
    pub sliceModeDataUpdate: u32,
    pub ltrMarkFrame: u32,
    pub ltrUseFrames: u32,
    pub ltrUseBitmap: u32,
    pub ltrMarkFrameIdx: u32,
    pub ltrUseFrameBitmap: u32,
    pub ltrFrameIdx: u32,
    pub seiPayloadArrayCnt: u32,
    pub reserved: [u32; 242],
    pub reserved2: [*mut c_void; 62],
}

impl Default for NV_ENC_PIC_PARAMS_H264 {
    fn default() -> Self {
        unsafe { std::mem::zeroed() }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct NV_ENC_PIC_PARAMS_HEVC {
    pub reserved: [u32; 256],
}

impl Default for NV_ENC_PIC_PARAMS_HEVC {
    fn default() -> Self {
        unsafe { std::mem::zeroed() }
    }
}

// ============================================
// Structures - Resource Registration & Mapping
// ============================================

#[repr(u32)]
#[derive(Copy, Clone, Debug)]
pub enum NV_ENC_INPUT_RESOURCE_TYPE {
    NV_ENC_INPUT_RESOURCE_TYPE_DIRECTX = 0x0,
    NV_ENC_INPUT_RESOURCE_TYPE_CUDAARRAY = 0x1,
    NV_ENC_INPUT_RESOURCE_TYPE_CUDADEVICEPTR = 0x2,
    NV_ENC_INPUT_RESOURCE_TYPE_OPENGL_TEX = 0x3,
}

#[repr(C)]
pub struct NV_ENC_REGISTER_RESOURCE {
    pub version: u32,
    pub resourceType: NV_ENC_INPUT_RESOURCE_TYPE,
    pub width: u32,
    pub height: u32,
    pub pitch: u32,
    pub subResourceIndex: u32,
    pub resourceToRegister: *mut c_void,
    pub registeredResource: NV_ENC_REGISTERED_PTR,
    pub bufferFormat: NV_ENC_BUFFER_FORMAT,
    pub bufferUsage: u32,
    pub encodeWidth: u32,
    pub encodeHeight: u32,
    pub reserved1: [u32; 249],
    pub reserved2: [*mut c_void; 62],
}

impl Default for NV_ENC_REGISTER_RESOURCE {
    fn default() -> Self {
        Self {
            version: NVENCAPI_STRUCT_VERSION(4, std::mem::size_of::<NV_ENC_REGISTER_RESOURCE>() as u32),
            resourceType: NV_ENC_INPUT_RESOURCE_TYPE::NV_ENC_INPUT_RESOURCE_TYPE_DIRECTX,
            width: 0,
            height: 0,
            pitch: 0,
            subResourceIndex: 0,
            resourceToRegister: std::ptr::null_mut(),
            registeredResource: std::ptr::null_mut(),
            bufferFormat: NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_ARGB,
            bufferUsage: 0,
            encodeWidth: 0,
            encodeHeight: 0,
            reserved1: [0; 249],
            reserved2: [std::ptr::null_mut(); 62],
        }
    }
}

#[repr(C)]
pub struct NV_ENC_MAP_INPUT_RESOURCE {
    pub version: u32,
    pub subResourceIndex: u32,
    pub inputResource: *mut c_void,
    pub registeredResource: NV_ENC_REGISTERED_PTR,
    pub mappedResource: NV_ENC_INPUT_PTR,
    pub mappedBufferFmt: NV_ENC_BUFFER_FORMAT,
    pub reserved1: [u32; 251],
    pub reserved2: [*mut c_void; 63],
}

impl Default for NV_ENC_MAP_INPUT_RESOURCE {
    fn default() -> Self {
        Self {
            version: NVENCAPI_STRUCT_VERSION(4, std::mem::size_of::<NV_ENC_MAP_INPUT_RESOURCE>() as u32),
            subResourceIndex: 0,
            inputResource: std::ptr::null_mut(),
            registeredResource: std::ptr::null_mut(),
            mappedResource: std::ptr::null_mut(),
            mappedBufferFmt: NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_ARGB,
            reserved1: [0; 251],
            reserved2: [std::ptr::null_mut(); 63],
        }
    }
}

// ============================================
// Function Pointers
// ============================================

#[repr(C)]
pub struct NV_ENCODE_API_FUNCTION_LIST {
    pub version: u32,
    pub reserved: u32,
    pub nvEncOpenEncodeSession:
        Option<unsafe extern "C" fn(*mut c_void, u32, *mut *mut c_void) -> NVENCSTATUS>,
    pub nvEncGetEncodeGUIDCount: Option<unsafe extern "C" fn(*mut c_void, *mut u32) -> NVENCSTATUS>,
    pub nvEncGetEncodeProfileGUIDCount:
        Option<unsafe extern "C" fn(*mut c_void, GUID, *mut u32) -> NVENCSTATUS>,
    pub nvEncGetEncodeProfileGUIDs:
        Option<unsafe extern "C" fn(*mut c_void, GUID, *mut GUID, u32, *mut u32) -> NVENCSTATUS>,
    pub nvEncGetEncodeGUIDs:
        Option<unsafe extern "C" fn(*mut c_void, *mut GUID, u32, *mut u32) -> NVENCSTATUS>,
    pub nvEncGetInputFormatCount:
        Option<unsafe extern "C" fn(*mut c_void, GUID, *mut u32) -> NVENCSTATUS>,
    pub nvEncGetInputFormats: Option<
        unsafe extern "C" fn(
            *mut c_void,
            GUID,
            *mut NV_ENC_BUFFER_FORMAT,
            u32,
            *mut u32,
        ) -> NVENCSTATUS,
    >,
    pub nvEncGetEncodeCaps:
        Option<unsafe extern "C" fn(*mut c_void, GUID, *mut c_void, *mut i32) -> NVENCSTATUS>,
    pub nvEncGetEncodePresetCount:
        Option<unsafe extern "C" fn(*mut c_void, GUID, *mut u32) -> NVENCSTATUS>,
    pub nvEncGetEncodePresetGUIDs:
        Option<unsafe extern "C" fn(*mut c_void, GUID, *mut GUID, u32, *mut u32) -> NVENCSTATUS>,
    pub nvEncGetEncodePresetConfig:
        Option<unsafe extern "C" fn(*mut c_void, GUID, GUID, *mut c_void) -> NVENCSTATUS>,
    pub nvEncGetEncodePresetConfigEx: Option<
        unsafe extern "C" fn(
            *mut c_void,
            GUID,
            GUID,
            NV_ENC_TUNING_INFO,
            *mut c_void,
        ) -> NVENCSTATUS,
    >,
    pub nvEncInitializeEncoder:
        Option<unsafe extern "C" fn(*mut c_void, *mut NV_ENC_INITIALIZE_PARAMS) -> NVENCSTATUS>,
    pub nvEncCreateInputBuffer:
        Option<unsafe extern "C" fn(*mut c_void, *mut NV_ENC_CREATE_INPUT_BUFFER) -> NVENCSTATUS>,
    pub nvEncDestroyInputBuffer:
        Option<unsafe extern "C" fn(*mut c_void, NV_ENC_INPUT_PTR) -> NVENCSTATUS>,
    pub nvEncCreateBitstreamBuffer: Option<
        unsafe extern "C" fn(*mut c_void, *mut NV_ENC_CREATE_BITSTREAM_BUFFER) -> NVENCSTATUS,
    >,
    pub nvEncDestroyBitstreamBuffer:
        Option<unsafe extern "C" fn(*mut c_void, NV_ENC_OUTPUT_PTR) -> NVENCSTATUS>,
    pub nvEncEncodePicture:
        Option<unsafe extern "C" fn(*mut c_void, *mut NV_ENC_PIC_PARAMS) -> NVENCSTATUS>,
    pub nvEncLockBitstream:
        Option<unsafe extern "C" fn(*mut c_void, *mut NV_ENC_LOCK_BITSTREAM) -> NVENCSTATUS>,
    pub nvEncUnlockBitstream:
        Option<unsafe extern "C" fn(*mut c_void, NV_ENC_OUTPUT_PTR) -> NVENCSTATUS>,
    pub nvEncLockInputBuffer:
        Option<unsafe extern "C" fn(*mut c_void, *mut NV_ENC_LOCK_INPUT_BUFFER) -> NVENCSTATUS>,
    pub nvEncUnlockInputBuffer:
        Option<unsafe extern "C" fn(*mut c_void, NV_ENC_INPUT_PTR) -> NVENCSTATUS>,
    pub nvEncGetEncodeStats: Option<unsafe extern "C" fn(*mut c_void, *mut c_void) -> NVENCSTATUS>,
    pub nvEncGetSequenceParams:
        Option<unsafe extern "C" fn(*mut c_void, *mut c_void) -> NVENCSTATUS>,
    pub nvEncRegisterAsyncEvent:
        Option<unsafe extern "C" fn(*mut c_void, *mut c_void) -> NVENCSTATUS>,
    pub nvEncUnregisterAsyncEvent:
        Option<unsafe extern "C" fn(*mut c_void, *mut c_void) -> NVENCSTATUS>,
    pub nvEncMapInputResource:
        Option<unsafe extern "C" fn(*mut c_void, *mut c_void) -> NVENCSTATUS>,
    pub nvEncUnmapInputResource:
        Option<unsafe extern "C" fn(*mut c_void, NV_ENC_REGISTERED_PTR) -> NVENCSTATUS>,
    pub nvEncDestroyEncoder: Option<unsafe extern "C" fn(*mut c_void) -> NVENCSTATUS>,
    pub nvEncInvalidateRefFrames: Option<unsafe extern "C" fn(*mut c_void, u64) -> NVENCSTATUS>,
    pub nvEncOpenEncodeSessionEx: Option<
        unsafe extern "C" fn(
            *mut NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS,
            *mut *mut c_void,
        ) -> NVENCSTATUS,
    >,
    pub nvEncRegisterResource:
        Option<unsafe extern "C" fn(*mut c_void, *mut c_void) -> NVENCSTATUS>,
    pub nvEncUnregisterResource:
        Option<unsafe extern "C" fn(*mut c_void, NV_ENC_REGISTERED_PTR) -> NVENCSTATUS>,
    pub nvEncReconfigureEncoder:
        Option<unsafe extern "C" fn(*mut c_void, *mut c_void) -> NVENCSTATUS>,
    pub reserved1: *mut c_void,
    pub nvEncCreateMVBuffer: Option<unsafe extern "C" fn(*mut c_void, *mut c_void) -> NVENCSTATUS>,
    pub nvEncDestroyMVBuffer:
        Option<unsafe extern "C" fn(*mut c_void, NV_ENC_OUTPUT_PTR) -> NVENCSTATUS>,
    pub nvEncRunMotionEstimationOnly:
        Option<unsafe extern "C" fn(*mut c_void, *mut c_void) -> NVENCSTATUS>,
    pub nvEncGetLastErrorString: Option<unsafe extern "C" fn(*mut c_void) -> *const i8>,
    pub nvEncSetIOCudaStreams:
        Option<unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> NVENCSTATUS>,
    pub nvEncGetEncodePresetGUIDsEx: Option<
        unsafe extern "C" fn(
            *mut c_void,
            GUID,
            NV_ENC_TUNING_INFO,
            *mut GUID,
            u32,
            *mut u32,
        ) -> NVENCSTATUS,
    >,
    pub nvEncGetSequenceParamEx: Option<
        unsafe extern "C" fn(
            *mut c_void,
            *mut NV_ENC_INITIALIZE_PARAMS,
            *mut c_void,
        ) -> NVENCSTATUS,
    >,
    pub nvEncRestoreEncoderState:
        Option<unsafe extern "C" fn(*mut c_void, *mut c_void) -> NVENCSTATUS>,
    pub nvEncGetEncoderStateSize:
        Option<unsafe extern "C" fn(*mut c_void, *mut usize) -> NVENCSTATUS>,
    pub reserved2: [*mut c_void; 277],
}

impl Default for NV_ENCODE_API_FUNCTION_LIST {
    fn default() -> Self {
        Self {
            version: NVENCAPI_STRUCT_VERSION(2, std::mem::size_of::<NV_ENCODE_API_FUNCTION_LIST>() as u32),
            reserved: 0,
            nvEncOpenEncodeSession: None,
            nvEncGetEncodeGUIDCount: None,
            nvEncGetEncodeProfileGUIDCount: None,
            nvEncGetEncodeProfileGUIDs: None,
            nvEncGetEncodeGUIDs: None,
            nvEncGetInputFormatCount: None,
            nvEncGetInputFormats: None,
            nvEncGetEncodeCaps: None,
            nvEncGetEncodePresetCount: None,
            nvEncGetEncodePresetGUIDs: None,
            nvEncGetEncodePresetConfig: None,
            nvEncGetEncodePresetConfigEx: None,
            nvEncInitializeEncoder: None,
            nvEncCreateInputBuffer: None,
            nvEncDestroyInputBuffer: None,
            nvEncCreateBitstreamBuffer: None,
            nvEncDestroyBitstreamBuffer: None,
            nvEncEncodePicture: None,
            nvEncLockBitstream: None,
            nvEncUnlockBitstream: None,
            nvEncLockInputBuffer: None,
            nvEncUnlockInputBuffer: None,
            nvEncGetEncodeStats: None,
            nvEncGetSequenceParams: None,
            nvEncRegisterAsyncEvent: None,
            nvEncUnregisterAsyncEvent: None,
            nvEncMapInputResource: None,
            nvEncUnmapInputResource: None,
            nvEncDestroyEncoder: None,
            nvEncInvalidateRefFrames: None,
            nvEncOpenEncodeSessionEx: None,
            nvEncRegisterResource: None,
            nvEncUnregisterResource: None,
            nvEncReconfigureEncoder: None,
            reserved1: std::ptr::null_mut(),
            nvEncCreateMVBuffer: None,
            nvEncDestroyMVBuffer: None,
            nvEncRunMotionEstimationOnly: None,
            nvEncGetLastErrorString: None,
            nvEncSetIOCudaStreams: None,
            nvEncGetEncodePresetGUIDsEx: None,
            nvEncGetSequenceParamEx: None,
            nvEncRestoreEncoderState: None,
            nvEncGetEncoderStateSize: None,
            reserved2: [std::ptr::null_mut(); 277],
        }
    }
}

// API Entry Point Type
pub type NvEncodeAPICreateInstanceFn =
    unsafe extern "C" fn(*mut NV_ENCODE_API_FUNCTION_LIST) -> NVENCSTATUS;
