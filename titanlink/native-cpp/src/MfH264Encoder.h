#pragma once
#include <d3d11.h>
#include <wrl/client.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mferror.h>
#include "EncoderTypes.h"
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "mf.lib")

using Microsoft::WRL::ComPtr;

class MfH264Encoder {
public:
    MfH264Encoder();
    ~MfH264Encoder();

    bool Init(const EncoderSettings& settings, ComPtr<ID3D11Device> device, ComPtr<ID3D11DeviceContext> context);
    bool EncodeFrame(ComPtr<ID3D11Texture2D> texture, uint64_t timestamp, EncodedPacket& outPacket);
    void Destroy();

private:
   ComPtr<ID3D11Device> m_device;
   ComPtr<ID3D11DeviceContext> m_context;
   ComPtr<IMFTransform> m_encoder;
   ComPtr<IMFDXGIDeviceManager> m_dxgiManager;

   ComPtr<ID3D11Texture2D> m_inputTexture;

   uint32_t m_width;
   uint32_t m_height;
   uint64_t m_frameDuration;
};
