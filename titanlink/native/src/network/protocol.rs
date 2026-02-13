/// TitanLink Custom UDP Protocol Definition
/// Inspired by Parsec's "BUD" (Better User Datagrams)
///
/// Design Goals:
/// - Zero-buffer video streaming (fire-and-forget)
/// - Reliable input delivery (with ACKs)
/// - Sub-20ms end-to-end latency
/// - Relay-compatible (works through Oracle server)
use std::time::SystemTime;

/// Protocol magic number (4 bytes) - "TTNK" in ASCII
pub const PROTOCOL_MAGIC: u32 = 0x54544E4B;

/// Protocol version (semver: major.minor)
pub const PROTOCOL_VERSION_MAJOR: u8 = 1;
pub const PROTOCOL_VERSION_MINOR: u8 = 0;

/// Maximum packet size (UDP MTU - IP/UDP headers)
pub const MAX_PACKET_SIZE: usize = 1400;

/// Maximum payload size (packet size - header size)
pub const MAX_PAYLOAD_SIZE: usize = MAX_PACKET_SIZE - PacketHeader::SIZE;

/// Packet types for different data channels
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PacketType {
    /// Session handshake (client -> host)
    Handshake = 0x01,

    /// Handshake acknowledgment (host -> client)
    HandshakeAck = 0x02,

    /// Video frame data (fire-and-forget, no ACK)
    VideoFrame = 0x10,

    /// Video frame fragment (for frames > MTU)
    VideoFragment = 0x11,

    /// Controller input (reliable, requires ACK)
    ControllerInput = 0x20,

    /// Keyboard/mouse input (reliable, requires ACK)
    KeyboardMouse = 0x21,

    /// Game state update (reliable)
    GameState = 0x30,

    /// Acknowledgment packet (for reliable channels)
    Ack = 0x40,

    /// Keep-alive ping
    KeepAlive = 0x50,

    /// Statistics report (bandwidth, latency, loss)
    Stats = 0x60,

    /// Connection teardown
    Disconnect = 0xFF,
}

impl PacketType {
    /// Returns true if this packet type requires acknowledgment
    pub fn is_reliable(&self) -> bool {
        matches!(
            self,
            PacketType::ControllerInput | PacketType::KeyboardMouse | PacketType::GameState
        )
    }

    /// Returns true if this is a video packet
    pub fn is_video(&self) -> bool {
        matches!(self, PacketType::VideoFrame | PacketType::VideoFragment)
    }

    /// Convert from u8
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0x01 => Some(PacketType::Handshake),
            0x02 => Some(PacketType::HandshakeAck),
            0x10 => Some(PacketType::VideoFrame),
            0x11 => Some(PacketType::VideoFragment),
            0x20 => Some(PacketType::ControllerInput),
            0x21 => Some(PacketType::KeyboardMouse),
            0x30 => Some(PacketType::GameState),
            0x40 => Some(PacketType::Ack),
            0x50 => Some(PacketType::KeepAlive),
            0x60 => Some(PacketType::Stats),
            0xFF => Some(PacketType::Disconnect),
            _ => None,
        }
    }
}

/// Packet header - Fixed size, appears at start of every packet
/// Total size: 24 bytes
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct PacketHeader {
    /// Session ID (8 bytes) - Used by relay for routing
    pub session_id: u64,

    /// Protocol magic number (4 bytes) - Validates TitanLink packets
    pub magic: u32,

    /// Packet type (1 byte)
    pub packet_type: u8,

    /// Sequence number (4 bytes) - For ordering and loss detection
    pub sequence: u32,

    /// Timestamp (4 bytes) - Microseconds since session start
    pub timestamp_us: u32,

    /// Flags (1 byte) - Reserved for future use
    pub flags: u8,

    /// Payload length (2 bytes) - Size of data after header
    pub payload_len: u16,
}

impl PacketHeader {
    /// Size of header in bytes
    pub const SIZE: usize = std::mem::size_of::<Self>();

    /// Create new packet header
    pub fn new(session_id: u64, packet_type: PacketType, sequence: u32, payload_len: u16) -> Self {
        Self {
            session_id,
            magic: PROTOCOL_MAGIC,
            packet_type: packet_type as u8,
            sequence,
            timestamp_us: Self::current_timestamp_us(),
            flags: 0,
            payload_len,
        }
    }

    /// Get current timestamp in microseconds (wraps at ~71 minutes)
    fn current_timestamp_us() -> u32 {
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_micros() as u32
    }

    /// Validate packet header
    pub fn validate(&self) -> bool {
        self.magic == PROTOCOL_MAGIC && self.payload_len as usize <= MAX_PAYLOAD_SIZE
    }

    /// Get packet type enum
    pub fn get_packet_type(&self) -> Option<PacketType> {
        PacketType::from_u8(self.packet_type)
    }
}

/// Video frame metadata (for VideoFrame packets)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct VideoFrameHeader {
    /// Frame number (monotonically increasing)
    pub frame_number: u32,

    /// Frame flags (keyframe, etc.)
    pub flags: u8,

    /// Codec type (H264=1, H265=2, VP9=3)
    pub codec: u8,

    /// Total fragments (for large frames)
    pub total_fragments: u8,

    /// Current fragment index (0-based)
    pub fragment_index: u8,
}

impl VideoFrameHeader {
    pub const SIZE: usize = std::mem::size_of::<Self>();

    /// Keyframe flag bit
    pub const FLAG_KEYFRAME: u8 = 0x01;

    /// Check if this is a keyframe
    pub fn is_keyframe(&self) -> bool {
        (self.flags & Self::FLAG_KEYFRAME) != 0
    }
}

/// Controller input data (for ControllerInput packets)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct ControllerInputData {
    /// Controller index (0-3)
    pub controller_index: u8,

    /// Button state (bitmask)
    pub buttons: u16,

    /// Left stick X (-32768 to 32767)
    pub left_stick_x: i16,

    /// Left stick Y (-32768 to 32767)
    pub left_stick_y: i16,

    /// Right stick X (-32768 to 32767)
    pub right_stick_x: i16,

    /// Right stick Y (-32768 to 32767)
    pub right_stick_y: i16,

    /// Left trigger (0-255)
    pub left_trigger: u8,

    /// Right trigger (0-255)
    pub right_trigger: u8,
}

impl ControllerInputData {
    pub const SIZE: usize = std::mem::size_of::<Self>();
}

/// Acknowledgment data (for Ack packets)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct AckData {
    /// Sequence number being acknowledged
    pub ack_sequence: u32,

    /// Packet type being acknowledged
    pub ack_packet_type: u8,
}

impl AckData {
    pub const SIZE: usize = std::mem::size_of::<Self>();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_header_size() {
        assert_eq!(PacketHeader::SIZE, 24);
        assert!(PacketHeader::SIZE + MAX_PAYLOAD_SIZE <= MAX_PACKET_SIZE);
    }

    #[test]
    fn test_packet_type_conversion() {
        assert_eq!(PacketType::from_u8(0x10), Some(PacketType::VideoFrame));
        assert_eq!(PacketType::from_u8(0x20), Some(PacketType::ControllerInput));
        assert_eq!(PacketType::from_u8(0x99), None);
    }

    #[test]
    fn test_reliable_detection() {
        assert!(PacketType::ControllerInput.is_reliable());
        assert!(!PacketType::VideoFrame.is_reliable());
        assert!(!PacketType::KeepAlive.is_reliable());
    }

    #[test]
    fn test_header_creation() {
        let header = PacketHeader::new(12345, PacketType::VideoFrame, 1, 100);

        assert_eq!(header.session_id, 12345);
        assert_eq!(header.magic, PROTOCOL_MAGIC);
        assert_eq!(header.packet_type, PacketType::VideoFrame as u8);
        assert_eq!(header.sequence, 1);
        assert_eq!(header.payload_len, 100);
        assert!(header.validate());
    }
}
