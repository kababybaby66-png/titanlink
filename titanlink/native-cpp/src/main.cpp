#include <napi.h>
#ifdef _WIN32
#include "CaptureManager.h"
#include "WasapiCapture.h"
#include "UdpTransport.h"
#else
#include "MacVideoDecoder.h"
#include "MacHostCapture.h"
#endif
#include <iostream>

using namespace Napi;

#ifdef _WIN32
// ── Singleton audio capture instance ──────────────────────────────────────────
static WasapiCapture g_wasapi;
static bool          g_wasapiInited = false;
static ThreadSafeFunction g_audioTsfn;

// ── Video capture wrappers ─────────────────────────────────────────────────────

void StartCapture(const CallbackInfo& info) {
    Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
        Error::New(env, "Expected settings object and callback function").ThrowAsJavaScriptException();
        return;
    }

    Object settingsObj = info[0].As<Object>();
    EncoderSettings settings;
    settings.width   = settingsObj.Has("width")   ? settingsObj.Get("width").ToNumber().Uint32Value()   : 1920;
    settings.height  = settingsObj.Has("height")  ? settingsObj.Get("height").ToNumber().Uint32Value()  : 1080;
    settings.bitrate = settingsObj.Has("bitrate") ? settingsObj.Get("bitrate").ToNumber().Uint32Value() : 5000000;
    settings.fps     = settingsObj.Has("fps")     ? settingsObj.Get("fps").ToNumber().Uint32Value()     : 60;

    uint32_t displayIndex = settingsObj.Has("displayIndex")
        ? settingsObj.Get("displayIndex").ToNumber().Uint32Value() : 0;

    Function cb = info[1].As<Function>();
    ThreadSafeFunction tsfn = ThreadSafeFunction::New(env, cb, "Capture Callback", 0, 1);

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
        d.Set("index",     Number::New(env, displays[i].index));
        d.Set("name",      String::New(env, displays[i].name));
        d.Set("width",     Number::New(env, displays[i].width));
        d.Set("height",    Number::New(env, displays[i].height));
        d.Set("isPrimary", Boolean::New(env, displays[i].isPrimary));
        result[i] = d;
    }
    return result;
}

Value GetEncoderSupport(const CallbackInfo& info) {
    Env env = info.Env();
    Object result = Object::New(env);
    result.Set("nvenc",      Boolean::New(env, true));
    result.Set("amf",        Boolean::New(env, true));
    result.Set("quicksync",  Boolean::New(env, true));
    result.Set("software",   Boolean::New(env, false));
    return result;
}

// ── Network / UDP Wrappers ─────────────────────────────────────────────────────

static ThreadSafeFunction g_inputTsfn;

Value StartNetwork(const CallbackInfo& info) {
    Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsString() || !info[1].IsNumber() || !info[2].IsString()) {
        Error::New(env, "Expected (relayIp, relayPort, sessionId_string)").ThrowAsJavaScriptException();
        return Boolean::New(env, false);
    }

    std::string relayIp = info[0].As<String>().Utf8Value();
    uint16_t relayPort = info[1].As<Number>().Uint32Value();
    uint64_t sessionId = std::stoull(info[2].As<String>().Utf8Value());

    bool ok = UdpTransport::GetInstance().Start(relayIp, relayPort, sessionId);
    return Boolean::New(env, ok);
}

void StopNetwork(const CallbackInfo& info) {
    UdpTransport::GetInstance().Stop();
    if (g_inputTsfn) {
        g_inputTsfn.Release();
    }
}

void OnInput(const CallbackInfo& info) {
    Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Error::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return;
    }

    Function cb = info[0].As<Function>();
    g_inputTsfn = ThreadSafeFunction::New(env, cb, "Controller Input Callback", 0, 1);

    UdpTransport::GetInstance().SetInputCallback([](const ControllerInputData& input) {
        auto inputCopy = std::make_shared<ControllerInputData>(input);

        auto status = g_inputTsfn.NonBlockingCall([inputCopy](Napi::Env env, Napi::Function jsCallback) {
            try {
                Napi::Object obj = Napi::Object::New(env);
                obj.Set("controllerIndex", Napi::Number::New(env, inputCopy->controller_index));
                obj.Set("buttons", Napi::Number::New(env, inputCopy->buttons));
                obj.Set("leftStickX", Napi::Number::New(env, inputCopy->left_stick_x));
                obj.Set("leftStickY", Napi::Number::New(env, inputCopy->left_stick_y));
                obj.Set("rightStickX", Napi::Number::New(env, inputCopy->right_stick_x));
                obj.Set("rightStickY", Napi::Number::New(env, inputCopy->right_stick_y));
                obj.Set("leftTrigger", Napi::Number::New(env, inputCopy->left_trigger));
                obj.Set("rightTrigger", Napi::Number::New(env, inputCopy->right_trigger));
                jsCallback.Call({ obj });
            } catch (const std::exception& e) {
                std::cerr << "[CPP] Input callback exception: " << e.what() << std::endl;
            }
        });
        
        if (status != napi_ok) {
            std::cerr << "[CPP] Input callback NonBlockingCall failed" << std::endl;
        }
    });
}

ThreadSafeFunction g_packetCallback;

Value OnNetworkPacket(const CallbackInfo& info) {
    Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
        TypeError::New(env, "Function expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    g_packetCallback = ThreadSafeFunction::New(
        env,
        info[0].As<Function>(),
        "OnPacketCallback",
        0,
        1
    );

    UdpTransport::GetInstance().SetPacketCallback([](const uint8_t* data, size_t size) {
        if (!g_packetCallback) return;

        std::vector<uint8_t>* payload = new std::vector<uint8_t>(data, data + size);

        napi_status status = g_packetCallback.NonBlockingCall(payload, [](Env env, Function jsCallback, std::vector<uint8_t>* payload) {
            if (env != nullptr && jsCallback != nullptr) {
                Buffer<uint8_t> buffer = Buffer<uint8_t>::Copy(env, payload->data(), payload->size());
                jsCallback.Call({buffer});
            }
            delete payload;
        });

        if (status != napi_ok) {
            delete payload;
            std::cerr << "[CPP] Packet callback NonBlockingCall failed" << std::endl;
        }
    });

    return Boolean::New(env, true);
}

Value SendControllerInput(const CallbackInfo& info) {
    Env env = info.Env();
    if (info.Length() < 8) return Boolean::New(env, false);

    ControllerInputData input{};
    input.controller_index = info[0].As<Number>().Uint32Value();
    input.buttons = info[1].As<Number>().Uint32Value();
    input.left_stick_x = static_cast<int16_t>(info[2].As<Number>().Int32Value());
    input.left_stick_y = static_cast<int16_t>(info[3].As<Number>().Int32Value());
    input.right_stick_x = static_cast<int16_t>(info[4].As<Number>().Int32Value());
    input.right_stick_y = static_cast<int16_t>(info[5].As<Number>().Int32Value());
    input.left_trigger = info[6].As<Number>().Uint32Value();
    input.right_trigger = info[7].As<Number>().Uint32Value();

    std::vector<uint8_t> payload(sizeof(ControllerInputData));
    payload[0] = input.controller_index;
    *reinterpret_cast<uint16_t*>(&payload[1]) = htons(input.buttons);
    *reinterpret_cast<uint16_t*>(&payload[3]) = htons(input.left_stick_x);
    *reinterpret_cast<uint16_t*>(&payload[5]) = htons(input.left_stick_y);
    *reinterpret_cast<uint16_t*>(&payload[7]) = htons(input.right_stick_x);
    *reinterpret_cast<uint16_t*>(&payload[9]) = htons(input.right_stick_y);
    payload[11] = input.left_trigger;
    payload[12] = input.right_trigger;

    // Send it
    UdpTransport::GetInstance().SendInput(input);
    return Boolean::New(env, true);
}

// ── Audio capture wrappers ─────────────────────────────────────────────────────

Value IsAudioSupported(const CallbackInfo& info) {
    Env env = info.Env();
    // WASAPI loopback is always available on Windows 7+.
    return Boolean::New(env, true);
}

Value StartAudioCapture(const CallbackInfo& info) {
    Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Error::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return Boolean::New(env, false);
    }

    if (g_wasapi.IsRunning()) {
        return Boolean::New(env, true); // Already running
    }

    // COM initialisation for this call (STA is fine for enumeration).
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    if (!g_wasapiInited) {
        if (!g_wasapi.Init()) {
            std::cerr << "[CPP] WasapiCapture::Init failed" << std::endl;
            return Boolean::New(env, false);
        }
        g_wasapiInited = true;
    }

    Function cb = info[0].As<Function>();
    g_audioTsfn = ThreadSafeFunction::New(env, cb, "Audio Callback", 0, 1);

    bool ok = g_wasapi.Start([](const AudioFrame& frame) {
        // Build a copy of the data for the JS closure.
        auto frameCopy = std::make_shared<AudioFrame>(frame);

        auto status = g_audioTsfn.NonBlockingCall(
            [frameCopy](Napi::Env env, Napi::Function jsCallback) {
                try {
                    Napi::Object obj = Napi::Object::New(env);
                    obj.Set("sampleRate",    Napi::Number::New(env, frameCopy->sampleRate));
                    obj.Set("channels",      Napi::Number::New(env, frameCopy->channels));
                    obj.Set("bitsPerSample", Napi::Number::New(env, frameCopy->bitsPerSample));
                    obj.Set("numFrames",     Napi::Number::New(env, frameCopy->numFrames));
                    obj.Set("isSilence",     Napi::Boolean::New(env, frameCopy->isSilence));

                    Napi::Buffer<uint8_t> buf = Napi::Buffer<uint8_t>::Copy(
                        env,
                        frameCopy->data.data(),
                        frameCopy->data.size()
                    );
                    obj.Set("data", buf);

                    jsCallback.Call({ obj });
                } catch (const std::exception& e) {
                    std::cerr << "[CPP] Audio callback exception: " << e.what() << std::endl;
                }
            }
        );

        if (status != napi_ok) {
            std::cerr << "[CPP] Audio NonBlockingCall failed, status=" << status << std::endl;
        }
    });

    if (!ok) {
        g_audioTsfn.Release();
        return Boolean::New(env, false);
    }

    std::cout << "[CPP] Audio capture started ("
              << g_wasapi.GetSampleRate() << "Hz, "
              << g_wasapi.GetChannels()   << "ch)" << std::endl;

    return Boolean::New(env, true);
}

void StopAudioCapture(const CallbackInfo& info) {
    g_wasapi.Stop();
    if (g_audioTsfn) {
        g_audioTsfn.Release();
    }
    std::cout << "[CPP] Audio capture stopped." << std::endl;
}
#endif

// ── Module init ────────────────────────────────────────────────────────────────

Object Init(Env env, Object exports) {
#ifdef _WIN32
    exports.Set("startCapture",      Function::New(env, StartCapture));
    exports.Set("stopCapture",       Function::New(env, StopCapture));
    exports.Set("getDisplays",       Function::New(env, GetDisplays));
    exports.Set("getEncoderSupport", Function::New(env, GetEncoderSupport));

    exports.Set("isAudioSupported",  Function::New(env, IsAudioSupported));
    exports.Set("startAudioCapture", Function::New(env, StartAudioCapture));
    exports.Set("stopAudioCapture",  Function::New(env, StopAudioCapture));

    exports.Set("startNetwork",      Function::New(env, StartNetwork));
    exports.Set(String::New(env, "stopNetwork"), Function::New(env, StopNetwork));
    exports.Set(String::New(env, "onInput"), Function::New(env, OnInput));
    exports.Set(String::New(env, "onPacket"), Function::New(env, OnNetworkPacket));
    exports.Set(String::New(env, "sendControllerInput"), Function::New(env, SendControllerInput));
#else
    InitMacDecoder(env, exports);
    InitMacHostCapture(env, exports);
#endif
    return exports;
}

NODE_API_MODULE(titanlink_nvenc_cpp, Init)
