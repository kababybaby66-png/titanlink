#pragma once
#include <napi.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <vector>
#include <wrl/client.h>
#include "nvEncodeAPI.h"

using Microsoft::WRL::ComPtr;

class NvencEncoder : public Napi::ObjectWrap<NvencEncoder> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    NvencEncoder(const Napi::CallbackInfo& info);
    ~NvencEncoder();

    // Setup helper methods
    ComPtr<ID3D11Device> GetDevice() const { return m_d3d_device; }
    ComPtr<ID3D11DeviceContext> GetContext() const { return m_d3d_context; }
    
    // Internal encoding method for pipeline use
    bool EncodeTexture(ID3D11Texture2D* source, uint64_t timestamp);

private:
    static Napi::FunctionReference constructor;

    NV_ENCODE_API_FUNCTION_LIST m_nvenc;
    ComPtr<ID3D11Device> m_d3d_device;
    ComPtr<ID3D11DeviceContext> m_d3d_context;
    
    void* m_encoder;
    uint32_t m_width;
    uint32_t m_height;
    
    // Captured texture management
    ComPtr<ID3D11Texture2D> m_inputTexture;
    NV_ENC_REGISTERED_PTR m_registeredResource;
    NV_ENC_INPUT_PTR m_mappedInput;
    
    // Output management
    NV_ENC_OUTPUT_PTR m_outputBitstream;
    
    void* m_completionEvent; // For async events if needed

    Napi::Value OpenSession(const Napi::CallbackInfo& info);
    Napi::Value CloseSession(const Napi::CallbackInfo& info);
    
    // Internal helpers
    void LoadNvEncAPI();
    void InitD3D11();
    bool CreateInputResources(uint32_t width, uint32_t height);
    bool CreateOutputResources();
    void CleanupResources();
};
