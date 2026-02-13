//! Software encoder fallback
//!
//! Uses x264 or similar for encoding when hardware encoders aren't available.
//! For MVP, we can output raw frames and let the WebRTC stack handle encoding.

use anyhow::Result;

/// Simple software encoder using raw frame output
///
/// This is a fallback when no hardware encoder is available.
/// In production, you'd want to integrate x264 or use FFmpeg.
pub struct SoftwareEncoder {
    frame_number: u32,
    width: u32,
    height: u32,
}

impl SoftwareEncoder {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            frame_number: 0,
            width,
            height,
        }
    }

    /// Encode a frame (placeholder - returns raw JPEG for testing)
    pub fn encode(&mut self, bgra_data: &[u8]) -> Result<Vec<u8>> {
        self.frame_number += 1;

        // For MVP: Return raw data compressed with simple RLE or just the raw bytes
        // In production: Use x264, openh264, or FFmpeg libx264 bindings

        // For now, just return a simple header + truncated data for testing
        let mut output = Vec::new();

        // Simple frame header
        output.extend_from_slice(&self.frame_number.to_le_bytes());
        output.extend_from_slice(&self.width.to_le_bytes());
        output.extend_from_slice(&self.height.to_le_bytes());

        // First 1KB of pixel data (for testing connectivity)
        let sample_size = std::cmp::min(1024, bgra_data.len());
        output.extend_from_slice(&bgra_data[..sample_size]);

        Ok(output)
    }
}
