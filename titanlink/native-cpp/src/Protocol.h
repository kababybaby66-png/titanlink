#pragma once
#include <cstdint>
#include <winsock2.h>

#pragma pack(push, 1)

struct PacketHeader {
    uint64_t session_id;
    uint32_t magic;         // 0x54544E4B ("TTNK")
    uint8_t  packet_type;
    uint32_t sequence;
    uint32_t timestamp_us;
    uint8_t  flags;
    uint16_t payload_len;
};

struct VideoFrameHeader {
    uint32_t frame_number;
    uint8_t  flags;        // 0x01 = Keyframe
    uint8_t  codec;        // 1=H264, 2=H265, 3=VP9
    uint8_t  total_fragments;
    uint8_t  fragment_index;
};

struct ControllerInputData {
    uint8_t  controller_index;
    uint16_t buttons;
    int16_t  left_stick_x;
    int16_t  left_stick_y;
    int16_t  right_stick_x;
    int16_t  right_stick_y;
    uint8_t  left_trigger;
    uint8_t  right_trigger;
};

#pragma pack(pop)

namespace Protocol {
    constexpr uint32_t MAGIC = 0x54544E4B;
    constexpr size_t MAX_PACKET_SIZE = 1400;
    constexpr size_t MAX_PAYLOAD_SIZE = MAX_PACKET_SIZE - sizeof(PacketHeader);

    enum class PacketType : uint8_t {
        Handshake = 0x01,
        HandshakeAck = 0x02,
        VideoFrame = 0x10,
        VideoFragment = 0x11,
        ControllerInput = 0x20,
        KeyboardMouse = 0x21,
        GameState = 0x30,
        Ack = 0x40,
        KeepAlive = 0x50,
        Stats = 0x60,
        Disconnect = 0xFF,
    };
}
