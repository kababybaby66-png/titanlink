#include "NvencEncoder.h"
#include <iostream>
#include <Windows.h>

// Removed manual NVENCAPI_STRUCT_VERSION macro definition as it is handled by the header.

Napi::FunctionReference NvencEncoder::constructor;

Napi::Object NvencEncoder::Init(Napi::Env env, Napi::Object exports) {
    Napi::HandleScope scope(env);

    Napi::Function func = DefineClass(env, "NvencEncoder", {
        InstanceMethod("openSession", &NvencEncoder::OpenSession),
        InstanceMethod("closeSession", &NvencEncoder::CloseSession)
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("NvencEncoder", func);
    return exports;
}

NvencEncoder::NvencEncoder(const Napi::CallbackInfo& info) : Napi::ObjectWrap<NvencEncoder>(info) {
    Napi::Env env = info.Env();
    m_encoder = nullptr;
    m_nvenc = { 0 };
    m_registeredResource = nullptr;
    m_mappedInput = nullptr;
    m_outputBitstream = nullptr;
    m_completionEvent = nullptr;

    try {
        InitD3D11();
        LoadNvEncAPI();
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
    }
}

NvencEncoder::~NvencEncoder() {
    CleanupResources();
    if (m_encoder && m_nvenc.nvEncDestroyEncoder) {
        m_nvenc.nvEncDestroyEncoder(m_encoder);
    }
    m_d3d_context.Reset();
    m_d3d_device.Reset();
}

void NvencEncoder::InitD3D11() {
    D3D_FEATURE_LEVEL featureLevels[] = { D3D_FEATURE_LEVEL_11_0 };
    D3D_FEATURE_LEVEL createdFeatureLevel;
    
    HRESULT hr = D3D11CreateDevice(
        nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 
        D3D11_CREATE_DEVICE_VIDEO_SUPPORT, 
        featureLevels, 1, D3D11_SDK_VERSION, 
        &m_d3d_device, &createdFeatureLevel, &m_d3d_context
    );

    if (FAILED(hr)) {
        throw std::runtime_error("Failed to create D3D11 device. Ensure you have a GPU with DX11 support.");
    }
}

typedef NVENCSTATUS(NVENCAPI* PNVENCODEAPICREATEINSTANCE)(NV_ENCODE_API_FUNCTION_LIST* functionList);

void NvencEncoder::LoadNvEncAPI() {
    HMODULE hModule = LoadLibraryA("nvEncodeAPI64.dll");
    if (!hModule) {
         hModule = LoadLibraryA("nvEncodeAPI.dll");
         if (!hModule) throw std::runtime_error("Failed to load nvEncodeAPI.dll");
    }

    PNVENCODEAPICREATEINSTANCE nvEncCreateInstance = 
        (PNVENCODEAPICREATEINSTANCE)GetProcAddress(hModule, "NvEncodeAPICreateInstance");

    if (!nvEncCreateInstance) {
        throw std::runtime_error("NvEncodeAPICreateInstance not found in DLL");
    }

    m_nvenc.version = NV_ENCODE_API_FUNCTION_LIST_VER;
    if (nvEncCreateInstance(&m_nvenc) != NV_ENC_SUCCESS) {
        throw std::runtime_error("NvEncodeAPICreateInstance failed (version mismatch?)");
    }
}

Napi::Value NvencEncoder::OpenSession(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::Error::New(env, "Expected settings object").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object sett = info[0].As<Napi::Object>();
    uint32_t width = sett.Get("width").ToNumber().Uint32Value();
    uint32_t height = sett.Get("height").ToNumber().Uint32Value();
    uint32_t bitrate = sett.Has("bitrate") ? sett.Get("bitrate").ToNumber().Uint32Value() : 5000000;
    uint32_t fps = sett.Has("fps") ? sett.Get("fps").ToNumber().Uint32Value() : 60;
    
    m_width = width;
    m_height = height;

    NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS sessionParams = { 0 };
    sessionParams.version = NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS_VER;
    sessionParams.deviceType = NV_ENC_DEVICE_TYPE_DIRECTX;
    sessionParams.device = m_d3d_device.Get();
    sessionParams.apiVersion = NVENCAPI_VERSION; 

    NVENCSTATUS status = m_nvenc.nvEncOpenEncodeSessionEx(&sessionParams, &m_encoder);
    
    if (status != NV_ENC_SUCCESS) {
        std::string msg = "nvEncOpenEncodeSessionEx failed with status: " + std::to_string(status);
        Napi::Error::New(env, msg).ThrowAsJavaScriptException();
        return env.Null();
    }

    // Initialize Encoder Config
    NV_ENC_INITIALIZE_PARAMS initParams = { 0 };
    initParams.version = NV_ENC_INITIALIZE_PARAMS_VER;
    initParams.encodeGUID = NV_ENC_CODEC_H264_GUID;
    initParams.presetGUID = NV_ENC_PRESET_P1_GUID; // P1 is optimized for performance/latency
    initParams.tuningInfo = NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY; // Required for P-State presets
    initParams.encodeWidth = width;
    initParams.encodeHeight = height;
    initParams.darWidth = width;
    initParams.darHeight = height;
    initParams.frameRateNum = fps;
    initParams.frameRateDen = 1;
    initParams.enablePTD = 1;
    initParams.maxEncodeWidth = width;
    initParams.maxEncodeHeight = height;
    
    NV_ENC_CONFIG encConfig = { 0 };
    encConfig.version = NV_ENC_CONFIG_VER;
    encConfig.profileGUID = NV_ENC_H264_PROFILE_HIGH_GUID;
    initParams.encodeConfig = &encConfig;
    
    // Get preset config using modern Ex API
    NV_ENC_PRESET_CONFIG presetConfig = { 0 };
    presetConfig.version = NV_ENC_PRESET_CONFIG_VER;
    presetConfig.presetCfg.version = NV_ENC_CONFIG_VER;
    
    status = m_nvenc.nvEncGetEncodePresetConfigEx(m_encoder, NV_ENC_CODEC_H264_GUID, NV_ENC_PRESET_P1_GUID, NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY, &presetConfig);
    if (status != NV_ENC_SUCCESS) {
        // Fallback for older drivers/compatibility if Ex fails
        status = m_nvenc.nvEncGetEncodePresetConfig(m_encoder, NV_ENC_CODEC_H264_GUID, NV_ENC_PRESET_P1_GUID, &presetConfig);
        if (status != NV_ENC_SUCCESS) {
            Napi::Error::New(env, "Failed to get preset config").ThrowAsJavaScriptException();
            return env.Null();
        }
    }
    
    memcpy(&encConfig, &presetConfig.presetCfg, sizeof(NV_ENC_CONFIG));
    
    // Low Latency Tuning
    encConfig.rcParams.rateControlMode = NV_ENC_PARAMS_RC_CBR;
    encConfig.rcParams.multiPass = NV_ENC_MULTI_PASS_DISABLED; // Disable multipass for lowest latency
    encConfig.rcParams.averageBitRate = bitrate;
    encConfig.rcParams.maxBitRate = bitrate;
    encConfig.rcParams.vbvBufferSize = bitrate;    
    encConfig.rcParams.vbvInitialDelay = bitrate; 
    encConfig.rcParams.lowDelayKeyFrameScale = 1;

    initParams.encodeConfig = &encConfig;

    status = m_nvenc.nvEncInitializeEncoder(m_encoder, &initParams);
    if (status != NV_ENC_SUCCESS) {
        std::string msg = "nvEncInitializeEncoder failed with status: " + std::to_string(status);
        Napi::Error::New(env, msg).ThrowAsJavaScriptException();
        return env.Null();
    }

    // Create Input/Output Resources
    if (!CreateInputResources(width, height)) {
        Napi::Error::New(env, "Failed to create input resources").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!CreateOutputResources()) {
        Napi::Error::New(env, "Failed to create output resources").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    return Napi::Boolean::New(env, true);
}

Napi::Value NvencEncoder::CloseSession(const Napi::CallbackInfo& info) {
    CleanupResources();
    return info.Env().Undefined();
}

bool NvencEncoder::CreateInputResources(uint32_t width, uint32_t height) {
    D3D11_TEXTURE2D_DESC desc = { 0 };
    desc.Width = width;
    desc.Height = height;
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_DEFAULT;
    desc.BindFlags = D3D11_BIND_RENDER_TARGET;

    if (FAILED(m_d3d_device->CreateTexture2D(&desc, nullptr, &m_inputTexture))) {
        return false;
    }

    NV_ENC_REGISTER_RESOURCE registerRes = { 0 };
    registerRes.version = NV_ENC_REGISTER_RESOURCE_VER;
    registerRes.resourceType = NV_ENC_INPUT_RESOURCE_TYPE_DIRECTX;
    registerRes.width = width;
    registerRes.height = height;
    registerRes.resourceToRegister = (void*)m_inputTexture.Get();
    registerRes.bufferFormat = NV_ENC_BUFFER_FORMAT_ARGB; 
    registerRes.bufferUsage = NV_ENC_INPUT_IMAGE;
    
    if (m_nvenc.nvEncRegisterResource(m_encoder, &registerRes) != NV_ENC_SUCCESS) {
        return false;
    }
    
    m_registeredResource = registerRes.registeredResource;
    return true;
}

bool NvencEncoder::CreateOutputResources() {
    NV_ENC_CREATE_BITSTREAM_BUFFER createBitstreamBuffer = { 0 };
    createBitstreamBuffer.version = NV_ENC_CREATE_BITSTREAM_BUFFER_VER;
    
    if (m_nvenc.nvEncCreateBitstreamBuffer(m_encoder, &createBitstreamBuffer) != NV_ENC_SUCCESS) {
        return false;
    }
    
    m_outputBitstream = createBitstreamBuffer.bitstreamBuffer;
    return true;
}

void NvencEncoder::CleanupResources() {
    if (m_registeredResource) {
        m_nvenc.nvEncUnregisterResource(m_encoder, m_registeredResource);
        m_registeredResource = nullptr;
    }
    if (m_mappedInput) {
        m_nvenc.nvEncUnmapInputResource(m_encoder, m_mappedInput);
        m_mappedInput = nullptr;
    }
    if (m_outputBitstream) {
        m_nvenc.nvEncDestroyBitstreamBuffer(m_encoder, m_outputBitstream);
        m_outputBitstream = nullptr;
    }
    m_inputTexture.Reset();
}

bool NvencEncoder::EncodeTexture(ID3D11Texture2D* source, uint64_t timestamp) {
    if (!m_encoder || !m_registeredResource || !m_outputBitstream) return false;

    m_d3d_context->CopyResource(m_inputTexture.Get(), source);

    NV_ENC_MAP_INPUT_RESOURCE mapInput = { 0 };
    mapInput.version = NV_ENC_MAP_INPUT_RESOURCE_VER;
    mapInput.registeredResource = m_registeredResource;
    
    if (m_nvenc.nvEncMapInputResource(m_encoder, &mapInput) != NV_ENC_SUCCESS) {
        return false;
    }
    
    m_mappedInput = mapInput.mappedResource;

    NV_ENC_PIC_PARAMS picParams = { 0 };
    picParams.version = NV_ENC_PIC_PARAMS_VER;
    picParams.pictureStruct = NV_ENC_PIC_STRUCT_FRAME;
    picParams.inputBuffer = m_mappedInput;
    picParams.bufferFmt = NV_ENC_BUFFER_FORMAT_ARGB;
    picParams.inputWidth = m_width;
    picParams.inputHeight = m_height;
    picParams.outputBitstream = m_outputBitstream;
    
    NVENCSTATUS status = m_nvenc.nvEncEncodePicture(m_encoder, &picParams);
    
    if (status != NV_ENC_SUCCESS) {
         m_nvenc.nvEncUnmapInputResource(m_encoder, m_mappedInput);
         m_mappedInput = nullptr;
         return false;
    }
    
    NV_ENC_LOCK_BITSTREAM lockBitstream = { 0 };
    lockBitstream.version = NV_ENC_LOCK_BITSTREAM_VER;
    lockBitstream.outputBitstream = m_outputBitstream;
    lockBitstream.doNotWait = 0;
    
    status = m_nvenc.nvEncLockBitstream(m_encoder, &lockBitstream);
    if (status != NV_ENC_SUCCESS) {
        m_nvenc.nvEncUnmapInputResource(m_encoder, m_mappedInput);
        m_mappedInput = nullptr;
        return false;
    }
    
    m_nvenc.nvEncUnlockBitstream(m_encoder, m_outputBitstream);
    m_nvenc.nvEncUnmapInputResource(m_encoder, m_mappedInput);
    m_mappedInput = nullptr;

    return true;
}
