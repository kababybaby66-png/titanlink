#include "DxgiCapturer.h"
#include <iostream>
#include <algorithm>

using Microsoft::WRL::ComPtr;

DxgiCapturer::DxgiCapturer(ComPtr<ID3D11Device> device, ComPtr<ID3D11DeviceContext> context) 
    : m_device(device), m_context(context) {
    m_duplication = nullptr;
}

DxgiCapturer::~DxgiCapturer() {
    m_currentResource.Reset();
    m_duplication.Reset();
    m_stagedTexture.Reset();
}

std::vector<DisplayInfo> DxgiCapturer::EnumerateDisplays() {
    std::vector<DisplayInfo> displays;
    ComPtr<IDXGIFactory1> factory;
    ComPtr<IDXGIAdapter1> adapter;

    if (FAILED(CreateDXGIFactory1(__uuidof(IDXGIFactory1), (void**)&factory)))
        return displays;

    for (uint32_t i = 0; factory->EnumAdapters1(i, &adapter) != DXGI_ERROR_NOT_FOUND; ++i) {
        ComPtr<IDXGIOutput> output;
        for (uint32_t j = 0; adapter->EnumOutputs(j, &output) != DXGI_ERROR_NOT_FOUND; ++j) {
            DXGI_OUTPUT_DESC desc;
            output->GetDesc(&desc);
            
            // Convert wide string name
            std::wstring wname(desc.DeviceName);
            std::string name(wname.begin(), wname.end());

            long width = desc.DesktopCoordinates.right - desc.DesktopCoordinates.left;
            long height = desc.DesktopCoordinates.bottom - desc.DesktopCoordinates.top;
            
            // Primary if (0,0) is in coords
            bool isPrimary = (desc.DesktopCoordinates.top == 0 && desc.DesktopCoordinates.left == 0);

            displays.push_back({
                i * 10 + j, // Simple combined index (Adapter*10 + Output) for now
                name,
                (uint32_t)width,
                (uint32_t)height,
                isPrimary
            });
        }
    }
    return displays;
}

bool DxgiCapturer::Init(uint32_t displayIndex) {
    if (!m_device) return false;

    // Find the correct output
    ComPtr<IDXGIFactory1> factory;
    ComPtr<IDXGIAdapter1> adapter;
    ComPtr<IDXGIOutput> output;
    
    // Assuming IDXGIDevice for current device
    ComPtr<IDXGIDevice> dxgiDevice;
    m_device.As(&dxgiDevice);
    
    // Better: Duplicate output from the same Adapter that owns m_device
    ComPtr<IDXGIAdapter> deviceAdapter;
    dxgiDevice->GetAdapter(&deviceAdapter);
    
    // Enum outputs on the device's adapter
    if (deviceAdapter->EnumOutputs(displayIndex, &output) == DXGI_ERROR_NOT_FOUND) {
        // Fallback or bad index
        std::cerr << "[CPP CAPTURE] Display index " << displayIndex << " not found on device adapter." << std::endl;
        return false; 
    }

    ComPtr<IDXGIOutput1> output1;
    if (FAILED(output.As(&output1))) {
        std::cerr << "[CPP CAPTURE] Failed to get Output1 interface." << std::endl;
        return false;
    }

    m_duplication.Reset();
    HRESULT hr = output1->DuplicateOutput(m_device.Get(), &m_duplication);
    if (FAILED(hr)) {
        if (hr == DXGI_ERROR_ACCESS_LOST) {
             // Access lost (e.g. UAC prompt, lock screen), retry logic needed usually
             std::cerr << "[CPP CAPTURE] DuplicateOutput: ACCESS_LOST." << std::endl;
        } else if (hr == E_ACCESSDENIED) {
             std::cerr << "[CPP CAPTURE] DuplicateOutput: ACCESS_DENIED (Running as different user?)." << std::endl;
        } else {
             std::cerr << "[CPP CAPTURE] DuplicateOutput failed: 0x" << std::hex << hr << std::dec << std::endl;
        }
        return false;
    }

    return true;
}

bool DxgiCapturer::CaptureFrame(ComPtr<ID3D11Texture2D>& texture, int timeoutMs) {
    if (!m_duplication) return false;

    DXGI_OUTDUPL_FRAME_INFO frameInfo;
    ComPtr<IDXGIResource> desktopResource;
    m_currentResource.Reset(); // Release previous frame reference

    HRESULT hr = m_duplication->AcquireNextFrame(timeoutMs, &frameInfo, &desktopResource);
    if (hr == DXGI_ERROR_WAIT_TIMEOUT) {
        return false; // No new frame or timeout
    }
    if (FAILED(hr)) {
        // Handle DXGI_ERROR_ACCESS_LOST, etc.
        std::cerr << "[CPP CAPTURE] AcquireNextFrame failed 0x" << std::hex << hr << std::dec << std::endl;
        if (hr == DXGI_ERROR_ACCESS_LOST) {
             // Should trigger re-init
             m_duplication.Reset(); 
        }
        return false;
    }

    m_currentResource = desktopResource;

    // Get the texture interface from the resource
    ComPtr<ID3D11Texture2D> desktopImage;
    hr = desktopResource.As(&desktopImage);
    if (FAILED(hr)) {
        m_duplication->ReleaseFrame();
        return false;
    }

    texture = desktopImage;
    
    // TODO: UpdateCursor(frameInfo); // Draw cursor into texture if requested
    
    // IMPORTANT: In a real world, you might want to copy this to a stable texture if Acquire/Release cycle is tight 
    // or if the texture format varies. But for zero-copy, usually we pass this texture directly to encoder.
    // However, NvencEncoder usually registers the input ONCE.
    // Desktop Duplication textures CHANGE every frame (different resource from swap chain).
    // So we CANNOT use `nvEncRegisterResource` once. We must Register every frame (slow) OR copy to a static texture.
    // Copying on GPU is very fast. 
    // Let's modify logic: Return the captured texture, but caller should copy it to a REGISTERED texture.
    
    return true;
}

void DxgiCapturer::ReleaseFrame() {
    if (m_duplication) {
        m_duplication->ReleaseFrame();
    }
    m_currentResource.Reset();
}
