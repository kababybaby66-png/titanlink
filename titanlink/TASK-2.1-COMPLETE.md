# Task 2.1 Complete: Custom UDP Packet Protocol

## ✅ Summary

The TitanLink custom UDP packet protocol is now fully defined! This is the foundation for replacing WebRTC with a "Parsec-like" low-latency protocol.

---

## 📦 Packet Structure

### Packet Header (24 bytes)

```
  0               1               2               3
  0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7
 +-+-+-+- +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 |                      Session ID (8-bytes)                      |
 |                                                                 |
 +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 |                    Magic "TTNK" (4 bytes)                      |
 +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 | PacketType (1)|            Sequence Number (4 bytes)           |
 +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 |                    Timestamp μs (4 bytes)       |  Flags (1)  |
 +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 |   Payload Length (2 bytes)    |
 +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Total:** 24 bytes + payload (max 1376 bytes = UDP MTU safe zone)

---

## 📋 Packet Types (11 Types)

| Type | Hex | Purpose | Reliable? |
|------|-----|---------|-----------|
| **Handshake** | 0x01 | Client → Host session init | No |
| **HandshakeAck** | 0x02 | Host → Client confirm | No |
| **VideoFrame** | 0x10 | Video frame data | **No** (fire-and-forget) |
| **VideoFragment** | 0x11 | Large frame chunk | **No** |
| **ControllerInput** | 0x20 | Gamepad input | **Yes** |
| **KeyboardMouse** | 0x21 | KB/Mouse input | **Yes** |
| **GameState** | 0x30 | Game state update | **Yes** |
| **Ack** | 0x40 | Acknowledgment | No |
| **KeepAlive** | 0x50 | Connection heartbeat | No |
| **Stats** | 0x60 | Bandwidth/latency metrics | No |
| **Disconnect** | 0xFF | Clean teardown | No |

---

## 🔑 Key Design Decisions

### 1. Session ID First (8 bytes)
**Why:** The relay server expects SessionID at byte 0-7. This allows seamless packet forwarding without protocol inspection.

```rust
// Relay server doesn't care about the rest of the packet
let session_id = u64::from_be_bytes(packet[0..8]);
forward_to_peer(session_id, packet);
```

### 2. Magic Number "TTNK"
**Why:** Quickly validate packets are TitanLink protocol (not random UDP noise).

### 3. Microsecond Timestamps (wraps at ~71 minutes)
**Why:** 
- Precise enough for latency measurement (sub-ms)
- 4 bytes instead of 8 (saves bandwidth)
- Wrapping is OK for delta calculations

### 4. Variable Payload Length
**Why:** Avoid sending zeros. Video packets are full-sized, but input packets are tiny (~10 bytes).

---

## 🧪 Usage Example

```rust
use titanlink_capture::network::*;

// Create packet builder for session
let mut builder = PacketBuilder::new(12345);

// Send handshake
let handshake = builder.handshake();
let bytes = handshake.to_bytes();
socket.send_to(&bytes, relay_address)?;

// Send video frame
let video = builder.video_frame(
    frame_num: 42,
    codec: 1, // H264
    is_keyframe: true,
    frame_data: encoded_frame,
);
socket.send_to(&video.to_bytes(), client_address)?;

// Send controller input
let input = ControllerInputData {
    controller_index: 0,
    buttons: 0b1010, // A + Y pressed
    left_stick_x: 15000,
    left_stick_y: -8000,
    // ...
};
let input_packet = builder.controller_input(input);
socket.send_to(&input_packet.to_bytes(), host_address)?;

// Receive and parse
let (size, addr) = socket.recv_from(&mut buf)?;
if let Some(packet) = Packet::from_bytes(&buf[..size]) {
    match packet.packet_type() {
        Some(PacketType::VideoFrame) => {
            // Handle video
        }
        Some(PacketType::ControllerInput) => {
            // Handle input (send ACK!)
        }
        _ => {}
    }
}
```

---

## 📏 Size Comparison

| Packet Type | Header | Payload (typical) | Total |
|-------------|--------|-------------------|-------|
| **Handshake** | 24 | 2 | 26 bytes |
| **VideoFrame** | 24 | ~1000-1376 | ~1024-1400 bytes |
| **ControllerInput** | 24 | 14 | 38 bytes |
| **Ack** | 24 | 5 | 29 bytes |
| **KeepAlive** | 24 | 0 | 24 bytes |

**Bandwidth estimate for 4K 60fps:**
- Video: 10 Mbps (depends on encoder) 
- Input: ~60 packets/s × 38 bytes = **2.28 KB/s** (negligible!)
- Overhead: ~0.1% (header is only 24 bytes)

---

## 🧪 Tests Implemented

All tests in `protocol.rs` and `packet.rs`:

```
✅ test_header_size - Validates 24-byte header
✅ test_packet_type_conversion - Enum↔u8 conversion
✅ test_reliable_detection - Identifies reliable packets
✅ test_header_creation - Creates valid headers
✅ test_packet_serialization - Round-trip bytes ↔ struct
✅ test_packet_builder - Builder pattern works
✅ test_invalid_packet - Rejects bad data
```

Run tests:
```powershell
cargo test --manifest-path native\Cargo.toml --lib network
```

---

## 🔗 Integration with Relay Server

The packet format is **100% compatible** with the relay server built in Phase 1:

```
Client sends:
[SessionID (8)] [Magic (4)] [Type (1)] ... → Relay

Relay forwards (preserves entire packet):
[SessionID (8)] [Magic (4)] [Type (1)] ... → Host

Host receives:
[SessionID (8)] [Magic (4)] [Type (1)] ...
                  ↑ Validates magic number
```

The relay never inspects bytes 8+, it only routes based on SessionID[0..8].

---

## 📊 What's Next (Task 2.2 & 2.3)

### Task 2.2: "Fire-and-Forget" Video Channel
Implement the actual UDP socket that:
- Sends `VideoFrame` packets
- **No retries** (old frames are useless)
- **No buffering** (sends immediately)
- Target: < 1ms from encoder to network

### Task 2.3: "Reliable" Input Channel
Implement acknowledgment logic:
- `ControllerInput` → wait for `Ack`
- If no ACK in 50ms → resend
- Max 3 retries before connection error
- Target: 99.9% delivery within 20ms

---

## 🎯 Performance Targets

Based on this protocol:

| Metric | Target | How |
|--------|--------|-----|
| **Packet overhead** | < 2% | 24-byte header is tiny |
| **Serialization time** | < 0.1ms | Zero-copy when possible |
| **Latency added** | < 1ms | Direct UDP_send, no queuing |
| **Packet loss tolerance** | 10% | Video tolerates loss, input retries |

---

## 📁 Files Reference

| File | Purpose | Lines |
|------|---------|-------|
| **protocol.rs** | Type definitions, enums, structs | ~300 |
| **packet.rs** | Serialization, builder pattern | ~250 |
| **mod.rs** | Module exports | ~6 |

---

✅ **Task 2.1 Complete!**  
**Next:** Task 2.2 - Implement the actual UDP socket with "fire-and-forget" video streaming.
