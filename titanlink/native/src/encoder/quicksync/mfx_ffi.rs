//! Intel Media SDK (libmfx) FFI Bindings for QuickSync
//!
//! These bindings allow direct access to Intel Media SDK for hardware-accelerated
//! video encoding on Intel integrated graphics.

#![allow(non_camel_case_types)]
#![allow(non_snake_case)]
#![allow(dead_code)]

use std::ffi::c_void;
use std::ptr;

// ============================================
// Basic Types and Status Codes
// ============================================

pub type mfxStatus = i32;
pub type mfxU64 = u64;
pub type mfxU32 = u32;
pub type mfxU16 = u16;
pub type mfxU8 = u8;
pub type mfxI32 = i32;
pub type mfxI16 = i16;
pub type mfxI64 = i64;
pub type mfxF64 = f64;

pub const MFX_ERR_NONE: mfxStatus = 0;
pub const MFX_ERR_UNKNOWN: mfxStatus = -1;
pub const MFX_ERR_NULL_PTR: mfxStatus = -2;
pub const MFX_ERR_UNSUPPORTED: mfxStatus = -3;
pub const MFX_ERR_MEMORY_ALLOC: mfxStatus = -4;
pub const MFX_ERR_NOT_INITIALIZED: mfxStatus = -5;
pub const MFX_ERR_NOT_ENOUGH_BUFFER: mfxStatus = -6;
pub const MFX_ERR_INVALID_HANDLE: mfxStatus = -7;
pub const MFX_ERR_LOCK_MEMORY: mfxStatus = -8;
pub const MFX_ERR_NOT_FOUND: mfxStatus = -9;
pub const MFX_ERR_MORE_DATA: mfxStatus = -10;
pub const MFX_ERR_MORE_SURFACE: mfxStatus = -11;
pub const MFX_ERR_ABORTED: mfxStatus = -12;
pub const MFX_ERR_DEVICE_LOST: mfxStatus = -13;
pub const MFX_ERR_INCOMPATIBLE_VIDEO_PARAM: mfxStatus = -14;
pub const MFX_ERR_INVALID_VIDEO_PARAM: mfxStatus = -15;
pub const MFX_ERR_UNDEFINED_BEHAVIOR: mfxStatus = -16;
pub const MFX_ERR_DEVICE_FAILED: mfxStatus = -17;
pub const MFX_ERR_MORE_BITSTREAM: mfxStatus = -18;
pub const MFX_ERR_GPU_HANG: mfxStatus = -19;
pub const MFX_ERR_REALLOC_SURFACE: mfxStatus = -20;
pub const MFX_ERR_RESOURCE_ALLOC: mfxStatus = -21;
pub const MFX_ERR_RESOURCE_NOT_TX_RDY: mfxStatus = -22;
pub const MFX_ERR_NOT_IMPLEMENTED: mfxStatus = -9999;

pub const MFX_WRN_IN_EXECUTION: mfxStatus = 1;
pub const MFX_WRN_DEVICE_BUSY: mfxStatus = 2;
pub const MFX_WRN_VIDEO_PARAM_CHANGED: mfxStatus = 3;
pub const MFX_WRN_PARTIAL_ACCELERATION: mfxStatus = 4;
pub const MFX_WRN_VALUE_NOT_CHANGED: mfxStatus = 5;
pub const MFX_WRN_OUT_OF_RANGE: mfxStatus = 6;
pub const MFX_WRN_FILTER_SKIPPED: mfxStatus = 7;
pub const MFX_WRN_INCOMPATIBLE_VIDEO_PARAM: mfxStatus = 8;

// ============================================
// Surface Types
// ============================================

#[repr(u32)]
#[derive(Debug, Copy, Clone, PartialEq)]
pub enum MFX_FOURCC {
    NV12 = 0x3231564E, // 'NV12' (YUV 4:2:0 planar, 12bpp)
    YUY2 = 0x32595559, // 'YUY2' (YUV 4:2:2 packed, 16bpp)
    RGB4 = 0x34424752, // 'RGB4' (32-bit BGRA)
    P010 = 0x30313050, // 'P010' (YUV 4:2:0 planar 10-bit)
}

#[repr(u16)]
#[derive(Debug, Copy, Clone, PartialEq)]
pub enum MFX_PICSTRUCT {
    PROGRESSIVE = 0,
    // FIELD_TFF = 1, // Duplicate of TOP_FIRST
    // FIELD_BFF = 2, // Duplicate of BOTTOM_FIRST
    // FIELD_TFF_OR_REPEAT = 3, // Conflict
    TOP_FIRST = 0x0001,
    BOTTOM_FIRST = 0x0002,
    DOUBLE_FIRST = 0x0004,
    DOUBLE_REPEAT = 0x0008,
}

// Bit flags for PICSTRUCT (can be OR'd together)
pub const MFX_PICSTRUCT_TOP_FIRST_U16: u16 = 0x0001;
pub const MFX_PICSTRUCT_BOTTOM_FIRST_U16: u16 = 0x0002;

#[repr(u32)]
#[derive(Debug, Copy, Clone, PartialEq)]
pub enum MFX_FRAME_TYPE {
    UNKNOWN = 0,
    I = 1,
    P = 2,
    B = 3,
    SKIP = 4,
    IDR = 5,
    I_NREF = 6,
    P_NREF = 7,
    B_NREF = 8,
    REF = 9,
}

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct mfxFrameInfo {
    pub FrameId: mfxU32,
    pub FourCC: mfxU32,
    pub Width: mfxU16,
    pub Height: mfxU16,
    pub CropX: mfxU16,
    pub CropY: mfxU16,
    pub CropW: mfxU16,
    pub CropH: mfxU16,
    pub FrameRateExtN: mfxU32,
    pub FrameRateExtD: mfxU32,
    pub FrameStruct: mfxU16,
    pub ChromaFormat: mfxU16,
    pub PicStruct: mfxU16,
    pub BitDepthLuma: mfxU16,
    pub BitDepthChroma: mfxU16,
    pub Shifting: mfxU16,
    pub Reserved: [mfxU16; 5],
}

impl Default for mfxFrameInfo {
    fn default() -> Self {
        Self {
            FrameId: 0,
            FourCC: MFX_FOURCC::NV12 as mfxU32,
            Width: 0,
            Height: 0,
            CropX: 0,
            CropY: 0,
            CropW: 0,
            CropH: 0,
            FrameRateExtN: 30,
            FrameRateExtD: 1,
            FrameStruct: 0,
            ChromaFormat: 1,
            PicStruct: 0,
            BitDepthLuma: 8,
            BitDepthChroma: 8,
            Shifting: 0,
            Reserved: [0; 5],
        }
    }
}

// ============================================
// Frame Data
// ============================================

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct mfxFrameData {
    pub Pitch: mfxU32,
    pub Y: mfxU64,
    pub YHigh: mfxU32,
    pub UV: mfxU64,
    pub UVHigh: mfxU32,
    pub V: mfxU64,
    pub VHigh: mfxU32,
    pub A: mfxU64,
    pub AHigh: mfxU32,
    pub MemType: mfxU16,
    pub Reserved: [mfxU16; 3],
}

impl Default for mfxFrameData {
    fn default() -> Self {
        Self {
            Pitch: 0,
            Y: 0,
            YHigh: 0,
            UV: 0,
            UVHigh: 0,
            V: 0,
            VHigh: 0,
            A: 0,
            AHigh: 0,
            MemType: 0,
            Reserved: [0; 3],
        }
    }
}

// ============================================
// Surface
// ============================================

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct mfxFrameSurface1 {
    pub Info: mfxFrameInfo,
    pub Data: mfxFrameData,
}

// ============================================
// Bitstream
// ============================================

#[repr(C)]
#[derive(Debug, Default, Copy, Clone)]
pub struct mfxExtBuffer {
    pub BufferId: mfxU32,
    pub BufferSz: mfxU32,
    pub NumExtParam: mfxU32,
}

pub const MFX_EXTBUFF_VIDEO_SIGNAL_INFO: mfxU32 = 0x00000006;

#[repr(C)]
#[derive(Debug, Default, Copy, Clone)]
pub struct mfxExtVideoSignalInfo {
    pub Header: mfxExtBuffer,
    pub TransferMatrix: mfxU16,
    pub ColourPrimaries: mfxU16,
    pub ColourDescriptionPresent: mfxU16,
    pub VideoFormat: mfxU16,
    pub VideoFullRange: mfxU16,
    pub reserved: [mfxU16; 4],
}

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct mfxBitstream {
    pub EncryptedData: mfxU64,
    pub DecodeTimeStamp: mfxU64,
    pub TimeStamp: mfxU64,
    pub FrameType: mfxU32,
    pub PicStruct: mfxU16,
    pub FrameOrder: mfxU16,
    pub Data: mfxU64,
    pub DataLength: mfxU32,
    pub DataOffset: mfxU32,
    pub DataFlag: mfxU16,
    pub Reserved: [mfxU16; 5],
    pub NumExtParam: mfxU16,
    pub ExtParam: *mut *mut mfxExtBuffer,
}

impl Default for mfxBitstream {
    fn default() -> Self {
        Self {
            EncryptedData: 0,
            DecodeTimeStamp: 0,
            TimeStamp: 0,
            FrameType: MFX_FRAME_TYPE::UNKNOWN as mfxU32,
            PicStruct: 0,
            FrameOrder: 0,
            Data: 0,
            DataLength: 0,
            DataOffset: 0,
            DataFlag: 0,
            Reserved: [0; 5],
            NumExtParam: 0,
            ExtParam: ptr::null_mut(),
        }
    }
}

// ============================================
// Encoder Parameters
// ============================================

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct mfxInfoMFX {
    pub Reserved: [mfxU32; 4],
}

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct mfxEncodeCtrl {
    pub Header: mfxExtBuffer,
    pub QP: mfxU16,
    pub FrameType: mfxU16,
    pub reserved: [mfxU16; 10],
    pub Payload: *mut mfxPayload,
    pub NumPayload: mfxU32,
    pub ExtPayload: *mut *mut mfxPayload,
    pub NumExtPayload: mfxU32,
}

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct mfxPayload {
    pub Ctrl: mfxU64,
    pub CtrlData: mfxU64,
    pub NumBit: mfxU32,
    reserved: [mfxU32; 3],
}

#[repr(C)]
#[derive(Debug, Default, Copy, Clone)]
pub struct mfxExtCodingOption {
    pub Header: mfxExtBuffer,
    pub reserved: [mfxU32; 3],
}

// ============================================
// Video Params
// ============================================

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct mfxVideoParam {
    pub mfx: mfxInfoMFX,
    pub AsyncDepth: mfxU16,
    pub IOPattern: mfxU32,
    pub Protected: mfxU16,
    pub Reserved: [mfxU16; 1],
    pub Reserved2: [mfxU32; 3],
    pub ExtParam: *mut *mut mfxExtBuffer,
    pub NumExtParam: mfxU32,
}

// ============================================
// IMPL Types
// ============================================

pub type mfxIMPL = mfxU32;
pub const MFX_IMPL_AUTO: mfxIMPL = 0x0000;
pub const MFX_IMPL_SOFTWARE: mfxIMPL = 0x0001;
pub const MFX_IMPL_HARDWARE: mfxIMPL = 0x0002;
pub const MFX_IMPL_HARDWARE2: mfxIMPL = 0x0003;
pub const MFX_IMPL_HARDWARE3: mfxIMPL = 0x0004;
pub const MFX_IMPL_HARDWARE4: mfxIMPL = 0x0005;
pub const MFX_IMPL_RUNTIME: mfxIMPL = 0x0100;

// ============================================
// Function Pointers
// ============================================

pub type MFXVideoENCODE_Query_fn = unsafe extern "C" fn(
    session: *mut (),
    par_in: *const mfxVideoParam,
    par_out: *mut mfxVideoParam,
) -> mfxStatus;

pub type MFXVideoENCODE_QueryIOSurf_fn = unsafe extern "C" fn(
    session: *mut (),
    request: *const mfxVideoParam,
    allocator: *const (),
) -> mfxStatus;

pub type MFXVideoENCODE_Init_fn =
    unsafe extern "C" fn(session: *mut (), par: *const mfxVideoParam) -> mfxStatus;

pub type MFXVideoENCODE_Close_fn = unsafe extern "C" fn(session: *mut ()) -> mfxStatus;

pub type MFXVideoENCODE_GetVideoParam_fn =
    unsafe extern "C" fn(session: *mut (), par: *mut mfxVideoParam) -> mfxStatus;

pub type MFXVideoENCODE_EncodeFrameAsync_fn = unsafe extern "C" fn(
    session: *mut (),
    ctrl: *const mfxEncodeCtrl,
    surface: *const mfxFrameSurface1,
    bs: *mut mfxBitstream,
    syncp: *mut *mut (),
) -> mfxStatus;

pub type MFXVideoENCODE_GetPayload_fn =
    unsafe extern "C" fn(session: *mut (), ctrl: mfxU64, payload: *mut mfxPayload) -> mfxStatus;

// ============================================
// Session Functions
// ============================================

pub type MFXInitialize_fn = unsafe extern "C" fn(
    impl_: mfxIMPL,
    pVer: *const mfxVersion,
    pAccelerationMode: *const (),
    pSession: *mut *mut (),
) -> mfxStatus;

pub type MFXClose_fn = unsafe extern "C" fn(session: *mut ()) -> mfxStatus;

pub type MFXJoinSession_fn =
    unsafe extern "C" fn(session: mfxU64, child_session: *mut ()) -> mfxStatus;

pub type MFXDisjoinSession_fn = unsafe extern "C" fn(session: *mut ()) -> mfxStatus;

pub type MFXGetIMPL_fn = unsafe extern "C" fn(session: *mut (), impl_: *mut mfxIMPL) -> mfxStatus;

pub type MFXQueryIMPL_fn =
    unsafe extern "C" fn(impl_: mfxIMPL, impl_desc: *mut (), ver: *mut mfxVersion) -> mfxStatus;

pub type MFXInitEx_fn = unsafe extern "C" fn(
    impl_: mfxIMPL,
    pVer: *const mfxVersion,
    pAccelerationMode: *const (),
    pSession: *mut *mut (),
    pExtParams: *mut *mut (),
) -> mfxStatus;

// ============================================
// Version
// ============================================

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct mfxVersion {
    pub Major: mfxU16,
    pub Minor: mfxU16,
}

impl Default for mfxVersion {
    fn default() -> Self {
        Self { Major: 1, Minor: 0 }
    }
}

// ============================================
// Synchronization
// ============================================

pub type MFXVideoCORE_SyncOperation_fn =
    unsafe extern "C" fn(session: *mut (), syncp: *const (), wait: mfxU32) -> mfxStatus;

pub type MFXDoWork_fn = unsafe extern "C" fn(session: *mut ()) -> mfxStatus;

// ============================================
// Video VPP Functions (Video Processing Pipeline)
// ============================================

pub type MFXVideoVPP_Query_fn = unsafe extern "C" fn(
    session: *mut (),
    par_in: *const mfxVideoParam,
    par_out: *mut mfxVideoParam,
) -> mfxStatus;

pub type MFXVideoVPP_Init_fn =
    unsafe extern "C" fn(session: *mut (), par: *const mfxVideoParam) -> mfxStatus;

pub type MFXVideoVPP_Close_fn = unsafe extern "C" fn(session: *mut ()) -> mfxStatus;

pub type MFXVideoVPP_RunFrameVPPAsync_fn = unsafe extern "C" fn(
    session: *mut (),
    surface: *const mfxFrameSurface1,
    surface_out: *mut mfxFrameSurface1,
    bs: *mut mfxBitstream,
    syncp: *mut *mut (),
) -> mfxStatus;

// ============================================
// Allocator Interface
// ============================================

pub type mfxFrameAllocRequest = mfxFrameInfo;
pub type mfxFrameAllocResponse = mfxFrameInfo;

pub type mfxFrameAllocator_Free_fn = unsafe extern "C" fn(
    pthis: *mut (),
    request: *const mfxFrameAllocRequest,
    response: *mut mfxFrameAllocResponse,
) -> mfxStatus;

pub type mfxFrameAllocator_Alloc_fn = unsafe extern "C" fn(
    pthis: *mut (),
    request: *mut mfxFrameAllocRequest,
    response: *mut mfxFrameAllocResponse,
) -> mfxStatus;

pub type mfxFrameAllocator_Lock_fn = unsafe extern "C" fn(
    pthis: *mut (),
    mid: mfxU32,
    request: *mut mfxFrameAllocRequest,
    response: *mut mfxFrameAllocResponse,
) -> mfxStatus;

pub type mfxFrameAllocator_GetHDL_fn =
    unsafe extern "C" fn(pthis: *mut (), mid: mfxU32, hdl: *mut *mut ()) -> mfxStatus;

pub type mfxFrameAllocator_Unlock_fn = unsafe extern "C" fn(
    pthis: *mut (),
    mid: mfxU32,
    response: *mut mfxFrameAllocResponse,
    hdl: *mut *mut (),
) -> mfxStatus;

#[repr(C)]
pub struct mfxFrameAllocator {
    pub pthis: *mut (),
    pub Alloc: Option<mfxFrameAllocator_Alloc_fn>,
    pub Lock: Option<mfxFrameAllocator_Lock_fn>,
    pub Unlock: Option<mfxFrameAllocator_Unlock_fn>,
    pub GetHDL: Option<mfxFrameAllocator_GetHDL_fn>,
    pub Free: Option<mfxFrameAllocator_Free_fn>,
}
