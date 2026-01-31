# Latency Optimization Plan - TitanLink

## Goal
Achieve the LOWEST possible latency for controller input and screen streaming while ensuring bitrate/Hz settings are actually enforced.

---

## Priority Order
1. **Controller Input Latency** - Most critical for gaming
2. **Video Stream Latency** - Screen sharing delay
3. **FPS Enforcement** - Ensure Hz settings are applied
4. **Audio Compliance** - Sample rate + bitrate matching settings

---

## Phase 1: Controller Input Optimization (CRITICAL)

### Task 1.1: Reduce Data Channel Buffering
- **File:** `src/services/WebRTCService.ts`
- **Action:** 
  - Set `bufferedAmountLowThreshold` to 0
  - Increase priority to "high" for input channel
- **Verify:** Check `bufferedAmount` stays at 0 during gameplay

### Task 1.2: Binary Protocol Already Optimized ✓
- Already using 24-byte binary packets with `ordered: false, maxRetransmits: 0`
- No changes needed

### Task 1.3: Remove Controller Input Timestamp Overhead
- **File:** `shared/types/ipc.ts`
- **Action:** Consider removing 8-byte timestamp from packet if not used for display
- **Verify:** Packet size reduced, no functional regression

---

## Phase 2: Video Stream Latency (HIGH PRIORITY)

### Task 2.1: Apply Low-Latency Encoder Settings
- **File:** `src/services/WebRTCService.ts`
- **Action:** Set RTCRtpSender encoding parameters:
  ```javascript
  params.encodings[0].priority = 'high';
  params.encodings[0].networkPriority = 'high';
  // Aggressive for low latency - no B-frames
  params.encodings[0].scalabilityMode = 'L1T1';
  ```
- **Verify:** Check WebRTC internals show new parameters

### Task 2.2: Add Frame Rate Constraint Enforcement
- **File:** `src/services/WebRTCService.ts`
- **Action:** Set `maxFrameRate` on RTCRtpSender in addition to getUserMedia:
  ```javascript
  params.encodings[0].maxFramerate = this.settings.fps;
  ```
- **Verify:** Stats show actual FPS matches setting

### Task 2.3: Enable Hardware Acceleration Hints
- **File:** `src/services/WebRTCService.ts`
- **Action:** Add `contentHint: 'motion'` for video tracks (optimizes for fast motion)
- **Verify:** Track settings show content hint applied

### Task 2.4: Reduce Keyframe Interval
- **File:** `src/services/WebRTCService.ts`  
- **Action:** Force more frequent keyframes via SDP munging:
  ```javascript
  // Add x-google-max-keyframe-interval to reduce I-frame distance
  ```
- **Verify:** Faster recovery from quality drops

---

## Phase 3: Audio Settings Compliance (MEDIUM)

### Task 3.1: Apply Audio Sample Rate from Settings
- **File:** `src/services/WebRTCService.ts`
- **Action:** Add audio constraints in `startScreenCapture()`:
  ```javascript
  audio: {
    sampleRate: 48000, // or from settings
    channelCount: 2,
    echoCancellation: false, // for game mode
    noiseSuppression: false,
    autoGainControl: false,
  }
  ```
- **Verify:** Audio MediaStreamTrack shows correct sample rate

### Task 3.2: Apply Audio Bitrate via RTCRtpSender
- **File:** `src/services/WebRTCService.ts`
- **Action:** Set audio sender parameters:
  ```javascript
  audioSender.getParameters().encodings[0].maxBitrate = settings.audioBitrate * 1000;
  ```
- **Verify:** Stats show audio bitrate matches setting

### Task 3.3: Update Settings UI for Sample Rate
- **File:** `src/pages/SettingsPage.tsx` + `shared/types/ipc.ts`
- **Action:** Make audio quality dropdown functional (48kHz / lower option)
- **Verify:** Settings persist and are applied

---

## Phase 4: Network Configuration for Remote Play

### Task 4.1: Optimize ICE Candidate Gathering
- **File:** `src/services/WebRTCService.ts`
- **Action:**
  - Increase `iceCandidatePoolSize` to 15
  - Enable TCP candidates for firewall traversal
- **Verify:** Faster connection establishment

### Task 4.2: Reduce Stats Polling Overhead
- **File:** `src/services/WebRTCService.ts`
- **Action:** Change latency polling from 1000ms to 500ms for faster quality feedback
- **Verify:** Quicker adaptive bitrate response

### Task 4.3: Add Jitter Buffer Configuration
- **File:** `src/services/WebRTCService.ts`
- **Action:** Minimize jitter buffer via SDP:
  ```javascript
  // a=x-google-min-jitter-buffer-target:0
  ```
- **Verify:** Lower latency at cost of smoothness

---

## Phase 5: Monitoring & Verification

### Task 5.1: Add FPS Counter to Stream Overlay
- **File:** `src/pages/StreamView.tsx`
- **Action:** Display actual received FPS from stats (not just setting)
- **Verify:** Can see real FPS during stream

### Task 5.2: Add Input-to-Display Latency Measurement
- **File:** `src/services/WebRTCService.ts`
- **Action:** Use timestamp from controller packet to measure end-to-end latency
- **Verify:** E2E latency displayed in overlay

### Task 5.3: Add Audio/Video Sync Monitor
- **File:** `src/pages/StreamView.tsx`
- **Action:** Show A/V sync offset in debug overlay
- **Verify:** Can identify desync issues

---

## Done When
- [x] Controller input delay optimized (data channel priority: high, buffering: 0)
- [x] Video stream delay optimized (L1T1 scalability, contentHint: motion)
- [x] FPS matches user setting (maxFramerate enforced via RTCRtpSender)
- [x] Audio sample rate setting added (48kHz or 44.1kHz)
- [x] Audio bitrate matches setting (96-320 kbps)
- [x] Stats overlay shows real metrics (FPS, latency, packet loss, jitter)

---

## Technical Details

### Key WebRTC Parameters for Low Latency

| Parameter | Value | Reason |
|-----------|-------|--------|
| `priority` | `'high'` | Prioritize this stream |
| `networkPriority` | `'high'` | Network layer priority |
| `maxFramerate` | User setting | Enforce FPS |
| `maxBitrate` | User setting (bps) | Enforce bandwidth |
| `scalabilityMode` | `'L1T1'` | No temporal scalability = lower latency |
| `contentHint` | `'motion'` | Optimize for fast motion |

### SDP Modifications for Latency

```
a=x-google-flag:conference
b=AS:{bitrate}
a=fmtp:96 x-google-min-bitrate={min};x-google-max-bitrate={max}
a=fmtp:96 x-google-max-keyframe-interval=1000
```

---

## Agents Assigned

| Phase | Agent | Focus |
|-------|-------|-------|
| 1 | `backend-specialist` | Data channel optimization |
| 2-3 | `backend-specialist` | WebRTC encoder settings |
| 4 | `performance-optimizer` | Network tuning |
| 5 | `frontend-specialist` | Stats UI overlay |

---

## Notes
- These are AGGRESSIVE optimizations - prioritize latency over quality
- May increase bandwidth usage
- Some settings are Chrome/Electron specific (x-google-* flags)
