use super::packet::*;
/// Reliable packet delivery with ACKs and retransmission
/// Used for critical data like input, game state
use super::protocol::*;
use super::transport::UdpTransport;
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Pending packet awaiting acknowledgment
struct PendingPacket {
    packet: Packet,
    sent_at: Instant,
    retry_count: u8,
}

/// Reliable channel configuration
pub struct ReliableConfig {
    /// Timeout before retransmission (default: 50ms)
    pub retry_timeout_ms: u64,

    /// Maximum retries before giving up (default: 3)
    pub max_retries: u8,
}

impl Default for ReliableConfig {
    fn default() -> Self {
        Self {
            retry_timeout_ms: 50,
            max_retries: 3,
        }
    }
}

/// Reliable delivery manager
pub struct ReliableChannel {
    pending: HashMap<u32, PendingPacket>,
    config: ReliableConfig,
}

impl ReliableChannel {
    pub fn new(config: ReliableConfig) -> Self {
        Self {
            pending: HashMap::new(),
            config,
        }
    }

    /// Send reliable packet (tracks for ACK)
    pub fn send_reliable(
        &mut self,
        transport: &UdpTransport,
        packet: Packet,
    ) -> std::io::Result<()> {
        let sequence = packet.header.sequence;

        // Send packet
        transport.send_packet(&packet)?;

        // Track for ACK
        self.pending.insert(
            sequence,
            PendingPacket {
                packet,
                sent_at: Instant::now(),
                retry_count: 0,
            },
        );

        Ok(())
    }

    /// Process ACK packet
    pub fn handle_ack(&mut self, ack_sequence: u32) {
        self.pending.remove(&ack_sequence);
    }

    /// Check for timeouts and retry
    pub fn process_retries(&mut self, transport: &UdpTransport) -> std::io::Result<()> {
        let now = Instant::now();
        let timeout = Duration::from_millis(self.config.retry_timeout_ms);

        let mut to_retry = Vec::new();
        let mut to_remove = Vec::new();

        for (seq, pending) in self.pending.iter_mut() {
            if now.duration_since(pending.sent_at) > timeout {
                if pending.retry_count >= self.config.max_retries {
                    // Give up
                    to_remove.push(*seq);
                } else {
                    // Retry
                    to_retry.push((*seq, pending.packet.clone()));
                    pending.retry_count += 1;
                    pending.sent_at = now;
                }
            }
        }

        // Remove failed packets
        for seq in to_remove {
            self.pending.remove(&seq);
        }

        // Retry packets
        for (_seq, packet) in to_retry {
            transport.send_packet(&packet)?;
        }

        Ok(())
    }

    /// Get number of pending ACKs
    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }

    /// Clear all pending packets
    pub fn clear(&mut self) {
        self.pending.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_reliable_channel() {
        let mut channel = ReliableChannel::new(ReliableConfig::default());
        assert_eq!(channel.pending_count(), 0);
    }

    #[test]
    fn test_ack_handling() {
        let mut channel = ReliableChannel::new(ReliableConfig::default());

        // Simulate pending packet
        channel.pending.insert(
            42,
            PendingPacket {
                packet: Packet::new(12345, PacketType::ControllerInput, 42, vec![]),
                sent_at: Instant::now(),
                retry_count: 0,
            },
        );

        assert_eq!(channel.pending_count(), 1);

        channel.handle_ack(42);
        assert_eq!(channel.pending_count(), 0);
    }
}
