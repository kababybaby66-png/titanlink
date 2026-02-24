# NVENC C++ Native Addon

This is a migration of the NVENC encoder to C++ using `node-addon-api`. This resolves the `Status 15 (INVALID_VERSION)` error by using the official NVIDIA header macros for struct versioning.

## Prerequisites
- Windows 10/11 x64
- Visual Studio Build Tools (C++ workload)
- NVIDIA Video Codec SDK extracted to `C:\Program Files\NVIDIA Corporation\NVIDIA Video Codec SDK\`

## Build Instructions
1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the addon:
   ```bash
   npm run build
   ```
   Or manually:
   ```bash
   node-gyp rebuild
   ```
3. verify the build artifacts in `build/Release/titanlink-nvenc-cpp.node`.

## Integration
In your main application (Electron main process), import this module:
```javascript
const nvenc = require('./native-cpp/build/Release/titanlink-nvenc-cpp.node');
const encoder = new nvenc.NvencEncoder();

encoder.openSession({
  width: 1920,
  height: 1080,
  bitrate: 5000000,
  fps: 60
});
```
This call corresponds to `OpenSession` in `NvencEncoder.cpp`.
