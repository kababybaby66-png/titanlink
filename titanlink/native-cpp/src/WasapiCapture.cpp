#include "WasapiCapture.h"
#include <avrt.h>      // AvSetMmThreadCharacteristics
#include <iostream>
#include <cstring>

#pragma comment(lib, "avrt.lib")

// -----------------------------------------------------------------------
// GUIDs needed without linking the full ksproxy / dshow stack
// -----------------------------------------------------------------------
static const CLSID  CLSID_MMDeviceEnumerator_ = __uuidof(MMDeviceEnumerator);
static const IID    IID_IMMDeviceEnumerator_  = __uuidof(IMMDeviceEnumerator);
static const IID    IID_IAudioClient_         = __uuidof(IAudioClient);
static const IID    IID_IAudioCaptureClient_  = __uuidof(IAudioCaptureClient);

// -----------------------------------------------------------------------
WasapiCapture::WasapiCapture() = default;

WasapiCapture::~WasapiCapture() {
    Stop();
    if (m_mixFormat) {
        CoTaskMemFree(m_mixFormat);
        m_mixFormat = nullptr;
    }
    if (m_eventHandle) {
        CloseHandle(m_eventHandle);
        m_eventHandle = nullptr;
    }
}

// -----------------------------------------------------------------------
bool WasapiCapture::Init() {
    HRESULT hr;

    // COM must already be initialised by the caller (COINIT_MULTITHREADED).
    hr = CoCreateInstance(
        CLSID_MMDeviceEnumerator_, nullptr,
        CLSCTX_ALL,
        IID_IMMDeviceEnumerator_,
        reinterpret_cast<void**>(m_enumerator.GetAddressOf())
    );
    if (FAILED(hr)) {
        std::cerr << "[WASAPI] CoCreateInstance failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    // Get the default *render* endpoint — loopback taps the render device.
    hr = m_enumerator->GetDefaultAudioEndpoint(eRender, eConsole, m_device.GetAddressOf());
    if (FAILED(hr)) {
        std::cerr << "[WASAPI] GetDefaultAudioEndpoint failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    hr = m_device->Activate(IID_IAudioClient_, CLSCTX_ALL, nullptr,
                            reinterpret_cast<void**>(m_audioClient.GetAddressOf()));
    if (FAILED(hr)) {
        std::cerr << "[WASAPI] Activate AudioClient failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    // Use the engine's native mix format — guarantees format compatibility.
    hr = m_audioClient->GetMixFormat(&m_mixFormat);
    if (FAILED(hr)) {
        std::cerr << "[WASAPI] GetMixFormat failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    m_sampleRate    = m_mixFormat->nSamplesPerSec;
    m_channels      = m_mixFormat->nChannels;
    m_bitsPerSample = m_mixFormat->wBitsPerSample;

    std::cout << "[WASAPI] Mix format: "
              << m_sampleRate << "Hz, "
              << m_channels   << "ch, "
              << m_bitsPerSample << "-bit" << std::endl;

    // Event-driven: minimises CPU spin when nothing is playing.
    m_eventHandle = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!m_eventHandle) {
        std::cerr << "[WASAPI] CreateEvent failed" << std::endl;
        return false;
    }

    // 10ms buffer in 100-ns units (REFERENCE_TIME).
    const REFERENCE_TIME requestedDuration = 100000; // 10ms

    hr = m_audioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        requestedDuration,
        0,
        m_mixFormat,
        nullptr
    );
    if (FAILED(hr)) {
        std::cerr << "[WASAPI] Initialize failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    hr = m_audioClient->SetEventHandle(m_eventHandle);
    if (FAILED(hr)) {
        std::cerr << "[WASAPI] SetEventHandle failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    hr = m_audioClient->GetService(IID_IAudioCaptureClient_,
                                   reinterpret_cast<void**>(m_captureClient.GetAddressOf()));
    if (FAILED(hr)) {
        std::cerr << "[WASAPI] GetService(CaptureClient) failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    return true;
}

// -----------------------------------------------------------------------
bool WasapiCapture::Start(AudioFrameCallback cb) {
    if (m_running || !m_audioClient) return false;

    m_callback = std::move(cb);
    m_running  = true;

    HRESULT hr = m_audioClient->Start();
    if (FAILED(hr)) {
        std::cerr << "[WASAPI] AudioClient::Start failed: 0x" << std::hex << hr << std::endl;
        m_running = false;
        return false;
    }

    m_captureThread = std::thread([this]() { CaptureLoop(); });
    std::cout << "[WASAPI] Capture started." << std::endl;
    return true;
}

// -----------------------------------------------------------------------
void WasapiCapture::Stop() {
    m_running = false;

    // Wake the blocking WaitForSingleObject so the thread exits promptly.
    if (m_eventHandle) SetEvent(m_eventHandle);

    if (m_captureThread.joinable()) m_captureThread.join();

    if (m_audioClient) m_audioClient->Stop();

    std::cout << "[WASAPI] Capture stopped." << std::endl;
}

// -----------------------------------------------------------------------
// Capture loop — runs on a high-priority audio thread.
// -----------------------------------------------------------------------
void WasapiCapture::CaptureLoop() {
    // Elevate thread to audio priority to reduce scheduling jitter.
    DWORD taskIndex = 0;
    HANDLE avrtHandle = AvSetMmThreadCharacteristicsW(L"Audio", &taskIndex);

    const uint32_t bytesPerFrame = m_channels * (m_bitsPerSample / 8);
    const uint32_t silenceBytes  = SILENCE_FRAMES * bytesPerFrame;

    // Pre-built silence buffer (IEEE float zeros == regular zeros).
    std::vector<uint8_t> silenceBuf(silenceBytes, 0);

    while (m_running.load(std::memory_order_acquire)) {
        // Wait up to 20ms for new audio data.
        DWORD waitResult = WaitForSingleObject(m_eventHandle, 20);

        if (!m_running.load(std::memory_order_acquire)) break;

        if (waitResult == WAIT_TIMEOUT) {
            // ── Silence injection ──────────────────────────────────────
            // WASAPI stops signalling when no application is rendering.
            // We push a block of silent frames so the downstream pipeline
            // never starves (no audio dropouts on the client side).
            if (m_callback) {
                AudioFrame silent{};
                silent.data         = silenceBuf;
                silent.sampleRate   = m_sampleRate;
                silent.channels     = m_channels;
                silent.bitsPerSample = m_bitsPerSample;
                silent.numFrames    = SILENCE_FRAMES;
                silent.isSilence    = true;
                m_callback(silent);
            }
            continue;
        }

        // Drain all available packets from this wake-up.
        UINT32 packetFrames = 0;
        while (SUCCEEDED(m_captureClient->GetNextPacketSize(&packetFrames)) && packetFrames > 0) {
            BYTE*  data         = nullptr;
            UINT32 numFrames    = 0;
            DWORD  flags        = 0;

            HRESULT hr = m_captureClient->GetBuffer(&data, &numFrames, &flags, nullptr, nullptr);
            if (FAILED(hr)) break;

            const bool isSilent = (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0;
            const uint32_t byteCount = numFrames * bytesPerFrame;

            if (m_callback) {
                AudioFrame frame;
                frame.sampleRate    = m_sampleRate;
                frame.channels      = m_channels;
                frame.bitsPerSample = m_bitsPerSample;
                frame.numFrames     = numFrames;
                frame.isSilence     = isSilent;

                if (isSilent) {
                    frame.data.assign(byteCount, 0);
                } else {
                    frame.data.assign(data, data + byteCount);
                }
                m_callback(frame);
            }

            m_captureClient->ReleaseBuffer(numFrames);
        }
    }

    if (avrtHandle) AvRevertMmThreadCharacteristics(avrtHandle);
}
