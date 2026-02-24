#pragma once
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <wrl/client.h>
#include <thread>
#include <atomic>
#include <functional>
#include <vector>
#include <cstdint>

using Microsoft::WRL::ComPtr;

struct AudioFrame {
    std::vector<uint8_t> data;   // raw PCM bytes
    uint32_t sampleRate;
    uint16_t channels;
    uint16_t bitsPerSample;      // always 32 (IEEE float)
    uint32_t numFrames;
    bool     isSilence;
};

// Called from the capture thread — must be thread-safe.
using AudioFrameCallback = std::function<void(const AudioFrame&)>;

class WasapiCapture {
public:
    WasapiCapture();
    ~WasapiCapture();

    // Returns false if WASAPI loopback is unavailable.
    bool Init();

    // Start/stop on a background high-priority thread.
    bool Start(AudioFrameCallback cb);
    void Stop();

    bool IsRunning() const { return m_running.load(std::memory_order_relaxed); }

    // Expose the actual mix format discovered at Init() time.
    uint32_t GetSampleRate()   const { return m_sampleRate; }
    uint16_t GetChannels()     const { return m_channels; }

private:
    void CaptureLoop();

    ComPtr<IMMDeviceEnumerator> m_enumerator;
    ComPtr<IMMDevice>           m_device;
    ComPtr<IAudioClient>        m_audioClient;
    ComPtr<IAudioCaptureClient> m_captureClient;
    HANDLE                      m_eventHandle  = nullptr;
    WAVEFORMATEX*               m_mixFormat    = nullptr;

    uint32_t m_sampleRate   = 48000;
    uint16_t m_channels     = 2;
    uint16_t m_bitsPerSample = 32;

    std::atomic<bool>   m_running{false};
    std::thread         m_captureThread;
    AudioFrameCallback  m_callback;

    // Silence injection: emit N frames of zeros when the stream is dry.
    static constexpr uint32_t SILENCE_FRAMES = 480; // 10ms @ 48kHz
};
