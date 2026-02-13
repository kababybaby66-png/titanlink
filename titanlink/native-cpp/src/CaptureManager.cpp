#include "CaptureManager.h"
#include <iostream>
#include <chrono>

void CaptureManager::InitD3D11() {
    if (m_device) return;

    D3D_FEATURE_LEVEL featureLevels[] = { D3D_FEATURE_LEVEL_11_0 };
    D3D_FEATURE_LEVEL createdFeatureLevel;
    
    HRESULT hr = D3D11CreateDevice(
        nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 
        D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
        featureLevels, 1, D3D11_SDK_VERSION, 
        &m_device, &createdFeatureLevel, &m_context
    );
     // If fail, try without video support flag if needed, but NVENC likes having it? Not strictly required.
    if (FAILED(hr)) {
        throw std::runtime_error("D3D11CreateDevice failed");
    }
}

void CaptureManager::Start(const EncoderSettings& settings, uint32_t displayIndex, Napi::ThreadSafeFunction callback) {
    if (m_running) return;

    m_callback = callback;
    m_running = true;

    m_captureThread = std::thread([this, settings, displayIndex]() {
        CaptureLoop(settings, displayIndex);
    });
}

void CaptureManager::Stop() {
    m_running = false;
    if (m_captureThread.joinable()) {
        m_captureThread.join();
    }
    if (m_callback) {
        m_callback.Release();
    }
    // Cleanup D3D device if desired, but singleton usually keeps it alive
}

void CaptureManager::CaptureLoop(EncoderSettings settings, uint32_t displayIndex) {
    try {
        InitD3D11();
        
        DxgiCapturer capturer(m_device, m_context);
        if (!capturer.Init(displayIndex)) {
            // Callback error?
            std::cerr << "[CPP] Init Capturer Failed" << std::endl;
            m_running = false;
            return;
        }
        
        NvencEngine encoder;
        if (!encoder.Init(settings, m_device, m_context)) {
            std::cerr << "[CPP] Init Encoder Failed" << std::endl;
            m_running = false;
            return;
        }

        std::cout << "[CPP] Capture Loop Started." << std::endl;
        
        auto startTime = std::chrono::steady_clock::now();
        uint64_t frameCount = 0;

        while (m_running) {
            ComPtr<ID3D11Texture2D> frameTexture;
            
            // Wait up to 100ms for a frame
            if (capturer.CaptureFrame(frameTexture, 100)) {
                // Encode
                auto now = std::chrono::steady_clock::now();
                uint64_t timestamp = std::chrono::duration_cast<std::chrono::microseconds>(now - startTime).count();
                
                EncodedPacket packet;
                if (encoder.EncodeFrame(frameTexture, timestamp, packet)) {
                    // Send to JS
                    auto status = m_callback.BlockingCall([packet, frameCount](Napi::Env env, Napi::Function jsCallback) {
                        // Create JS object: { frame_number, timestamp_us, is_keyframe, data }
                        Napi::Object obj = Napi::Object::New(env);
                        obj.Set("frame_number", Napi::Number::New(env, frameCount));
                        obj.Set("timestamp_us", Napi::Number::New(env, (double)packet.timestamp));
                        obj.Set("is_keyframe", Napi::Boolean::New(env, packet.isKeyFrame));
                        
                        // Buffer
                        Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(env, packet.data.data(), packet.data.size());
                        obj.Set("data", buffer);
                        
                        jsCallback.Call({ obj });
                    });
                    
                    if (status != napi_ok) {
                         // JS thread might be terminating
                         // m_running = false; 
                    }
                    frameCount++;
                } else {
                    std::cerr << "[CPP] Encode failed" << std::endl;
                }
                
                capturer.ReleaseFrame();
            } else {
                // Timeout, no new frame, just continue or sleep a tiny bit
                // std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "[CPP] Capture Loop Exception: " << e.what() << std::endl;
    }
    
    std::cout << "[CPP] Capture Loop Ended." << std::endl;
}
