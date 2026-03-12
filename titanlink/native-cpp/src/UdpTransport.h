#pragma once
#include <string>
#include <vector>
#include <cstdint>
#include <winsock2.h>
#include <ws2tcpip.h>
#include "Protocol.h"
#include <atomic>
#include <thread>
#include <mutex>
#include <functional>

#pragma comment(lib, "ws2_32.lib")

class UdpTransport {
public:
    static UdpTransport& GetInstance();

    bool Start(const std::string& relayIp, uint16_t relayPort, uint64_t sessionId);
    void Stop();
    
    // Callbacks from JavaScript for input/events
    using InputCallback = std::function<void(const ControllerInputData&)>;
    void SetInputCallback(InputCallback cb);

    using PacketCallback = std::function<void(const uint8_t*, size_t)>;
    void SetPacketCallback(PacketCallback cb);

    void SendInput(const ControllerInputData& input);

    // Fast path for video frames straight from hardware 
    void SendVideoFrame(uint32_t frameNumber, bool isKeyframe, uint8_t codec, const uint8_t* data, size_t size);
    
    bool IsConnected() const { return m_running; }

private:
    UdpTransport();
    ~UdpTransport();

    bool m_running = false;
    SOCKET m_socket = INVALID_SOCKET;
    sockaddr_in m_relayAddr{};
    uint64_t m_sessionId = 0;
    std::atomic<uint32_t> m_sequence{0};

    InputCallback m_inputCallback;
    PacketCallback m_packetCallback;
    std::thread m_recvThread;
    std::mutex m_mutex;

    void RecvLoop();
    void SendPacket(Protocol::PacketType type, const std::vector<uint8_t>& payload);
    void SendRaw(const uint8_t* data, size_t size);

    uint64_t htonll(uint64_t value);
};
