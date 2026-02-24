//! Screen and audio capture modules
//! - DXGI Desktop Duplication for video
//! - WASAPI loopback for audio

#[cfg(target_os = "windows")]
pub mod dxgi;
pub mod frame;
#[cfg(target_os = "windows")]
pub mod audio;

#[cfg(not(target_os = "windows"))]
pub mod mac;
