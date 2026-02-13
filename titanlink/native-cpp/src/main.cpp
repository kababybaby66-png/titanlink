#include <napi.h>
#include "CaptureManager.h"
#include <iostream>

using namespace Napi;

// Function Wrappers
void StartCapture(const CallbackInfo& info) {
    Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
        Error::New(env, "Expected settings object and callback function").ThrowAsJavaScriptException();
        return;
    }

    Object settingsObj = info[0].As<Object>();
    EncoderSettings settings;
    settings.width = settingsObj.Has("width") ? settingsObj.Get("width").ToNumber().Uint32Value() : 1920;
    settings.height = settingsObj.Has("height") ? settingsObj.Get("height").ToNumber().Uint32Value() : 1080;
    settings.bitrate = settingsObj.Has("bitrate") ? settingsObj.Get("bitrate").ToNumber().Uint32Value() : 5000000;
    settings.fps = settingsObj.Has("fps") ? settingsObj.Get("fps").ToNumber().Uint32Value() : 60;
    
    uint32_t displayIndex = settingsObj.Has("displayIndex") ? settingsObj.Get("displayIndex").ToNumber().Uint32Value() : 0;
    
    // Callback: signature (err, frame) or just (frame)
    Function cb = info[1].As<Function>();
    ThreadSafeFunction tsfn = ThreadSafeFunction::New(
        env,
        cb,
        "Capture Callback",
        0,
        1
    );

    CaptureManager::GetInstance().Start(settings, displayIndex, tsfn);
}

void StopCapture(const CallbackInfo& info) {
    CaptureManager::GetInstance().Stop();
}

Value GetDisplays(const CallbackInfo& info) {
    Env env = info.Env();
    auto displays = DxgiCapturer::EnumerateDisplays();
    
    Array result = Array::New(env, displays.size());
    for (size_t i = 0; i < displays.size(); i++) {
        Object d = Object::New(env);
        d.Set("index", Number::New(env, displays[i].index));
        d.Set("name", String::New(env, displays[i].name));
        d.Set("width", Number::New(env, displays[i].width));
        d.Set("height", Number::New(env, displays[i].height));
        d.Set("isPrimary", Boolean::New(env, displays[i].isPrimary));
        result[i] = d;
    }
    return result;
}

Value GetEncoderSupport(const CallbackInfo& info) {
    Env env = info.Env();
    Object result = Object::New(env);
    // This is the NVENC module so obviously NVENC is supported if loadable
    // Ideally verify by checking dll presence
    result.Set("nvenc", Boolean::New(env, true));
    result.Set("amf", Boolean::New(env, false));
    result.Set("quicksync", Boolean::New(env, false));
    result.Set("software", Boolean::New(env, false)); 
    return result;
}

Object Init(Env env, Object exports) {
    exports.Set("startCapture", Function::New(env, StartCapture));
    exports.Set("stopCapture", Function::New(env, StopCapture));
    exports.Set("getDisplays", Function::New(env, GetDisplays));
    exports.Set("getEncoderSupport", Function::New(env, GetEncoderSupport));
    return exports;
}

NODE_API_MODULE(titanlink_nvenc_cpp, Init)
