#import <Foundation/Foundation.h>
#import <VideoToolbox/VideoToolbox.h>
#import <CoreVideo/CoreVideo.h>
#include <iostream>
#include "MacVideoDecoder.h"

using namespace Napi;

// State structure for decoder
struct DecoderState {
    VTDecompressionSessionRef session = nullptr;
    CMVideoFormatDescriptionRef formatDesc = nullptr;
};

static DecoderState g_decoder;

static Value DecodeFrame(const CallbackInfo& info) {
    Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) {
        Error::New(env, "Expected buffer of NAL unit").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
    // TODO: Phase 1 VideoToolbox decompression of NAL units into CoreVideo PixelBuffers.
    
    return Boolean::New(env, true);
}

void InitMacDecoder(Napi::Env env, Napi::Object& exports) {
    exports.Set("decodeFrame", Function::New(env, DecodeFrame));
}
