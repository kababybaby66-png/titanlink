#pragma once
#include <napi.h>
#include <thread>
#include <atomic>
#include <memory>
#include "DxgiCapturer.h"
#include "NvencEngine.h"

class CaptureManager {
public:
    static CaptureManager& GetInstance() {
        static CaptureManager instance;
        return instance;
    }

    void Start(const EncoderSettings& settings, uint32_t displayIndex, Napi::ThreadSafeFunction callback);
    void Stop();
    bool IsRunning() const { return m_running; }

private:
   CaptureManager() : m_running(false) {}
   ~CaptureManager() { Stop(); }

   std::atomic<bool> m_running;
   std::thread m_captureThread;
   Napi::ThreadSafeFunction m_callback;
   
   void CaptureLoop(EncoderSettings settings, uint32_t displayIndex);
   
   // D3D11 setup is shared or created here
   ComPtr<ID3D11Device> m_device;
   ComPtr<ID3D11DeviceContext> m_context;
   
   void InitD3D11();
};
