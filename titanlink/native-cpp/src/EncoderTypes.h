#pragma once
#include <vector>
#include <cstdint>

struct EncoderSettings {
    uint32_t width;
    uint32_t height;
    uint32_t bitrate;
    uint32_t fps;
};

struct EncodedPacket {
    std::vector<uint8_t> data;
    bool isKeyFrame;
    uint64_t timestamp;
};
