//! Frame buffer management for captured frames

use std::time::{Duration, Instant};

/// Raw frame data captured from screen
pub struct CapturedFrame {
    /// Frame number (sequential)
    pub frame_number: u32,
    /// Capture timestamp
    pub timestamp: Instant,
    /// Width in pixels
    pub width: u32,
    /// Height in pixels
    pub height: u32,
    /// Pixel format (BGRA)
    pub format: PixelFormat,
    /// Raw pixel data (only for CPU path)
    pub data: Option<Vec<u8>>,
}

/// Pixel format for captured frames
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PixelFormat {
    /// 32-bit BGRA (DXGI default)
    BGRA8,
    /// 32-bit RGBA
    RGBA8,
    /// NV12 (for NVENC input)
    NV12,
}

impl CapturedFrame {
    /// Create a new frame with CPU data
    pub fn new_cpu(frame_number: u32, width: u32, height: u32, data: Vec<u8>) -> Self {
        Self {
            frame_number,
            timestamp: Instant::now(),
            width,
            height,
            format: PixelFormat::BGRA8,
            data: Some(data),
        }
    }

    /// Create a new frame without CPU data (GPU-only path)
    pub fn new_gpu(frame_number: u32, width: u32, height: u32) -> Self {
        Self {
            frame_number,
            timestamp: Instant::now(),
            width,
            height,
            format: PixelFormat::BGRA8,
            data: None,
        }
    }

    /// Get the age of this frame (time since capture)
    pub fn age(&self) -> Duration {
        self.timestamp.elapsed()
    }

    /// Get the size in bytes
    pub fn byte_size(&self) -> usize {
        self.data.as_ref().map(|d| d.len()).unwrap_or(0)
    }
}

/// Ring buffer for frame queue
pub struct FrameQueue {
    frames: Vec<Option<CapturedFrame>>,
    write_index: usize,
    read_index: usize,
    capacity: usize,
}

impl FrameQueue {
    /// Create a new frame queue with given capacity
    pub fn new(capacity: usize) -> Self {
        let mut frames = Vec::with_capacity(capacity);
        frames.resize_with(capacity, || None);

        Self {
            frames,
            write_index: 0,
            read_index: 0,
            capacity,
        }
    }

    /// Push a frame to the queue (overwrites oldest if full)
    pub fn push(&mut self, frame: CapturedFrame) {
        self.frames[self.write_index] = Some(frame);
        self.write_index = (self.write_index + 1) % self.capacity;

        // If we've caught up to read, advance read (drop oldest)
        if self.write_index == self.read_index {
            self.read_index = (self.read_index + 1) % self.capacity;
        }
    }

    /// Pop the oldest frame from the queue
    pub fn pop(&mut self) -> Option<CapturedFrame> {
        if self.read_index == self.write_index {
            // Queue is empty
            return None;
        }

        let frame = self.frames[self.read_index].take();
        self.read_index = (self.read_index + 1) % self.capacity;
        frame
    }

    /// Check if queue is empty
    pub fn is_empty(&self) -> bool {
        self.read_index == self.write_index
    }

    /// Get number of frames in queue
    pub fn len(&self) -> usize {
        if self.write_index >= self.read_index {
            self.write_index - self.read_index
        } else {
            self.capacity - self.read_index + self.write_index
        }
    }
}
