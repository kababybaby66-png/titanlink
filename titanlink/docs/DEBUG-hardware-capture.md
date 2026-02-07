# 🔍 Debug Report: Hardware Capture Not Loading

> **Issue**: "[App] Hardware capture unavailable, using WebRTC fallback"  
> **Date**: 2026-02-07 17:54  
> **Status**: 🔧 IN PROGRESS

---

## 1. Symptom

The application logs:
```
[App] Hardware capture unavailable, using WebRTC fallback
```

This means the Rust-based hardware capture (NVENC) is not being used, falling back to slower WebRTC screen capture.

---

## 2. Information Gathered

### Native Module Status
- **File**: `native/titanlink-capture.win32-x64-msvc.node`
- **Exists**: ✅ YES (638,464 bytes)
- **Platform**: Windows x64 ✅
- **Standalone Test**: ✅ PASSES

**Test Results**:
```bash
$ node native/test-load.js
✅ Native module loaded successfully!
Health check: titanlink-capture v0.1.0
Encoder support: { nvenc: true, amf: false, quicksync: false, software: true }
```

**NVENC is available!** 🎉

### Code Flow
1. `App.tsx:handleHostSession()` checks hardware support
2. Calls `window.electronAPI.hardwareCapture.isSupported()`
3. `electron/main.ts` → `hardwareCaptureService.getEncoderSupport()`
4. `HardwareCaptureService.ts` → loads native module via `require(binaryPath)`

---

## 3. Hypotheses

| # | Hypothesis | Likelihood |
|---|------------|------------|
| 1 | ❓ Path resolution fails in Electron dev mode | **HIGH** |
| 2 | ❓ Native module fails to load due to missing DLL dependencies | MEDIUM |
| 3 | ❓ `isSupported()` returns false even when module loads | LOW |
| 4 | ❓ Settings have `useHardwareCapture: false` | LOW |

---

## 4. Investigation

### Testing Hypothesis 1: Path Resolution

**What I checked**: Added extensive logging to `HardwareCaptureService.ts`

**Changes Made**:
- Added debug output showing all candidate paths
- Added 4th candidate: `path.join(__dirname, '..', '..', 'native', binaryName)`
- Shows which paths exist vs don't exist

**Expected Output** (after restart):
```
[HardwareCapture] === Path Resolution Debug ===
[HardwareCapture] isDev: true
[HardwareCapture] binaryName: titanlink-capture.win32-x64-msvc.node
[HardwareCapture] app.getAppPath(): C:\Users\yoavl\...\titanlink
[HardwareCapture] process.cwd(): C:\Users\yoavl\...\titanlink
[HardwareCapture] Checking candidates:
[HardwareCapture]   ✓ C:\Users\yoavl\...\titanlink\native\titanlink-capture.win32-x64-msvc.node
[HardwareCapture] ✅ Found native binary at: ...
```

### Testing Hypothesis 2: DLL Dependencies

**What I checked**: Native module loads fine in Node.js standalone test

**Result**: ✅ Module loads successfully outside Electron

**Conclusion**: Not a DLL dependency issue

### Testing Hypothesis 3: isSupported() Logic

**File**: `App.tsx:216-218`
```typescript
const support = await window.electronAPI.hardwareCapture.isSupported();
hwSupported = support.nvenc || support.software;
```

**Expected**: Should return `{ nvenc: true, software: true }`

**Need to verify**: Check console logs when app starts hosting

### Testing Hypothesis 4: Settings Check

**File**: `App.tsx:226`
```typescript
const useHardware = hwSupported && settings.useHardwareCapture;
```

**Need to verify**: Check if `settings.useHardwareCapture` is true

---

## 5. Root Cause (Preliminary)

🎯 **Most Likely**: Path resolution issue in Electron dev mode

**Why**:
- Native module exists and works standalone ✅
- No DLL dependency issues ✅
- The error message suggests the module isn't loading at all
- Electron's `app.getAppPath()` might return unexpected path in Vite dev mode

**Evidence Needed**:
- Console logs from enhanced debugging (waiting for app restart)

---

## 6. Fix Strategy

### Immediate Actions:
1. ✅ Added comprehensive path debugging
2. ⏳ Restart app to see debug output
3. ⏳ Verify which path (if any) successfully finds the binary

### If Path Issue Confirmed:
```typescript
// Add absolute path fallback
const candidates = [
    path.join(appPath, 'native', binaryName),
    path.join(appPath, '..', 'native', binaryName),
    path.join(cwd, 'native', binaryName),
    path.join(__dirname, '..', '..', 'native', binaryName),
    // ABSOLUTE FALLBACK for dev mode
    path.resolve(process.cwd(), 'native', binaryName),
];
```

### If Module Loads But isSupported() Fails:
- Check if `getEncoderSupport()` is being called correctly
- Verify return value matches expected interface

### If Settings Issue:
- Check default settings in `shared/types/ipc.ts`
- Verify settings page properly saves `useHardwareCapture`

---

## 7. Prevention

Once fixed, add:

1. **Startup Health Check**:
```typescript
// In HardwareCaptureService constructor
if (this.native) {
    const support = this.native.getEncoderSupport();
    console.log(`${LOG_PREFIX} ✅ Initialized - NVENC: ${support.nvenc}, Software: ${support.software}`);
} else {
    console.error(`${LOG_PREFIX} ❌ Failed to initialize - native module not loaded`);
}
```

2. **Better Error Messages**:
```typescript
if (!started) {
    console.error('[App] ❌ Hardware capture failed to start');
    console.error('[App] Check: 1) Native module loaded? 2) NVENC available? 3) Settings enabled?');
}
```

3. **Unit Test**:
```typescript
// src/__tests__/hardware-capture.test.ts
it('should load native module in dev mode', () => {
    const service = new HardwareCaptureService();
    expect(service.native).toBeDefined();
});
```

---

## 8. Next Steps

1. **Check Console** - Look for the new debug output
2. **Identify Path** - Which candidate path works?
3. **Apply Fix** - Update path resolution if needed
4. **Test** - Verify NVENC is used when hosting
5. **Document** - Update ARCHITECTURE.md with path resolution logic

---

## Files Modified

- ✅ `electron/services/HardwareCaptureService.ts` - Added debug logging
- ✅ `native/test-load.js` - Created standalone test

---

**Status**: Waiting for app restart to see debug output 🔄

*This is a systematic debugging session following the /debug workflow.*
