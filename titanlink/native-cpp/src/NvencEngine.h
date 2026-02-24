#pragma once
#include <d3d11.h>
#include <dxgi1_2.h>
#include <vector>
#include <string>
#include <wrl/client.h>
#include "nvEncodeAPI.h"

using Microsoft::WRL::ComPtr;

#include "EncoderTypes.h"

class NvencEngine {
public:
    NvencEngine();
    ~NvencEngine();

    bool Init(const EncoderSettings& settings, ComPtr<ID3D11Device> device, ComPtr<ID3D11DeviceContext> context);
    bool EncodeFrame(ComPtr<ID3D11Texture2D> texture, uint64_t timestamp, EncodedPacket& outPacket);
    void Destroy();

private:
   ComPtr<ID3D11Device> m_device;
   ComPtr<ID3D11DeviceContext> m_context;
   NV_ENCODE_API_FUNCTION_LIST m_nvenc;
   void* m_encoder;
   
   uint32_t m_width;
   uint32_t m_height;
   
   // Resources
   ComPtr<ID3D11Texture2D> m_inputTexture;
   NV_ENC_REGISTERED_PTR m_registeredResource;
   NV_ENC_INPUT_PTR m_mappedInput;
   NV_ENC_OUTPUT_PTR m_outputBitstream;

   void LoadNvEncAPI();
   bool CreateInputResources(uint32_t width, uint32_t height);
   bool CreateOutputResources();
};
