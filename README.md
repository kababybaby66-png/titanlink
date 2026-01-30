# TitanLink // SECURE NEURAL UPLINK

Ultra-low latency peer-to-peer gaming client for Windows. Experience gaming together with friends remotely through a high-performance, direct-link neural interface.

![TitanLink Interface](docs/screenshot.png)

## Overview

TitanLink is designed for gamers who demand the lowest possible latency. Built on top of WebRTC and Electron, it provides a seamless way to share your screen and controllers over the internet with zero-configuration NAT traversal.

## Core Features

- **Sub-frame Latency** - Highly optimized pipeline for ultra-responsive gameplay.
- **Neural Aesthetic UI** - Modern Glassmorphic interface with reactive cyberpunk elements.
- **Direct P2P Connection** - Direct peer-to-peer streaming utilizing STUN/TURN for maximum reliability.
- **Full Controller Support** - Native Xbox controller emulation via ViGEmBus driver.
- **System Monitoring** - Real-time CPU and Memory tracking to ensure optimal performance.
- **Easy Pairing** - Simple 6-character session codes for instant connection.
- **Hardware Acceleration** - Full GPU-accelerated capture and decoding.

## Requirements

### Host PC
- **OS**: Windows 10/11 (64-bit)
- **GPU**: NVIDIA or AMD with hardware encoding support
- **Driver**: [ViGEmBus](https://github.com/ViGEm/ViGEmBus/releases) installed
- **Network**: Wired connection recommended (10+ Mbps upload)

### Client PC
- **OS**: Windows 10/11 (64-bit)
- **Gamepad**: Xbox controller or XInput-compatible device
- **Network**: Stable connection (15+ Mbps download)

## Getting Started

### Installation
1. Download the latest `TitanLink-Setup.exe` from [Releases](https://github.com/your-repo/titanlink/releases).
2. Install and ensure ViGEmBus drivers are present.
3. Launch TitanLink and initialize your uplink.

### From Source
```bash
# Clone the repository
git clone https://github.com/your-repo/titanlink.git
cd titanlink

# Install dependencies
npm install

# Start development environment
npm run electron:dev

# Compile production build
npm run electron:build
```

## How It Works

### As Host
1. Launch TitanLink and click **"Host Session"**.
2. Select your target display.
3. Transmit the generated **Session Code** to your peer.
4. Once the link is established, your desktop is ready for remote play.

### As Client
1. Launch TitanLink and click **"Join Session"**.
2. Enter the **Session Code** provided by the host.
3. Plug in your controller.
4. Once connected, your inputs are beamed directly to the host's virtual controller.

## Architecture

TitanLink uses a modular architecture for high performance:

- **Renderer**: React + Vite with a custom glassmorphism design system.
- **Backend**: Electron main process handling IPC and system hooks.
- **Stream**: WebRTC with VP9/H.264 codecs and hardware acceleration.
- **Input**: Low-level binary protocol over unreliable DataChannels for instant response.
- **Drivers**: ViGEmClient integration for virtual gamepad management.

## Project Structure

```text
titanlink/
├── electron/         # System logic & IPC handlers
├── shared/           # Transports & Type definitions
├── src/              # React frontend & UI components
├── docs/             # Documentation & Assets
└── signaling-server/ # Handshake coordination service
```

## Contributing

We welcome contributions to the TitanLink uplink. Feel free to open issues or submit PRs.

## License

MIT License. Designed with precision for the gaming community.

---
*Built with speed in mind. TitanLink // The Future of Remote Play.*
