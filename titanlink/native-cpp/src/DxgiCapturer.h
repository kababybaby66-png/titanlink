#pragma once
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wrl/client.h>
#include <vector>
#include <string>

using Microsoft::WRL::ComPtr;

struct DisplayInfo {
    uint32_t index;
    std::string name;
    uint32_t width;
    uint32_t height;
    bool isPrimary;
};

class DxgiCapturer {
public:
    DxgiCapturer(ComPtr<ID3D11Device> device, ComPtr<ID3D11DeviceContext> context);
    ~DxgiCapturer();

    bool Init(uint32_t displayIndex);
    
    // Captures the latest frame. 
    // Returns true if a frame was captured, false otherwise (timeout/no update).
    // The captured texture is returned in 'texture'.
    // If 'texture' is updated, it stays valid until ReleaseFrame is called.
    bool CaptureFrame(ComPtr<ID3D11Texture2D>& texture, int timeoutMs = 100);
    void ReleaseFrame();

    static std::vector<DisplayInfo> EnumerateDisplays();

private:
   ComPtr<ID3D11Device> m_device;
   ComPtr<ID3D11DeviceContext> m_context;
   ComPtr<IDXGIOutputDuplication> m_duplication;
   ComPtr<ID3D11Texture2D> m_stagedTexture; // For cursor drawing if needed
   
   // Current frame resource (keep alive until next capture)
   ComPtr<IDXGIResource> m_currentResource;

   // Cursor drawing helpers (if we implement it)
   void UpdateCursor(const DXGI_OUTDUPL_FRAME_INFO& frameInfo);
};
