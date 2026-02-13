/// Packet serialization and deserialization
/// Handles conversion between structs and bytes for network transmission
use super::protocol::*;
use std::io::{Cursor, Read, Write};

/// A complete packet (header + payload)
#[derive(Debug, Clone)]
pub struct Packet {
    pub header: PacketHeader,
    pub payload: Vec<u8>,
}

impl Packet {
    /// Create a new packet
    pub fn new(session_id: u64, packet_type: PacketType, sequence: u32, payload: Vec<u8>) -> Self {
        let payload_len = payload.len().min(MAX_PAYLOAD_SIZE) as u16;

        Self {
            header: PacketHeader::new(session_id, packet_type, sequence, payload_len),
            payload: payload.into_iter().take(payload_len as usize).collect(),
        }
    }

    /// Serialize packet to bytes for network transmission
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut buffer = Vec::with_capacity(PacketHeader::SIZE + self.payload.len());

        // Write header (convert to big-endian for network byte order)
        buffer.extend_from_slice(&self.header.session_id.to_be_bytes());
        buffer.extend_from_slice(&self.header.magic.to_be_bytes());
        buffer.push(self.header.packet_type);
        buffer.extend_from_slice(&self.header.sequence.to_be_bytes());
        buffer.extend_from_slice(&self.header.timestamp_us.to_be_bytes());
        buffer.push(self.header.flags);
        buffer.extend_from_slice(&self.header.payload_len.to_be_bytes());

        // Write payload
        buffer.extend_from_slice(&self.payload);

        buffer
    }

    /// Deserialize packet from bytes
    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        if data.len() < PacketHeader::SIZE {
            return None;
        }

        let mut cursor = Cursor::new(data);

        // Read header fields (big-endian)
        let mut buf8 = [0u8; 8];
        let mut buf4 = [0u8; 4];
        let mut buf2 = [0u8; 2];
        let mut buf1 = [0u8; 1];

        cursor.read_exact(&mut buf8).ok()?;
        let session_id = u64::from_be_bytes(buf8);

        cursor.read_exact(&mut buf4).ok()?;
        let magic = u32::from_be_bytes(buf4);

        cursor.read_exact(&mut buf1).ok()?;
        let packet_type = buf1[0];

        cursor.read_exact(&mut buf4).ok()?;
        let sequence = u32::from_be_bytes(buf4);

        cursor.read_exact(&mut buf4).ok()?;
        let timestamp_us = u32::from_be_bytes(buf4);

        cursor.read_exact(&mut buf1).ok()?;
        let flags = buf1[0];

        cursor.read_exact(&mut buf2).ok()?;
        let payload_len = u16::from_be_bytes(buf2);

        let header = PacketHeader {
            session_id,
            magic,
            packet_type,
            sequence,
            timestamp_us,
            flags,
            payload_len,
        };

        // Validate header
        if !header.validate() {
            return None;
        }

        // Read payload
        let payload_start = PacketHeader::SIZE;
        let payload_end = payload_start + payload_len as usize;

        if data.len() < payload_end {
            return None;
        }

        let payload = data[payload_start..payload_end].to_vec();

        Some(Self { header, payload })
    }

    /// Get packet type
    pub fn packet_type(&self) -> Option<PacketType> {
        self.header.get_packet_type()
    }

    /// Total packet size in bytes
    pub fn total_size(&self) -> usize {
        PacketHeader::SIZE + self.payload.len()
    }
}

/// Builder for creating specific packet types
pub struct PacketBuilder {
    session_id: u64,
    sequence: u32,
}

impl PacketBuilder {
    pub fn new(session_id: u64) -> Self {
        Self {
            session_id,
            sequence: 0,
        }
    }

    /// Get next sequence number
    pub fn next_sequence(&mut self) -> u32 {
        let seq = self.sequence;
        self.sequence = self.sequence.wrapping_add(1);
        seq
    }

    /// Create handshake packet
    pub fn handshake(&mut self) -> Packet {
        Packet::new(
            self.session_id,
            PacketType::Handshake,
            self.next_sequence(),
            vec![PROTOCOL_VERSION_MAJOR, PROTOCOL_VERSION_MINOR],
        )
    }

    /// Create handshake ACK
    pub fn handshake_ack(&mut self) -> Packet {
        Packet::new(
            self.session_id,
            PacketType::HandshakeAck,
            self.next_sequence(),
            vec![PROTOCOL_VERSION_MAJOR, PROTOCOL_VERSION_MINOR],
        )
    }

    /// Create video frame packet
    pub fn video_frame(
        &mut self,
        frame_number: u32,
        codec: u8,
        is_keyframe: bool,
        frame_data: Vec<u8>,
    ) -> Packet {
        let mut payload = Vec::with_capacity(VideoFrameHeader::SIZE + frame_data.len());

        // Write video frame header
        payload.extend_from_slice(&frame_number.to_be_bytes());
        payload.push(if is_keyframe {
            VideoFrameHeader::FLAG_KEYFRAME
        } else {
            0
        });
        payload.push(codec);
        payload.push(1); // total_fragments
        payload.push(0); // fragment_index

        // Write frame data
        payload.extend_from_slice(&frame_data);

        Packet::new(
            self.session_id,
            PacketType::VideoFrame,
            self.next_sequence(),
            payload,
        )
    }

    /// Create controller input packet
    pub fn controller_input(&mut self, input: ControllerInputData) -> Packet {
        let mut payload = Vec::with_capacity(ControllerInputData::SIZE);

        payload.push(input.controller_index);
        payload.extend_from_slice(&input.buttons.to_be_bytes());
        payload.extend_from_slice(&input.left_stick_x.to_be_bytes());
        payload.extend_from_slice(&input.left_stick_y.to_be_bytes());
        payload.extend_from_slice(&input.right_stick_x.to_be_bytes());
        payload.extend_from_slice(&input.right_stick_y.to_be_bytes());
        payload.push(input.left_trigger);
        payload.push(input.right_trigger);

        Packet::new(
            self.session_id,
            PacketType::ControllerInput,
            self.next_sequence(),
            payload,
        )
    }

    /// Create ACK packet
    pub fn ack(&mut self, ack_sequence: u32, ack_packet_type: PacketType) -> Packet {
        let mut payload = Vec::with_capacity(AckData::SIZE);

        payload.extend_from_slice(&ack_sequence.to_be_bytes());
        payload.push(ack_packet_type as u8);

        Packet::new(
            self.session_id,
            PacketType::Ack,
            self.next_sequence(),
            payload,
        )
    }

    /// Create keep-alive packet
    pub fn keep_alive(&mut self) -> Packet {
        Packet::new(
            self.session_id,
            PacketType::KeepAlive,
            self.next_sequence(),
            vec![],
        )
    }

    /// Create disconnect packet
    pub fn disconnect(&mut self) -> Packet {
        Packet::new(
            self.session_id,
            PacketType::Disconnect,
            self.next_sequence(),
            vec![],
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_packet_serialization() {
        let packet = Packet::new(12345, PacketType::KeepAlive, 42, vec![1, 2, 3, 4, 5]);

        let bytes = packet.to_bytes();
        assert_eq!(bytes.len(), PacketHeader::SIZE + 5);

        let deserialized = Packet::from_bytes(&bytes).expect("Failed to deserialize");

        assert_eq!(deserialized.header.session_id, 12345);
        assert_eq!(deserialized.header.sequence, 42);
        assert_eq!(deserialized.payload, vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn test_packet_builder() {
        let mut builder = PacketBuilder::new(99999);

        let handshake = builder.handshake();
        assert_eq!(handshake.header.sequence, 0);
        assert_eq!(handshake.packet_type(), Some(PacketType::Handshake));

        let keepalive = builder.keep_alive();
        assert_eq!(keepalive.header.sequence, 1);

        let disconnect = builder.disconnect();
        assert_eq!(disconnect.header.sequence, 2);
    }

    #[test]
    fn test_invalid_packet() {
        // Too short
        assert!(Packet::from_bytes(&[1, 2, 3]).is_none());

        // Invalid magic
        let mut bad_packet = vec![0u8; PacketHeader::SIZE + 5];
        bad_packet[8..12].copy_from_slice(&0xDEADBEEFu32.to_be_bytes()); // Wrong magic
        assert!(Packet::from_bytes(&bad_packet).is_none());
    }
}
