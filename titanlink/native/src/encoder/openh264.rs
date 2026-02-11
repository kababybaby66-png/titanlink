//! OpenH264 software encoder
//! 
//! Using Cisco's OpenH264 library via openh264-rs crate.
//! Provides H.264 encoding when hardware acceleration fails.

use anyhow::{Result, anyhow};
use openh264::encoder::{Encoder, EncoderConfig};
use openh264::formats::YUVSource;

pub struct OpenH264Encoder {
    encoder: Encoder,
    width: usize,
    height: usize,
    frame_count: u64,
}

impl OpenH264Encoder {
    pub fn new(width: u32, height: u32, bitrate: u32) -> Result<Self> {
        // Create configuration
        // OpenH264 might need the DLL in the working directory
        let config = EncoderConfig::new(width, height)
            .enable_skip_frame(true)
            .bitrate(bitrate);

        let encoder = Encoder::with_config(config)?;
        
        Ok(Self {
            encoder,
            width: width as usize,
            height: height as usize,
            frame_count: 0,
        })
    }

    pub fn encode(&mut self, bgra_data: &[u8], force_keyframe: bool) -> Result<Vec<u8>> {
        // Force IDR frame if requested
        if force_keyframe {
            let _ = self.encoder.force_intra_frame();
        }

        // Convert BGRA to YUV420P (I420)
        let yuv_data = bgra_to_yuv420(bgra_data, self.width, self.height);
        
        // Wrap data separately for Y, U, and V planes for YUVSource
        let src = YUVSource::new(self.width as i32, self.height as i32, &yuv_data);
        
        // Encode
        let stream = self.encoder.encode(&src)?;
        
        self.frame_count += 1;
        
        // Convert Layer(s) to single Bitstream Vec
        Ok(stream.to_vec())
    }
}

/// Convert BGRA (32-bit) to YUV420P (I420)
/// 
/// This is CPU intensive. Optimized for scalar execution.
#[inline(never)]
fn bgra_to_yuv420(bgra: &[u8], width: usize, height: usize) -> Vec<u8> {
    let y_size = width * height;
    let uv_size = y_size / 4;
    let total_size = y_size + 2 * uv_size;
    
    let mut yuv = vec![0u8; total_size];
    let (y_plane, uv_plane) = yuv.split_at_mut(y_size);
    let (u_plane, v_plane) = uv_plane.split_at_mut(uv_size);
    
    // Process 2x2 blocks for efficiency
    for y in (0..height).step_by(2) {
        for x in (0..width).step_by(2) {
            // Calculate indices
            let idx00 = (y * width + x) * 4;
            let idx01 = (y * width + x + 1) * 4;
            let idx10 = ((y + 1) * width + x) * 4;
            let idx11 = ((y + 1) * width + x + 1) * 4;
            
            // Process 4 pixels for Y
            // Pixel 0,0
            let b00 = bgra[idx00] as i32; let g00 = bgra[idx00+1] as i32; let r00 = bgra[idx00+2] as i32;
            y_plane[y * width + x] = rgb_to_y(r00, g00, b00);
            
            // Pixel 0,1
            let b01 = bgra[idx01] as i32; let g01 = bgra[idx01+1] as i32; let r01 = bgra[idx01+2] as i32;
            y_plane[y * width + x + 1] = rgb_to_y(r01, g01, b01);
            
            if y + 1 < height {
                // Pixel 1,0
                let b10 = bgra[idx10] as i32; let g10 = bgra[idx10+1] as i32; let r10 = bgra[idx10+2] as i32;
                y_plane[(y + 1) * width + x] = rgb_to_y(r10, g10, b10);
                
                // Pixel 1,1
                let b11 = bgra[idx11] as i32; let g11 = bgra[idx11+1] as i32; let r11 = bgra[idx11+2] as i32;
                y_plane[(y + 1) * width + x + 1] = rgb_to_y(r11, g11, b11);
            }
            
            // Calculate U and V from average of 2x2 block (subsampling)
            // Using top-left pixel for speed (simple subsampling) or average?
            // Simple subsampling (using 0,0 pixel) is faster but lower quality.
            // Let's use average of the 4 pixels (approx) or just 0,0 for now to be fast.
            // Using 0,0:
            let u = rgb_to_u(r00, g00, b00);
            let v = rgb_to_v(r00, g00, b00);
            
            let uv_x = x / 2;
            let uv_y = y / 2;
            let uv_idx = uv_y * (width / 2) + uv_x;
            
            if uv_idx < u_plane.len() {
                u_plane[uv_idx] = u;
                v_plane[uv_idx] = v;
            }
        }
    }
    
    yuv
}

#[inline(always)]
fn rgb_to_y(r: i32, g: i32, b: i32) -> u8 {
    (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16).clamp(0, 255) as u8
}

#[inline(always)]
fn rgb_to_u(r: i32, g: i32, b: i32) -> u8 {
    (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128).clamp(0, 255) as u8
}

#[inline(always)]
fn rgb_to_v(r: i32, g: i32, b: i32) -> u8 {
    (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128).clamp(0, 255) as u8
}
