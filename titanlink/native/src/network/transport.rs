use super::packet::*;
/// UDP Socket wrapper for TitanLink protocol
/// Handles low-level UDP send/receive with minimal overhead
use super::protocol::*;
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// UDP Transport for TitanLink packets
pub struct UdpTransport {
    pub(crate) socket: UdpSocket,
    pub(crate) remote_addr: SocketAddr,
    session_id: u64,
    packet_builder: PacketBuilder,
    running: Arc<AtomicBool>,
}

impl UdpTransport {
    /// Create new UDP transport
    pub fn new(bind_addr: &str, remote_addr: SocketAddr, session_id: u64) -> std::io::Result<Self> {
        let socket = UdpSocket::bind(bind_addr)?;

        // Set socket to non-blocking mode for async operations
        socket.set_nonblocking(true)?;

        // Increase socket buffer size to 4MB to handle 4K/high-bitrate bursts
        // This is critical to avoid "os error 10035" (WSAEWOULDBLOCK)
        let _ = set_socket_buffer_size(&socket, 4 * 1024 * 1024);

        Ok(Self {
            socket,
            remote_addr,
            session_id,
            packet_builder: PacketBuilder::new(session_id),
            running: Arc::new(AtomicBool::new(true)),
        })
    }

    // ... existing video methods ...

    /// Send raw packet (exposed for reliable channel)
    pub(crate) fn send_packet(&self, packet: &Packet) -> std::io::Result<usize> {
        let bytes = packet.to_bytes();
        let mut retries = 0;
        
        loop {
            match self.socket.send_to(&bytes, self.remote_addr) {
                Ok(n) => return Ok(n),
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if retries >= 3 {
                        // Buffer truly full after retries, drop packet
                        // This prevents blocking the capture thread too long
                        return Ok(0);
                    }
                    
                    // Small backoff to let buffer drain
                    std::thread::sleep(Duration::from_millis(1));
                    retries += 1;
                    continue;
                }
                Err(e) => return Err(e),
            }
        }
    }

    /// Send video frame (fire-and-forget, no ACK required)
    /// Returns immediately, does NOT wait for delivery
    pub fn send_video_frame(
        &mut self,
        frame_number: u32,
        codec: u8,
        is_keyframe: bool,
        frame_data: &[u8],
    ) -> std::io::Result<usize> {
        // Check if frame needs fragmentation (> 1376 bytes payload)
        if frame_data.len() <= MAX_PAYLOAD_SIZE - VideoFrameHeader::SIZE {
            // Single packet
            let packet = self.packet_builder.video_frame(
                frame_number,
                codec,
                is_keyframe,
                frame_data.to_vec(),
            );

            self.send_packet(&packet)
        } else {
            // Fragment into multiple packets
            self.send_fragmented_video(frame_number, codec, is_keyframe, frame_data)
        }
    }

    /// Send fragmented video frame (for large frames)
    fn send_fragmented_video(
        &mut self,
        frame_number: u32,
        codec: u8,
        is_keyframe: bool,
        frame_data: &[u8],
    ) -> std::io::Result<usize> {
        let fragment_size = MAX_PAYLOAD_SIZE - VideoFrameHeader::SIZE;
        let total_fragments = (frame_data.len() + fragment_size - 1) / fragment_size;
        let mut total_sent = 0;

        for (i, chunk) in frame_data.chunks(fragment_size).enumerate() {
            let mut payload = Vec::with_capacity(VideoFrameHeader::SIZE + chunk.len());

            // Video frame header
            payload.extend_from_slice(&frame_number.to_be_bytes());
            payload.push(if is_keyframe {
                VideoFrameHeader::FLAG_KEYFRAME
            } else {
                0
            });
            payload.push(codec);
            payload.push(total_fragments as u8);
            payload.push(i as u8);

            // Fragment data
            payload.extend_from_slice(chunk);

            let packet = Packet::new(
                self.session_id,
                PacketType::VideoFragment,
                self.packet_builder.next_sequence(),
                payload,
            );

            total_sent += self.send_packet(&packet)?;
        }

        Ok(total_sent)
    }

    /// Check if running
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
    /// Send controller input (will be handled by reliable channel in Task 2.3)
    pub fn send_controller_input(&mut self, input: ControllerInputData) -> std::io::Result<usize> {
        let packet = self.packet_builder.controller_input(input);
        self.send_packet(&packet)
    }

    /// Send handshake
    pub fn send_handshake(&mut self) -> std::io::Result<usize> {
        let packet = self.packet_builder.handshake();
        self.send_packet(&packet)
    }

    /// Send keep-alive
    pub fn send_keep_alive(&mut self) -> std::io::Result<usize> {
        let packet = self.packet_builder.keep_alive();
        self.send_packet(&packet)
    }

    /// Receive packet (non-blocking)
    pub fn recv_packet(&self) -> std::io::Result<Option<Packet>> {
        let mut buf = [0u8; MAX_PACKET_SIZE];

        match self.socket.recv_from(&mut buf) {
            Ok((size, _addr)) => {
                if let Some(packet) = Packet::from_bytes(&buf[..size]) {
                    Ok(Some(packet))
                } else {
                    Ok(None)
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Stop the transport
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

// Helper to set socket buffer size cross-platform
fn set_socket_buffer_size(socket: &UdpSocket, size: usize) -> std::io::Result<()> {
    // Windows requires setsockoptSO_SNDBUF
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawSocket;
        use windows::Win32::Networking::WinSock::{setsockopt, SOCKET, SO_RCVBUF, SO_SNDBUF, SOL_SOCKET};
        
        // SOCKET is a wrapper struct in windows crate 0.48+
        let raw_socket = SOCKET(socket.as_raw_socket() as usize);
        let size_i32 = size as i32;
        let size_ptr = &size_i32 as *const i32 as *const _;
        
        unsafe {
            // Set Send Buffer
            if setsockopt(raw_socket, SOL_SOCKET, SO_SNDBUF, Some(std::slice::from_raw_parts(size_ptr as *const u8, 4))) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            
            // Set Receive Buffer (for client side or ACKs)
            if setsockopt(raw_socket, SOL_SOCKET, SO_RCVBUF, Some(std::slice::from_raw_parts(size_ptr as *const u8, 4))) != 0 {
                 return Err(std::io::Error::last_os_error());
            }
        }
    }

    #[cfg(unix)]
    {
        // socket2 crate would be cleaner, but using libc/std is fine
        // for now just skip explicit size on unix or trust default
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::SocketAddr;

    #[test]
    fn test_transport_creation() {
        let remote: SocketAddr = "127.0.0.1:5000".parse().unwrap();
        let transport = UdpTransport::new("127.0.0.1:0", remote, 12345);
        assert!(transport.is_ok());
    }

    #[test]
    fn test_video_frame_send() {
        let remote: SocketAddr = "127.0.0.1:5000".parse().unwrap();
        let mut transport = UdpTransport::new("127.0.0.1:0", remote, 12345).unwrap();

        let frame_data = vec![0u8; 100];
        let result = transport.send_video_frame(1, 1, true, &frame_data);

        // May fail if relay not running, but shouldn't panic
        // This tests the code path executes
        let _ = result;
    }
}
