#include "NvencEngine.h"
#include <iostream>
#include <Windows.h>

// Removed manual NVENCAPI_STRUCT_VERSION macro definition as it is handled by the header.

typedef NVENCSTATUS(NVENCAPI* PNVENCODEAPICREATEINSTANCE)(NV_ENCODE_API_FUNCTION_LIST* functionList);

NvencEngine::NvencEngine() : m_encoder(nullptr), m_registeredResource(nullptr), m_mappedInput(nullptr), m_outputBitstream(nullptr) {
    m_nvenc = { 0 };
}

NvencEngine::~NvencEngine() {
    Destroy();
}

void NvencEngine::Destroy() {
    if (m_registeredResource) { m_nvenc.nvEncUnregisterResource(m_encoder, m_registeredResource); m_registeredResource = nullptr; }
    if (m_mappedInput) { m_nvenc.nvEncUnmapInputResource(m_encoder, m_mappedInput); m_mappedInput = nullptr; }
    if (m_outputBitstream) { m_nvenc.nvEncDestroyBitstreamBuffer(m_encoder, m_outputBitstream); m_outputBitstream = nullptr; }
    if (m_encoder) { m_nvenc.nvEncDestroyEncoder(m_encoder); m_encoder = nullptr; }
    m_inputTexture.Reset();
    m_device.Reset();
    m_context.Reset();
}

void NvencEngine::LoadNvEncAPI() {
    HMODULE hModule = LoadLibraryA("nvEncodeAPI64.dll");
    if (!hModule) { hModule = LoadLibraryA("nvEncodeAPI.dll"); }
    if (!hModule) throw std::runtime_error("Failed to load nvEncodeAPI.dll");

    PNVENCODEAPICREATEINSTANCE nvEncCreateInstance = (PNVENCODEAPICREATEINSTANCE)GetProcAddress(hModule, "NvEncodeAPICreateInstance");
    if (!nvEncCreateInstance) throw std::runtime_error("NvEncodeAPICreateInstance not found");

    m_nvenc.version = NV_ENCODE_API_FUNCTION_LIST_VER;
    if (nvEncCreateInstance(&m_nvenc) != NV_ENC_SUCCESS) throw std::runtime_error("NvEncodeAPICreateInstance failed");
}

bool NvencEngine::Init(const EncoderSettings& settings, ComPtr<ID3D11Device> device, ComPtr<ID3D11DeviceContext> context) {
    m_device = device;
    m_context = context;
    m_width = settings.width;
    m_height = settings.height;

    try {
        LoadNvEncAPI();
    } catch (...) { return false; }

    NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS sessionParams = { 0 };
    sessionParams.version = NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS_VER;
    sessionParams.deviceType = NV_ENC_DEVICE_TYPE_DIRECTX;
    sessionParams.device = m_device.Get();
    // Use the version macro from the header file, assuming header matches SDK version.
    // If runtime error 15 occurs, it means the installed driver is older than the SDK header version.
    // For wider compatibility, we can force a slightly older version if necessary, but per instructions we align with SDK.
    sessionParams.apiVersion = NVENCAPI_VERSION; 

    int status = m_nvenc.nvEncOpenEncodeSessionEx(&sessionParams, &m_encoder);
    if (status != NV_ENC_SUCCESS) {
        std::cout << "[CPP][Nvenc] Open Session Failed: " << status << std::endl;
        return false;
    }

    NV_ENC_INITIALIZE_PARAMS initParams = { 0 };
    initParams.version = NV_ENC_INITIALIZE_PARAMS_VER;
    initParams.encodeGUID = NV_ENC_CODEC_H264_GUID;
    initParams.presetGUID = NV_ENC_PRESET_P1_GUID; // P1 is High Performance
    initParams.tuningInfo = NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY; // MANDATORY for P-State presets
    initParams.encodeWidth = m_width;
    initParams.encodeHeight = m_height;
    initParams.darWidth = m_width;
    initParams.darHeight = m_height;
    initParams.frameRateNum = settings.fps;
    initParams.frameRateDen = 1;
    initParams.enablePTD = 1;
    initParams.maxEncodeWidth = m_width;
    initParams.maxEncodeHeight = m_height;
    
    NV_ENC_CONFIG encConfig = { 0 };
    encConfig.version = NV_ENC_CONFIG_VER;
    encConfig.profileGUID = NV_ENC_H264_PROFILE_HIGH_GUID;
    
    // Preset Config
    NV_ENC_PRESET_CONFIG presetConfig = { 0 };
    presetConfig.version = NV_ENC_PRESET_CONFIG_VER;
    presetConfig.presetCfg.version = NV_ENC_CONFIG_VER;
    
    // Pass tuning info here as well
    if (m_nvenc.nvEncGetEncodePresetConfigEx(m_encoder, NV_ENC_CODEC_H264_GUID, NV_ENC_PRESET_P1_GUID, NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY, &presetConfig) == NV_ENC_SUCCESS) {
        memcpy(&encConfig, &presetConfig.presetCfg, sizeof(NV_ENC_CONFIG));
    } else {
        // Fallback to old API if Ex not available, or just log error
        if (m_nvenc.nvEncGetEncodePresetConfig(m_encoder, NV_ENC_CODEC_H264_GUID, NV_ENC_PRESET_P1_GUID, &presetConfig) == NV_ENC_SUCCESS) {
             memcpy(&encConfig, &presetConfig.presetCfg, sizeof(NV_ENC_CONFIG));
        } else {
             std::cout << "[CPP][Nvenc] Failed to get preset config" << std::endl;
        }
    }
    
    encConfig.rcParams.rateControlMode = NV_ENC_PARAMS_RC_CBR;
    encConfig.rcParams.multiPass = NV_ENC_MULTI_PASS_DISABLED; // Disable multipass for low latency
    encConfig.rcParams.averageBitRate = settings.bitrate;
    encConfig.rcParams.maxBitRate = settings.bitrate;
    encConfig.rcParams.vbvBufferSize = settings.bitrate;
    encConfig.rcParams.lowDelayKeyFrameScale = 1; 

    // Repeat SPS/PPS headers before every IDR frame (essential for mid-stream join)
    encConfig.encodeCodecConfig.h264Config.repeatSPSPPS = 1;
    encConfig.encodeCodecConfig.h264Config.idrPeriod = settings.fps * 2; // IDR every 2 seconds
    encConfig.gopLength = settings.fps * 2;

    initParams.encodeConfig = &encConfig;

    status = m_nvenc.nvEncInitializeEncoder(m_encoder, &initParams);
    if (status != NV_ENC_SUCCESS) {
        std::cout << "[CPP][Nvenc] Initialize Encoder Failed: " << status << std::endl;
        return false;
    }

    if (!CreateInputResources(m_width, m_height)) {
        std::cout << "[CPP][Nvenc] Create Input Resources Failed" << std::endl;
        return false;
    }
    if (!CreateOutputResources()) {
        std::cout << "[CPP][Nvenc] Create Output Resources Failed" << std::endl;
        return false;
    }

    std::cout << "[CPP][Nvenc] Initialized Successfully" << std::endl;
    return true;
}

bool NvencEngine::CreateInputResources(uint32_t width, uint32_t height) {
    D3D11_TEXTURE2D_DESC desc = { 0 };
    desc.Width = width;
    desc.Height = height;
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_DEFAULT;
    desc.BindFlags = D3D11_BIND_RENDER_TARGET;
    
    if (FAILED(m_device->CreateTexture2D(&desc, nullptr, &m_inputTexture))) return false;

    NV_ENC_REGISTER_RESOURCE registerRes = { 0 };
    registerRes.version = NV_ENC_REGISTER_RESOURCE_VER;
    registerRes.resourceType = NV_ENC_INPUT_RESOURCE_TYPE_DIRECTX;
    registerRes.width = width;
    registerRes.height = height;
    registerRes.resourceToRegister = (void*)m_inputTexture.Get();
    registerRes.bufferFormat = NV_ENC_BUFFER_FORMAT_ARGB; 
    registerRes.bufferUsage = NV_ENC_INPUT_IMAGE;
    
    if (m_nvenc.nvEncRegisterResource(m_encoder, &registerRes) != NV_ENC_SUCCESS) return false;
    m_registeredResource = registerRes.registeredResource;
    return true;
}

bool NvencEngine::CreateOutputResources() {
    NV_ENC_CREATE_BITSTREAM_BUFFER createBitstreamBuffer = { 0 };
    createBitstreamBuffer.version = NV_ENC_CREATE_BITSTREAM_BUFFER_VER;
    if (m_nvenc.nvEncCreateBitstreamBuffer(m_encoder, &createBitstreamBuffer) != NV_ENC_SUCCESS) return false;
    m_outputBitstream = createBitstreamBuffer.bitstreamBuffer;
    return true;
}

bool NvencEngine::EncodeFrame(ComPtr<ID3D11Texture2D> texture, uint64_t timestamp, EncodedPacket& outPacket) {
    if (!m_encoder || !m_registeredResource || !m_outputBitstream) return false;

    m_context->CopyResource(m_inputTexture.Get(), texture.Get());

    NV_ENC_MAP_INPUT_RESOURCE mapInput = { 0 };
    mapInput.version = NV_ENC_MAP_INPUT_RESOURCE_VER;
    mapInput.registeredResource = m_registeredResource;
    
    if (m_nvenc.nvEncMapInputResource(m_encoder, &mapInput) != NV_ENC_SUCCESS) return false;
    m_mappedInput = mapInput.mappedResource;

    NV_ENC_PIC_PARAMS picParams = { 0 };
    picParams.version = NV_ENC_PIC_PARAMS_VER;
    picParams.pictureStruct = NV_ENC_PIC_STRUCT_FRAME;
    picParams.inputBuffer = m_mappedInput;
    picParams.bufferFmt = NV_ENC_BUFFER_FORMAT_ARGB;
    picParams.inputWidth = m_width;
    picParams.inputHeight = m_height;
    picParams.outputBitstream = m_outputBitstream;

    if (m_nvenc.nvEncEncodePicture(m_encoder, &picParams) != NV_ENC_SUCCESS) {
         m_nvenc.nvEncUnmapInputResource(m_encoder, m_mappedInput);
         m_mappedInput = nullptr;
         return false;
    }
    
    NV_ENC_LOCK_BITSTREAM lockBitstream = { 0 };
    lockBitstream.version = NV_ENC_LOCK_BITSTREAM_VER;
    lockBitstream.outputBitstream = m_outputBitstream;
    lockBitstream.doNotWait = 0;
    
    if (m_nvenc.nvEncLockBitstream(m_encoder, &lockBitstream) != NV_ENC_SUCCESS) {
        m_nvenc.nvEncUnmapInputResource(m_encoder, m_mappedInput);
        m_mappedInput = nullptr;
        return false;
    }
    
    // Copy data
    outPacket.data.resize(lockBitstream.bitstreamSizeInBytes);
    memcpy(outPacket.data.data(), lockBitstream.bitstreamBufferPtr, lockBitstream.bitstreamSizeInBytes);
    outPacket.isKeyFrame = (lockBitstream.pictureType == NV_ENC_PIC_TYPE_IDR || lockBitstream.pictureType == NV_ENC_PIC_TYPE_I);
    outPacket.timestamp = timestamp;
    
    m_nvenc.nvEncUnlockBitstream(m_encoder, m_outputBitstream);
    m_nvenc.nvEncUnmapInputResource(m_encoder, m_mappedInput);
    m_mappedInput = nullptr;

    return true;
}
