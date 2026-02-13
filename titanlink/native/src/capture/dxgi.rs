//! DXGI Desktop Duplication API for ultra-low latency screen capture
//!
//! This module provides screen capture using Windows DXGI Desktop Duplication API,
//! which is the fastest method available on Windows (1-2ms latency).

use crate::DisplayInfo;
use anyhow::{anyhow, Context, Result};
use std::ptr;
use windows::{
    core::Interface,
    Win32::Graphics::{
        Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_UNKNOWN},
        Direct3D11::{
            D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
            D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ,
            D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
        },
        Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC},
        Dxgi::{
            CreateDXGIFactory1, IDXGIAdapter, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput,
            IDXGIOutput1, IDXGIOutputDuplication, IDXGISurface1, DXGI_ERROR_ACCESS_LOST,
            DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO,
        },
    },
};

/// Enumerate all displays available for capture
pub fn enumerate_displays() -> Result<Vec<DisplayInfo>> {
    let mut displays = Vec::new();

    unsafe {
        // Create DXGI factory
        let factory: IDXGIFactory1 = CreateDXGIFactory1()?;

        // Enumerate adapters (GPUs)
        let mut adapter_index = 0;
        while let Ok(adapter) = factory.EnumAdapters1(adapter_index) {
            // Enumerate outputs (monitors) for this adapter
            let mut output_index = 0;
            while let Ok(output) = adapter.EnumOutputs(output_index) {
                let desc = output.GetDesc()?;

                // Convert device name from wide string
                let name = String::from_utf16_lossy(
                    &desc.DeviceName[..desc
                        .DeviceName
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(desc.DeviceName.len())],
                );

                let width = (desc.DesktopCoordinates.right - desc.DesktopCoordinates.left) as u32;
                let height = (desc.DesktopCoordinates.bottom - desc.DesktopCoordinates.top) as u32;

                displays.push(DisplayInfo {
                    index: displays.len() as u32,
                    name: name.trim_end_matches('\0').to_string(),
                    width,
                    height,
                    is_primary: desc.DesktopCoordinates.left == 0
                        && desc.DesktopCoordinates.top == 0,
                });

                output_index += 1;
            }
            adapter_index += 1;
        }
    }

    if displays.is_empty() {
        return Err(anyhow!("No displays found"));
    }

    Ok(displays)
}

/// DXGI Desktop Duplication capturer
pub struct DxgiCapturer {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    duplication: IDXGIOutputDuplication,
    staging_texture: ID3D11Texture2D,
    width: u32,
    height: u32,
    frame_acquired: bool,
}

impl DxgiCapturer {
    /// Create a new DXGI capturer for the specified display
    pub fn new(display_index: u32) -> Result<Self> {
        unsafe {
            // Create DXGI factory
            let factory: IDXGIFactory1 =
                CreateDXGIFactory1().context("Failed to create DXGI factory")?;

            // Find the output (monitor) by index
            let (adapter, output) =
                Self::find_output(&factory, display_index).context("Failed to find display")?;

            // Get output description for dimensions
            let output_desc = output.GetDesc()?;

            // Log adapter description for debugging
            let adapter_desc = adapter.GetDesc1()?;
            let adapter_name = String::from_utf16_lossy(&adapter_desc.Description)
                .trim_end_matches('\0')
                .to_string();
            println!("[DXGI] Initializing capture on adapter: {}", adapter_name);

            let width =
                (output_desc.DesktopCoordinates.right - output_desc.DesktopCoordinates.left) as u32;
            let height =
                (output_desc.DesktopCoordinates.bottom - output_desc.DesktopCoordinates.top) as u32;

            // Create D3D11 device
            let mut device = None;
            let mut context = None;

            let adapter_cast = adapter
                .cast::<windows::Win32::Graphics::Dxgi::IDXGIAdapter>()
                .context("Failed to cast adapter")?;

            D3D11CreateDevice(
                Some(&adapter_cast),
                D3D_DRIVER_TYPE_UNKNOWN,
                None,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
            .context("Failed to create D3D11 device")?;

            let device = device.ok_or_else(|| anyhow!("Failed to create D3D11 device"))?;
            let context = context.ok_or_else(|| anyhow!("Failed to create D3D11 context"))?;

            // Get IDXGIOutput1 for duplication
            let output1: IDXGIOutput1 = output.cast().context("Failed to cast to IDXGIOutput1")?;

            // Create output duplication with retry mechanism
            // DuplicateOutput can fail transiently due to mode changes, secure desktop, etc.
            let mut duplication = None;
            let mut last_error = None;

            for attempt in 1..=3 {
                match output1.DuplicateOutput(&device) {
                    Ok(dup) => {
                        duplication = Some(dup);
                        break;
                    }
                    Err(e) => {
                        println!("[DXGI] DuplicateOutput attempt {} failed: {:?}", attempt, e);
                        // specific error handling if needed
                        if attempt < 3 {
                            std::thread::sleep(std::time::Duration::from_millis(100));
                        }
                        last_error = Some(e);
                    }
                }
            }

            /// Find the output (monitor) by index
            /// Prefers NVIDIA GPUs for NVENC compatibility
            unsafe fn find_output(
                factory: &IDXGIFactory1,
                target_index: u32,
            ) -> Result<(IDXGIAdapter1, IDXGIOutput)> {
                const NVIDIA_VENDOR_ID: u32 = 0x10DE;

                let mut current_index = 0u32;
                let mut adapter_index = 0;

                // First pass: Try to find the display on an NVIDIA GPU
                while let Ok(adapter) = factory.EnumAdapters1(adapter_index) {
                    let desc = adapter.GetDesc1();
                    if let Ok(d) = desc {
                        if d.VendorId == NVIDIA_VENDOR_ID {
                            let mut output_index = 0;
                            while let Ok(output) = adapter.EnumOutputs(output_index) {
                                if current_index == target_index {
                                    return Ok((adapter, output));
                                }
                                current_index += 1;
                                output_index += 1;
                            }
                        }
                    }
                    adapter_index += 1;
                }

                // Second pass: If not found on NVIDIA GPU, try any adapter
                current_index = 0;
                adapter_index = 0;
                while let Ok(adapter) = factory.EnumAdapters1(adapter_index) {
                    let mut output_index = 0;
                    while let Ok(output) = adapter.EnumOutputs(output_index) {
                        if current_index == target_index {
                            return Ok((adapter, output));
                        }
                        current_index += 1;
                        output_index += 1;
                    }
                    adapter_index += 1;
                }

                Err(anyhow!("Display index {} not found", target_index))
            }

            let duplication = duplication.ok_or_else(|| {
                let e = last_error.unwrap();
                anyhow!(
                    "Failed to create output duplication after 3 attempts. Error: {:?}",
                    e
                )
            })?;

            // Create staging texture for CPU read (only used if we need software encoding)
            let staging_desc = D3D11_TEXTURE2D_DESC {
                Width: width,
                Height: height,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Usage: D3D11_USAGE_STAGING,
                BindFlags: Default::default(),
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                MiscFlags: Default::default(),
            };

            let mut staging_texture = None;
            device.CreateTexture2D(&staging_desc, None, Some(&mut staging_texture))?;
            let staging_texture =
                staging_texture.ok_or_else(|| anyhow!("Failed to create staging texture"))?;

            Ok(Self {
                device,
                context,
                duplication,
                staging_texture,
                width,
                height,
                frame_acquired: false,
            })
        }
    }

    /// Find adapter and output by display index
    unsafe fn find_output(
        factory: &IDXGIFactory1,
        target_index: u32,
    ) -> Result<(IDXGIAdapter1, IDXGIOutput)> {
        let mut current_index = 0u32;
        let mut adapter_index = 0;

        while let Ok(adapter) = factory.EnumAdapters1(adapter_index) {
            let mut output_index = 0;
            while let Ok(output) = adapter.EnumOutputs(output_index) {
                if current_index == target_index {
                    return Ok((adapter, output));
                }
                current_index += 1;
                output_index += 1;
            }
            adapter_index += 1;
        }

        Err(anyhow!("Display index {} not found", target_index))
    }

    /// Get the D3D11 device (for zero-copy NVENC integration)
    pub fn device(&self) -> &ID3D11Device {
        &self.device
    }

    /// Get the device context
    pub fn context(&self) -> &ID3D11DeviceContext {
        &self.context
    }

    /// Get capture dimensions
    pub fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    /// Capture and return the GPU texture directly (zero-copy for NVENC)
    /// Returns the texture and whether it's a new frame
    pub fn capture_frame_gpu(&mut self, timeout_ms: u32) -> Result<Option<ID3D11Texture2D>> {
        unsafe {
            // Release previous frame if any
            if self.frame_acquired {
                self.duplication.ReleaseFrame().ok();
                self.frame_acquired = false;
            }

            // Try to acquire next frame
            let mut frame_info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut resource = None;

            let result =
                self.duplication
                    .AcquireNextFrame(timeout_ms, &mut frame_info, &mut resource);

            match result {
                Ok(()) => {
                    self.frame_acquired = true;

                    // Check if this is actually a new frame
                    if frame_info.LastPresentTime == 0 {
                        // No new frame, release and return None
                        self.duplication.ReleaseFrame().ok();
                        self.frame_acquired = false;
                        return Ok(None);
                    }

                    // Get the texture from resource
                    let resource = resource.ok_or_else(|| anyhow!("No resource returned"))?;
                    let texture: ID3D11Texture2D = resource.cast()?;

                    Ok(Some(texture))
                }
                Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => {
                    // No new frame within timeout
                    Ok(None)
                }
                Err(e) if e.code() == DXGI_ERROR_ACCESS_LOST => {
                    // Display mode changed, need to recreate duplication
                    Err(anyhow!("Access lost - display mode changed"))
                }
                Err(e) => Err(anyhow!("AcquireNextFrame failed: {:?}", e)),
            }
        }
    }

    /// Capture a frame and copy to CPU memory (for software encoding or debugging)
    /// Returns BGRA pixel data
    pub fn capture_frame_cpu(&mut self, timeout_ms: u32) -> Result<Option<Vec<u8>>> {
        unsafe {
            // Get GPU texture
            let texture = match self.capture_frame_gpu(timeout_ms)? {
                Some(t) => t,
                None => return Ok(None),
            };

            // Copy to staging texture
            self.context.CopyResource(&self.staging_texture, &texture);

            // Map staging texture to read pixels
            let mut mapped = Default::default();
            self.context.Map(
                &self.staging_texture,
                0,
                D3D11_MAP_READ,
                0,
                Some(&mut mapped),
            )?;

            // Copy pixel data
            let row_pitch = mapped.RowPitch as usize;
            let mut pixels = Vec::with_capacity((self.width * self.height * 4) as usize);

            for y in 0..self.height {
                let src = (mapped.pData as *const u8).add(y as usize * row_pitch);
                let row = std::slice::from_raw_parts(src, (self.width * 4) as usize);
                pixels.extend_from_slice(row);
            }

            // Unmap
            self.context.Unmap(&self.staging_texture, 0);

            Ok(Some(pixels))
        }
    }

    /// Release the current frame (call when done processing)
    pub fn release_frame(&mut self) -> Result<()> {
        if self.frame_acquired {
            unsafe {
                self.duplication.ReleaseFrame()?;
            }
            self.frame_acquired = false;
        }
        Ok(())
    }
}

impl Drop for DxgiCapturer {
    fn drop(&mut self) {
        // Release any held frame
        self.release_frame().ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_enumerate_displays() {
        let displays = enumerate_displays();
        println!("Displays: {:?}", displays);
        // This test may fail in headless environments
    }
}
