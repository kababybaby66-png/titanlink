{
  "targets": [
    {
      "target_name": "titanlink-nvenc-cpp",
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "sources": [
        "src/main.cpp",
        "src/CaptureManager.cpp",
        "src/DxgiCapturer.cpp",
        "src/NvencEngine.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "include"
      ],
      "libraries": [
        "-ld3d11",
        "-ldxgi"
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
