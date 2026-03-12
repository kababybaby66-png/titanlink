#include "UdpTransport.h"
#include <iostream>
#include <chrono>

UdpTransport& UdpTransport::GetInstance() {
    static UdpTransport instance;
    return instance;
}

UdpTransport::UdpTransport() {
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);
}

UdpTransport::~UdpTransport() {
    Stop();
    WSACleanup();
}

uint64_t UdpTransport::htonll(uint64_t value) {
    int num = 1;
    if (*(char *)&num == 1) { // Little-Endian
        return ((uint64_t)htonl(value & 0xFFFFFFFF) << 32) | htonl(value >> 32);
    } else {
        return value;
    }
}

bool UdpTransport::Start(const std::string& relayIp, uint16_t relayPort, uint64_t sessionId) {
    if (m_running) return true;

    m_socket = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (m_socket == INVALID_SOCKET) {
        return false;
    }

    m_relayAddr.sin_family = AF_INET;
    m_relayAddr.sin_port = htons(relayPort);
    inet_pton(AF_INET, relayIp.c_str(), &m_relayAddr.sin_addr);

    m_sessionId = sessionId;
    m_running = true;

    // Send Handshake
    SendPacket(Protocol::PacketType::Handshake, {1, 0});

    m_recvThread = std::thread(&UdpTransport::RecvLoop, this);
    return true;
}

void UdpTransport::Stop() {
    if (!m_running) return;
    
    // Send Disconnect
    SendPacket(Protocol::PacketType::Disconnect, {});

    m_running = false;
    if (m_socket != INVALID_SOCKET) {
        closesocket(m_socket);
        m_socket = INVALID_SOCKET;
    }
    
    if (m_recvThread.joinable()) {
        m_recvThread.join();
    }
}

void UdpTransport::SendPacket(Protocol::PacketType type, const std::vector<uint8_t>& payload) {
    PacketHeader header{};
    header.session_id = htonll(m_sessionId);
    header.magic = htonl(Protocol::MAGIC);
    header.packet_type = static_cast<uint8_t>(type);
    header.sequence = htonl(m_sequence++);
    
    auto now = std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    header.timestamp_us = htonl(static_cast<uint32_t>(now));
    header.flags = 0;
    header.payload_len = htons(static_cast<uint16_t>(payload.size()));

    std::vector<uint8_t> buffer(sizeof(PacketHeader) + payload.size());
    memcpy(buffer.data(), &header, sizeof(PacketHeader));
    if (!payload.empty()) {
        memcpy(buffer.data() + sizeof(PacketHeader), payload.data(), payload.size());
    }

    SendRaw(buffer.data(), buffer.size());
}

void UdpTransport::SendRaw(const uint8_t* data, size_t size) {
    if (!m_running || m_socket == INVALID_SOCKET) return;
    sendto(m_socket, (const char*)data, static_cast<int>(size), 0, (const sockaddr*)&m_relayAddr, sizeof(m_relayAddr));
}

void UdpTransport::SendInput(const ControllerInputData& input) {
    if (!m_running) return;

    std::vector<uint8_t> payload(sizeof(ControllerInputData));
    payload[0] = input.controller_index;
    *reinterpret_cast<uint16_t*>(&payload[1]) = htons(input.buttons);
    *reinterpret_cast<uint16_t*>(&payload[3]) = htons(input.left_stick_x);
    *reinterpret_cast<uint16_t*>(&payload[5]) = htons(input.left_stick_y);
    *reinterpret_cast<uint16_t*>(&payload[7]) = htons(input.right_stick_x);
    *reinterpret_cast<uint16_t*>(&payload[9]) = htons(input.right_stick_y);
    payload[11] = input.left_trigger;
    payload[12] = input.right_trigger;

    SendPacket(Protocol::PacketType::ControllerInput, payload);
}

void UdpTransport::SendVideoFrame(uint32_t frameNumber, bool isKeyframe, uint8_t codec, const uint8_t* data, size_t size) {
    if (!m_running) return;

    size_t offset = 0;
    uint8_t fragmentIndex = 0;
    
    // Max data we can fit in one fragment
    const size_t maxFragSize = Protocol::MAX_PAYLOAD_SIZE - sizeof(VideoFrameHeader);
    const uint8_t totalFragments = static_cast<uint8_t>((size + maxFragSize - 1) / maxFragSize);
    
    while (offset < size) {
        size_t fragSize = std::min(maxFragSize, size - offset);
        
        VideoFrameHeader vheader{};
        vheader.frame_number = htonl(frameNumber);
        vheader.flags = isKeyframe ? 0x01 : 0x00;
        vheader.codec = codec;
        vheader.total_fragments = totalFragments;
        vheader.fragment_index = fragmentIndex;

        // Construct payload: VHeader + chunk data
        std::vector<uint8_t> payload(sizeof(VideoFrameHeader) + fragSize);
        memcpy(payload.data(), &vheader, sizeof(VideoFrameHeader));
        memcpy(payload.data() + sizeof(VideoFrameHeader), data + offset, fragSize);
        
        SendPacket(Protocol::PacketType::VideoFragment, payload);

        offset += fragSize;
        fragmentIndex++;
    }
}

void UdpTransport::RecvLoop() {
    uint8_t buffer[65535];
    while (m_running) {
        sockaddr_in senderAddr;
        int senderLen = sizeof(senderAddr);
        int received = recvfrom(m_socket, (char*)buffer, sizeof(buffer), 0, (sockaddr*)&senderAddr, &senderLen);
        
        if (received <= 0) continue; // Timeout or error

        if (m_packetCallback) {
            m_packetCallback(buffer, received);
        }

        // Hacky PING handling
        if (received == 4 && memcmp(buffer, "PONG", 4) == 0) continue;

        if (received < sizeof(PacketHeader)) continue;

        PacketHeader* header = reinterpret_cast<PacketHeader*>(buffer);
        if (ntohl(header->magic) != Protocol::MAGIC) continue;

        uint16_t payloadLen = ntohs(header->payload_len);
        if (received < sizeof(PacketHeader) + payloadLen) continue;

        Protocol::PacketType type = static_cast<Protocol::PacketType>(header->packet_type);
        
        switch (type) {
            case Protocol::PacketType::ControllerInput:
                if (payloadLen >= sizeof(ControllerInputData)) {
                    ControllerInputData input;
                    const uint8_t* p = buffer + sizeof(PacketHeader);
                    input.controller_index = p[0];
                    input.buttons = ntohs(*reinterpret_cast<const uint16_t*>(p + 1));
                    input.left_stick_x = static_cast<int16_t>(ntohs(*reinterpret_cast<const uint16_t*>(p + 3)));
                    input.left_stick_y = static_cast<int16_t>(ntohs(*reinterpret_cast<const uint16_t*>(p + 5)));
                    input.right_stick_x = static_cast<int16_t>(ntohs(*reinterpret_cast<const uint16_t*>(p + 7)));
                    input.right_stick_y = static_cast<int16_t>(ntohs(*reinterpret_cast<const uint16_t*>(p + 9)));
                    input.left_trigger = p[11];
                    input.right_trigger = p[12];
                    
                    if (m_inputCallback) m_inputCallback(input);
                }
                break;
            default:
                break;
        }
    }
}
void UdpTransport::SetInputCallback(InputCallback cb) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_inputCallback = cb;
}

void UdpTransport::SetPacketCallback(PacketCallback cb) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_packetCallback = cb;
}
