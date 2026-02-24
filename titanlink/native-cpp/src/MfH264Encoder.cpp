#include "MfH264Encoder.h"
#include <iostream>
#include <uuids.h>
#include <codecapi.h>
#include <strmif.h>

MfH264Encoder::MfH264Encoder() : m_width(0), m_height(0), m_frameDuration(0) {
}

MfH264Encoder::~MfH264Encoder() {
    Destroy();
}

void MfH264Encoder::Destroy() {
    if (m_encoder) {
        m_encoder->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
        m_encoder->ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
        m_encoder.Reset();
    }
    m_dxgiManager.Reset();
    m_inputTexture.Reset();
    MFShutdown();
}

bool MfH264Encoder::Init(const EncoderSettings& settings, ComPtr<ID3D11Device> device, ComPtr<ID3D11DeviceContext> context) {
    m_device = device;
    m_context = context;
    m_width = settings.width;
    m_height = settings.height;
    m_frameDuration = 10000000 / settings.fps;

    HRESULT hr = MFStartup(MF_VERSION);
    if (FAILED(hr)) return false;

    // Find HW Encoder
    MFT_REGISTER_TYPE_INFO infoOut = { MFMediaType_Video, MFVideoFormat_H264 };
    IMFActivate** ppActivate = nullptr;
    UINT32 count = 0;
    
    hr = MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER, nullptr, &infoOut, &ppActivate, &count);
    if (FAILED(hr) || count == 0) {
        std::cerr << "[CPP][MF] No HW H264 Encoder available." << std::endl;
        return false;
    }

    // Try to instantiate first valid encoder
    for (UINT32 i = 0; i < count; i++) {
        if (!m_encoder && SUCCEEDED(ppActivate[i]->ActivateObject(IID_PPV_ARGS(&m_encoder)))) {
            break;
        }
        ppActivate[i]->Release();
    }
    CoTaskMemFree(ppActivate);

    if (!m_encoder) {
        std::cerr << "[CPP][MF] Failed to activate MFT." << std::endl;
        return false;
    }

    // Set D3D Manager (Crucial for hardware acceleration)
    UINT resetToken = 0;
    hr = MFCreateDXGIDeviceManager(&resetToken, &m_dxgiManager);
    if (SUCCEEDED(hr)) {
        hr = m_dxgiManager->ResetDevice(m_device.Get(), resetToken);
        if (SUCCEEDED(hr)) {
            m_encoder->ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, reinterpret_cast<ULONG_PTR>(m_dxgiManager.Get()));
        }
    }

    // Set Output Type
    ComPtr<IMFMediaType> pOutType;
    MFCreateMediaType(&pOutType);
    pOutType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    pOutType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
    pOutType->SetUINT32(MF_MT_AVG_BITRATE, settings.bitrate);
    MFSetAttributeRatio(pOutType.Get(), MF_MT_FRAME_RATE, settings.fps, 1);
    MFSetAttributeSize(pOutType.Get(), MF_MT_FRAME_SIZE, m_width, m_height);
    pOutType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    
    hr = m_encoder->SetOutputType(0, pOutType.Get(), 0);
    if (FAILED(hr)) {
        std::cerr << "[CPP][MF] SetOutputType failed." << std::endl;
        return false;
    }

    // Set Input Type (ARGB32 maps to B8G8R8A8 on Windows)
    ComPtr<IMFMediaType> pInType;
    MFCreateMediaType(&pInType);
    pInType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    pInType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_ARGB32);
    pInType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    MFSetAttributeRatio(pInType.Get(), MF_MT_FRAME_RATE, settings.fps, 1);
    MFSetAttributeSize(pInType.Get(), MF_MT_FRAME_SIZE, m_width, m_height);

    hr = m_encoder->SetInputType(0, pInType.Get(), 0);
    if (FAILED(hr)) {
        // Fallback to NV12 could be attempted here if we had color conversion
        std::cerr << "[CPP][MF] SetInputType ARGB32 failed (GPU might need NV12)." << std::endl;
        return false;
    }

    // Low latency & CBR properties via ICodecAPI
    ComPtr<ICodecAPI> codecApi;
    if (SUCCEEDED(m_encoder.As(&codecApi))) {
        VARIANT var;
        VariantInit(&var);
        
        var.vt = VT_UI4;
        var.ulVal = eAVEncCommonRateControlMode_CBR;
        codecApi->SetValue(&CODECAPI_AVEncCommonRateControlMode, &var);

        var.vt = VT_BOOL;
        var.boolVal = VARIANT_TRUE;
        codecApi->SetValue(&CODECAPI_AVLowLatencyMode, &var);
    }

    m_encoder->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
    m_encoder->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
    m_encoder->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);

    return true;
}

bool MfH264Encoder::EncodeFrame(ComPtr<ID3D11Texture2D> texture, uint64_t timestamp, EncodedPacket& outPacket) {
    if (!m_encoder) return false;

    // Use zero-copy buffer approach matching D3D11 textures
    ComPtr<IMFMediaBuffer> pBuffer;
    HRESULT hr = MFCreateDXGISurfaceBuffer(__uuidof(ID3D11Texture2D), texture.Get(), 0, FALSE, &pBuffer);
    if (FAILED(hr)) return false;

    ComPtr<IMF2DBuffer> p2DBuffer;
    if (SUCCEEDED(pBuffer.As(&p2DBuffer))) {
        DWORD length = 0;
        p2DBuffer->GetContiguousLength(&length);
        pBuffer->SetCurrentLength(length);
    }

    ComPtr<IMFSample> pSample;
    MFCreateSample(&pSample);
    pSample->AddBuffer(pBuffer.Get());
    pSample->SetSampleTime(timestamp * 10);
    pSample->SetSampleDuration(m_frameDuration);

    hr = m_encoder->ProcessInput(0, pSample.Get(), 0);
    if (FAILED(hr)) return false;

    MFT_OUTPUT_DATA_BUFFER outputDataBuffer = { 0 };
    DWORD status = 0;
    
    // Check if MFT requires us to allocate the output sample
    MFT_OUTPUT_STREAM_INFO streamInfo;
    m_encoder->GetOutputStreamInfo(0, &streamInfo);
    if (!(streamInfo.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES) && (streamInfo.dwFlags & MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES) == 0) {
        ComPtr<IMFSample> pOutSample;
        MFCreateSample(&pOutSample);
        ComPtr<IMFMediaBuffer> pOutBuffer;
        MFCreateMemoryBuffer(streamInfo.cbSize, &pOutBuffer);
        pOutSample->AddBuffer(pOutBuffer.Get());
        outputDataBuffer.pSample = pOutSample.Detach();
    }

    hr = m_encoder->ProcessOutput(0, 1, &outputDataBuffer, &status);
    if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT) {
        return false;
    }
    
    // Process output
    bool result = false;
    if (SUCCEEDED(hr) && outputDataBuffer.pSample) {
        ComPtr<IMFSample> outSample;
        outSample.Attach(outputDataBuffer.pSample); 
        
        ComPtr<IMFMediaBuffer> bufferOut;
        if (SUCCEEDED(outSample->ConvertToContiguousBuffer(&bufferOut))) {
            BYTE* pData = nullptr;
            DWORD cbData = 0;
            if (SUCCEEDED(bufferOut->Lock(&pData, nullptr, &cbData))) {
                outPacket.data.assign(pData, pData + cbData);
                bufferOut->Unlock();
                
                UINT32 isKey = 0;
                outSample->GetUINT32(MFSampleExtension_CleanPoint, &isKey);
                outPacket.isKeyFrame = (isKey != 0);
                
                LONGLONG time = 0;
                outSample->GetSampleTime(&time);
                outPacket.timestamp = time / 10;
                
                result = true;
            }
        }
    }
    if (outputDataBuffer.pEvents) outputDataBuffer.pEvents->Release();
    return result;
}
