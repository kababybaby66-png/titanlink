#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <VideoToolbox/VideoToolbox.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreGraphics/CoreGraphics.h>
#include <iostream>
#include <vector>
#include "MacHostCapture.h"

using namespace Napi;

// ── ScreenCaptureKit Stream Delegate and Output ────────────────────────────────
@interface MacCaptureOutput : NSObject <SCStreamOutput, SCStreamDelegate>
@property (nonatomic, assign) VTCompressionSessionRef compressionSession;
@property (nonatomic, assign) ThreadSafeFunction* videoTsfn;
@property (nonatomic, assign) ThreadSafeFunction* audioTsfn;
@end

@implementation MacCaptureOutput

- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer ofType:(SCStreamOutputType)type {
    if (type == SCStreamOutputTypeScreen && self.compressionSession) {
        CVImageBufferRef imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
        if (imageBuffer) {
            CMTime presentationTimeStamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
            CMTime duration = CMSampleBufferGetDuration(sampleBuffer);
            
            // Push to VideoToolbox for hardware compression
            VTCompressionSessionEncodeFrame(
                self.compressionSession,
                imageBuffer,
                presentationTimeStamp,
                duration,
                NULL,
                NULL,
                NULL
            );
        }
    } else if (type == SCStreamOutputTypeAudio && self.audioTsfn) {
        CMBlockBufferRef blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer);
        if (!blockBuffer) return;
        
        size_t length = 0;
        char *dataPointer = nullptr;
        CMBlockBufferGetDataPointer(blockBuffer, 0, NULL, &length, &dataPointer);
        
        if (length > 0) {
            std::vector<uint8_t> audioData(dataPointer, dataPointer + length);
            CMFormatDescriptionRef formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer);
            const AudioStreamBasicDescription* asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc);
            
            CMTime pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
            int64_t timestampUs = (int64_t)(CMTimeGetSeconds(pts) * 1000000.0);
            
            uint32_t sampleRate = asbd ? asbd->mSampleRate : 48000;
            uint32_t channels = asbd ? asbd->mChannelsPerFrame : 2;
            uint32_t bitsPerSample = asbd ? asbd->mBitsPerChannel : 32; // SCKit defaults to 32-bit float usually
            uint32_t frameCount = CMSampleBufferGetNumSamples(sampleBuffer);
            
            self.audioTsfn->NonBlockingCall([audioData, sampleRate, channels, bitsPerSample, frameCount, timestampUs](Napi::Env env, Napi::Function jsCallback) {
                Napi::Object obj = Napi::Object::New(env);
                obj.Set("data", Napi::Buffer<uint8_t>::Copy(env, audioData.data(), audioData.size()));
                obj.Set("sampleRate", Napi::Number::New(env, sampleRate));
                obj.Set("channels", Napi::Number::New(env, channels));
                obj.Set("bitsPerSample", Napi::Number::New(env, bitsPerSample));
                obj.Set("frameCount", Napi::Number::New(env, frameCount));
                obj.Set("timestampUs", Napi::Number::New(env, timestampUs));
                
                jsCallback.Call({ obj });
            });
        }
    }
}

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    std::cerr << "[MacCapture] Stream stopped with error: " << error.localizedDescription.UTF8String << std::endl;
}

@end

// ── VideoToolbox Compression Callback ──────────────────────────────────────────

static void compressionCallback(
    void *outputCallbackRefCon,
    void *sourceFrameRefCon,
    OSStatus status,
    VTEncodeInfoFlags infoFlags,
    CMSampleBufferRef sampleBuffer
) {
    if (status != noErr || !sampleBuffer) {
        std::cerr << "[MacCapture] Compression error: " << status << std::endl;
        return;
    }

    MacCaptureOutput *output = (__bridge MacCaptureOutput *)outputCallbackRefCon;
    if (!output.videoTsfn) return;

    bool isKeyframe = false;
    CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, false);
    if (attachments && CFArrayGetCount(attachments) > 0) {
        CFDictionaryRef attachmentData = (CFDictionaryRef)CFArrayGetValueAtIndex(attachments, 0);
        isKeyframe = !CFDictionaryContainsKey(attachmentData, kCMSampleAttachmentKey_NotSync);
    }

    CMBlockBufferRef dataBuffer = CMSampleBufferGetDataBuffer(sampleBuffer);
    if (!dataBuffer) return;

    size_t length = 0;
    char *dataPointer = nullptr;
    CMBlockBufferGetDataPointer(dataBuffer, 0, NULL, &length, &dataPointer);

    std::vector<uint8_t> frameData(dataPointer, dataPointer + length);
    CMTime pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
    int64_t timestampUs = (int64_t)(CMTimeGetSeconds(pts) * 1000000.0);

    // Call JS ThreadSafeFunction
    output.videoTsfn->NonBlockingCall([frameData, isKeyframe, timestampUs](Napi::Env env, Napi::Function jsCallback) {
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("isKeyframe", Napi::Boolean::New(env, isKeyframe));
        obj.Set("timestampUs", Napi::Number::New(env, timestampUs));
        obj.Set("frameNumber", Napi::Number::New(env, 0)); // Keep sequential conceptually

        Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(env, frameData.data(), frameData.size());
        obj.Set("data", buffer);

        jsCallback.Call({ obj });
    });
}

// ── Global State ───────────────────────────────────────────────────────────────

static SCStream *g_stream = nil;
static MacCaptureOutput *g_outputDelegate = nil;
static ThreadSafeFunction g_videoTsfn;
static ThreadSafeFunction g_audioTsfn;

// ── NAPI Wrappers ──────────────────────────────────────────────────────────────

static void StartCapture(const CallbackInfo& info) {
    Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
        Error::New(env, "Expected settings object and callback function").ThrowAsJavaScriptException();
        return;
    }
    
    // Cleanup if running
    if (g_stream) {
        [g_stream stopCaptureWithCompletionHandler:nil];
        g_stream = nil;
    }

    Object settingsObj = info[0].As<Object>();
    uint32_t reqWidth = settingsObj.Has("width") ? settingsObj.Get("width").ToNumber().Uint32Value() : 1920;
    uint32_t reqHeight = settingsObj.Has("height") ? settingsObj.Get("height").ToNumber().Uint32Value() : 1080;
    uint32_t fps = settingsObj.Has("fps") ? settingsObj.Get("fps").ToNumber().Uint32Value() : 60;
    uint32_t bitrate = settingsObj.Has("bitrate") ? settingsObj.Get("bitrate").ToNumber().Uint32Value() : 5000000;

    Function cb = info[1].As<Function>();
    g_videoTsfn = ThreadSafeFunction::New(env, cb, "MacVideoCallback", 0, 1);

    if (!g_outputDelegate) {
        g_outputDelegate = [[MacCaptureOutput alloc] init];
    }
    g_outputDelegate.videoTsfn = &g_videoTsfn;

    // SCShareableContent setup
    dispatch_group_t group = dispatch_group_create();
    __block SCShareableContent *shareableContent = nil;
    
    dispatch_group_enter(group);
    [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent *content, NSError *error) {
        if (!error && content) {
            shareableContent = content;
        }
        dispatch_group_leave(group);
    }];
    dispatch_group_wait(group, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));

    if (!shareableContent || shareableContent.displays.count == 0) {
        Error::New(env, "No shareable displays found via ScreenCaptureKit").ThrowAsJavaScriptException();
        return;
    }

    SCDisplay *targetDisplay = shareableContent.displays.firstObject; // Default
    SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:targetDisplay excludingWindows:@[]];

    SCStreamConfiguration *config = [[SCStreamConfiguration alloc] init];
    config.width = reqWidth;
    config.height = reqHeight;
    config.minimumFrameInterval = CMTimeMake(1, fps);
    config.showsCursor = YES;
    config.capturesAudio = YES; // Required for system audio

    // Create VideoToolbox Compression Session
    VTCompressionSessionRef compressionSession = nullptr;
    OSStatus status = VTCompressionSessionCreate(
        kCFAllocatorDefault,
        reqWidth,
        reqHeight,
        kCMVideoCodecType_H264,
        NULL, NULL, NULL,
        compressionCallback,
        (__bridge void *)g_outputDelegate,
        &compressionSession
    );

    if (status != noErr || !compressionSession) {
        Error::New(env, "Failed to create VTCompressionSession").ThrowAsJavaScriptException();
        return;
    }
    
    VTSessionSetProperty(compressionSession, kVTCompressionPropertyKey_RealTime, kCFBooleanTrue);
    VTSessionSetProperty(compressionSession, kVTCompressionPropertyKey_AverageBitRate, (__bridge CFTypeRef)@(bitrate));
    VTSessionSetProperty(compressionSession, kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_High_AutoLevel);
    
    VTCompressionSessionPrepareToEncodeFrames(compressionSession);
    g_outputDelegate.compressionSession = compressionSession;

    // Start ScreenCaptureKit Stream
    g_stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:g_outputDelegate];
    NSError *error = nil;
    [g_stream addStreamOutput:g_outputDelegate type:SCStreamOutputTypeScreen sampleHandlerQueue:dispatch_get_main_queue() error:&error];
    
    if (error) {
        Error::New(env, error.localizedDescription.UTF8String).ThrowAsJavaScriptException();
        return;
    }

    [g_stream startCaptureWithCompletionHandler:^(NSError *startError) {
        if (startError) {
            std::cerr << "[MacCapture] Failed to start SCStream: " << startError.localizedDescription.UTF8String << std::endl;
        } else {
            std::cout << "[MacCapture] Host capture started successfully on macOS." << std::endl;
        }
    }];
}

static void StopCapture(const CallbackInfo& info) {
    if (g_stream) {
        [g_stream stopCaptureWithCompletionHandler:nil];
        g_stream = nil;
    }
    if (g_outputDelegate && g_outputDelegate.compressionSession) {
        VTCompressionSessionInvalidate(g_outputDelegate.compressionSession);
        CFRelease(g_outputDelegate.compressionSession);
        g_outputDelegate.compressionSession = nullptr;
    }
    if (g_tsfn) {
        g_tsfn.Release();
    }
    std::cout << "[MacCapture] Capture stopped." << std::endl;
}

static Value GetDisplays(const CallbackInfo& info) {
    Env env = info.Env();
    dispatch_group_t group = dispatch_group_create();
    __block SCShareableContent *shareableContent = nil;
    
    dispatch_group_enter(group);
    // Needs macOS 12.3+
    if (@available(macOS 12.3, *)) {
        [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent *content, NSError *error) {
            if (!error && content) {
                shareableContent = content;
            }
            dispatch_group_leave(group);
        }];
        dispatch_group_wait(group, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
    } else {
        dispatch_group_leave(group);
    }

    if (!shareableContent || shareableContent.displays.count == 0) {
        return Array::New(env, 0);
    }

    Array result = Array::New(env, shareableContent.displays.count);
    for (size_t i = 0; i < shareableContent.displays.count; i++) {
        SCDisplay *display = shareableContent.displays[i];
        Object d = Object::New(env);
        d.Set("index", Number::New(env, i));
        d.Set("name", String::New(env, [NSString stringWithFormat:@"Display %zu", i].UTF8String));
        d.Set("width", Number::New(env, display.width));
        d.Set("height", Number::New(env, display.height));
        d.Set("isPrimary", Boolean::New(env, i == 0));
        result[i] = d;
    }
    return result;
}

// ── Audio NAPI API ─────────────────────────────────────────────────────────────

static Value IsAudioSupported(const CallbackInfo& info) {
    Env env = info.Env();
    if (@available(macOS 12.3, *)) {
        return Boolean::New(env, true);
    }
    return Boolean::New(env, false);
}

static Value StartAudioCapture(const CallbackInfo& info) {
    Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Error::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return Boolean::New(env, false);
    }
    
    Function cb = info[0].As<Function>();
    g_audioTsfn = ThreadSafeFunction::New(env, cb, "MacAudioCallback", 0, 1);
    
    if (!g_outputDelegate) {
        g_outputDelegate = [[MacCaptureOutput alloc] init];
    }
    g_outputDelegate.audioTsfn = &g_audioTsfn;
    
    // Audio is automatically started if g_stream is active because SCStream capturesAudio = YES
    return Boolean::New(env, true);
}

static void StopAudioCapture(const CallbackInfo& info) {
    if (g_audioTsfn) {
        g_audioTsfn.Release();
    }
}

static Value GetEncoderSupport(const CallbackInfo& info) {
    Object res = Object::New(info.Env());
    res.Set("nvenc", Boolean::New(info.Env(), false));
    res.Set("amf", Boolean::New(info.Env(), false));
    res.Set("quicksync", Boolean::New(info.Env(), false));
    res.Set("software", Boolean::New(info.Env(), true)); 
    res.Set("videotoolbox", Boolean::New(info.Env(), true)); // Mark macOS HW encode support
    return res;
}

// ── MVP Input Injection (Phase 2 Host) ─────────────────────────────────────────
static void InjectInput(const CallbackInfo& info) {
    Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) return;
    Object evt = info[0].As<Object>();
    
    std::string type = evt.Has("type") ? evt.Get("type").ToString().Utf8Value() : "";
    
    if (type == "mouse") {
        float x = evt.Has("x") ? evt.Get("x").ToNumber().FloatValue() : 0;
        float y = evt.Has("y") ? evt.Get("y").ToNumber().FloatValue() : 0;
        bool down = evt.Has("down") ? evt.Get("down").ToBoolean().Value() : false;
        std::string button = evt.Has("button") ? evt.Get("button").ToString().Utf8Value() : "";
        
        CGEventType eventType = kCGEventMouseMoved;
        CGMouseButton mb = kCGMouseButtonLeft;
        
        if (button == "left") {
            eventType = down ? kCGEventLeftMouseDown : kCGEventLeftMouseUp;
            mb = kCGMouseButtonLeft;
        } else if (button == "right") {
            eventType = down ? kCGEventRightMouseDown : kCGEventRightMouseUp;
            mb = kCGMouseButtonRight;
        } else if (button == "middle") {
            eventType = down ? kCGEventOtherMouseDown : kCGEventOtherMouseUp;
            mb = kCGMouseButtonCenter;
        }
        
        CGPoint pt = CGPointMake(x, y);
        CGEventRef event = CGEventCreateMouseEvent(NULL, eventType, pt, mb);
        if (event) {
            CGEventPost(kCGHIDEventTap, event);
            CFRelease(event);
        }
    } else if (type == "key") {
        uint16_t keyCode = evt.Has("keyCode") ? (uint16_t)evt.Get("keyCode").ToNumber().Uint32Value() : 0;
        bool down = evt.Has("down") ? evt.Get("down").ToBoolean().Value() : false;
        
        CGEventRef event = CGEventCreateKeyboardEvent(NULL, (CGKeyCode)keyCode, down);
        if (event) {
            CGEventPost(kCGHIDEventTap, event);
            CFRelease(event);
        }
    }
}

void InitMacHostCapture(Napi::Env env, Napi::Object& exports) {
    exports.Set("startCapture",      Function::New(env, StartCapture));
    exports.Set("stopCapture",       Function::New(env, StopCapture));
    exports.Set("getDisplays",       Function::New(env, GetDisplays));
    exports.Set("getEncoderSupport", Function::New(env, GetEncoderSupport));
    exports.Set("injectInput",       Function::New(env, InjectInput));
    
    exports.Set("isAudioSupported",  Function::New(env, IsAudioSupported));
    exports.Set("startAudioCapture", Function::New(env, StartAudioCapture));
    exports.Set("stopAudioCapture",  Function::New(env, StopAudioCapture));
}
