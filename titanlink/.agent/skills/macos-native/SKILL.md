---
description: Comprehensive plan and guidelines for implementing macOS Host and Client support for TitanLink.
---

# macOS Native Implementation Plan (TitanLink)

This skill document outlines the architecture, requirements, and step-by-step plan for making TitanLink fully functional on macOS, supporting both **Client (Guest)** and **Host (Server)** capabilities.

## 🎯 Goal
Transform TitanLink from a Windows-exclusive application into a cross-platform (Windows & macOS) client and host, utilizing high-performance native Apple APIs.

---

## 🏗️ Architecture Differences (Windows vs. macOS)

| Component | Windows (Current) | macOS (Planned) |
| :--- | :--- | :--- |
| **Video Capture** | DirectX / Desktop Duplication | `ScreenCaptureKit` (macOS 12.3+) |
| **Hardware Encoder** | NVENC (Nvidia) | `VideoToolbox` (Apple Silicon / Intel Quicksync) |
| **Audio Capture** | WASAPI Loopback | `CoreAudio` / `ScreenCaptureKit` Audio |
| **Networking** | Rust UDP Socket | Rust UDP Socket (Cross-compile to `darwin-arm64` / `darwin-x64`) |
| **Video Decode** | Pre-compiled Windows Binary | `VideoToolbox` (Hardware Decode) |
| **Controller Emulation**| ViGEmBus | Virtual HID / `IOHIDKit` (Complex, requires kext or DriverKit) |

---

## 📋 Phase 1: macOS Client (Joining a host)

To allow a Mac to connect to a Windows Host and play smoothly, we need to handle networking, decoding, and input sending.

### Step 1: Cross-compile the Rust Networking Module
*   **Task:** Compile the `titanlink-capture` Rust binary for macOS.
*   **Details:** Add target architectures `x86_64-apple-darwin` (Intel) and `aarch64-apple-darwin` (Apple Silicon/M-series).
*   **Outcome:** The Mac can successfully send and receive physical packets via our custom UDP protocol.

### Step 2: Implement macOS Hardware Decoder (VideoToolbox)
*   **Task:** Write a C++ (Objective-C++) native module using `VideoToolbox` to decode H.264/HEVC frames received from the network.
*   **Details:** Read NAL units from the Rust module, pass them to `VTDecompressionSession`, and push the resulting raw frames (CoreVideo pixel buffers/textures) to the React renderer.
*   **Outcome:** Smooth, low-latency video playback on Mac.

### Step 3: Input Handling (Client -> Host)
*   **Task:** Ensure the current React gamepad/keyboard capture works properly in the macOS Electron environment.
*   **Details:** Verify standard HTML5 Gamepad API inputs map correctly to the Windows `ViGEmBus` on the host side.

---

## 📋 Phase 2: macOS Host (Hosting a session)

To allow a Mac to host games, we must capture its screen, encode it rapidly, capture system audio, and emulate controllers for the connected client.

### Step 1: Screen & Audio Capture (`ScreenCaptureKit`)
*   **Task:** Implement Apple's high-performance `ScreenCaptureKit` framework in an Objective-C++ `.mm` file bound via `node-addon-api`.
*   **Details:** 
    *   Capture specific displays or standard windows.
    *   Capture internal system audio (eliminates the need for 3rd party audio drivers like BlackHole).
*   **Outcome:** Raw video and audio frames are acquired with near-zero latency.

### Step 2: Hardware Encoding (`VideoToolbox` H.264/HEVC)
*   **Task:** Pipe the captured frames directly into `VTCompressionSession`.
*   **Details:** Configure for low-latency (`kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder`), tuning bitrate, profile, and ensuring instantaneous keyframe generation for ICE restarts.
*   **Outcome:** Highly compressed, fast NAL units ready for the network.

### Step 3: Integrations & Fallbacks
*   **Task:** Update `HardwareCaptureService.ts` to detect the OS environment (`process.platform === 'darwin'`) and load the respective binary (e.g., `titanlink-mac-capture.node`).

### Step 4: Controller Emulation (The Hardest Part)
*   **Task:** Emulate a physical game controller on the Mac host so the guest can play.
*   **Details:** macOS does not have a simple equivalent to ViGEmBus.
    *   *Option A:* Use DriverKit to build a custom Virtual HID driver (Requires Apple Developer approval and entitlements).
    *   *Option B:* Investigate legacy `foohid` or other user-space HID injection methods.
*   **Outcome:** The guest's button presses actually control the Mac.

---

## 🛠️ Required Development Environment for macOS Build

1.  **Xcode & Command Line Tools:** Must be installed on the Mac (`xcode-select --install`).
2.  **Objective-C++ Knowledge:** We will write `.mm` files to bridge C++ (Node N-API) with Apple's frameworks (Foundation, AVFoundation, ScreenCaptureKit).
3.  **Rust Toolchain:** Configured for macOS targets (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`).

---

## 🚀 How to Execute This Plan

When you are ready to begin, start by typing:
**"Let's execute Phase 1, Step 1 of the macos-native plan."** 
We will take it one step at a time!
