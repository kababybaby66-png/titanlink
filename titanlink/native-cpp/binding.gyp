{
  "targets": [
    {
      "target_name": "titanlink-nvenc-cpp",
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "include"
      ],
      "conditions": [
        ["OS=='win'", {
          "sources": [
            "src/main.cpp",
            "src/CaptureManager.cpp",
            "src/DxgiCapturer.cpp",
            "src/NvencEngine.cpp",
            "src/MfH264Encoder.cpp",
            "src/WasapiCapture.cpp"
          ],
          "libraries": [
            "-ld3d11",
            "-ldxgi",
            "-lole32",
            "-luuid",
            "-lavrt",
            "-lmfplat",
            "-lmfuuid",
            "-lmf",
            "-lstrmiids",
            "-lwmcodecdspuuid"
          ]
        }],
        ["OS=='mac'", {
          "sources": [
            "src/main.cpp",
            "src/MacVideoDecoder.mm",
            "src/MacHostCapture.mm"
          ],
          "libraries": [
            "-framework VideoToolbox",
            "-framework CoreMedia",
            "-framework CoreVideo",
            "-framework CoreFoundation",
            "-framework ScreenCaptureKit",
            "-framework AVFoundation"
          ],
          "xcode_settings": {
            "OTHER_CPLUSPLUSFLAGS": ["-std=c++17", "-stdlib=libc++"],
            "OTHER_LDFLAGS": ["-stdlib=libc++"]
          }
        }]
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1
        }
      },
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ]
    }
  ]
}
