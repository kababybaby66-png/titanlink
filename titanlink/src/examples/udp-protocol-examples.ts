/**
 * TitanLink Custom UDP Protocol - Usage Example
 * 
 * This example shows how to use the custom UDP protocol for cloud gaming
 */

import { SmartConnectionManager, ConnectionMode } from '../lib/network/SmartConnectionManager';

// Example 1: Host (streaming TO client)
async function startHosting() {
    const connection = new SmartConnectionManager();

    // Connect to client (will try P2P, fallback to relay)
    await connection.connect({
        sessionId: '12345678',  // Unique session ID
        peerIp: '192.168.1.100',  // Client's IP (for P2P attempt)
        peerPort: 5000,
        relayIp: '123.45.67.89',  // Your Oracle VM IP
        relayPort: 5000,
        p2pTimeoutMs: 500,  // Switch to relay if P2P doesn't respond in 500ms
    });

    console.log('Connected via:', connection.getMode());  // 'p2p' or 'relay'

    // Send video frames (fire-and-forget)
    let frameNumber = 0;
    setInterval(() => {
        // In real app, this comes from your hardware capture pipeline
        const encodedFrame = Buffer.from([/* H264/H265 data */]);

        connection.sendVideoFrame(
            frameNumber++,
            1,  // Codec: 1=H264, 2=H265
            frameNumber % 60 === 0,  // Keyframe every 60 frames
            encodedFrame,
        );
    }, 16);  // 60 FPS = ~16ms per frame

    // Monitor connection stats
    setInterval(() => {
        const stats = connection.getStats();
        console.log('Mode:', stats.mode);
        console.log('Sent:', (stats.bytesSent / 1024 / 1024).toFixed(2), 'MB');
    }, 10000);
}

// Example 2: Client (receiving stream FROM host)
async function startClient() {
    const connection = new SmartConnectionManager();

    // Connect to host (relay only, no P2P from client side yet)
    await connection.connect({
        sessionId: '12345678',  // Same session ID as host
        relayIp: '123.45.67.89',  // Oracle relay server
        relayPort: 5000,
    });

    console.log('Connected to host via relay');

    // Send controller input (reliable delivery)
    setInterval(() => {
        // Example: Xbox controller state
        connection.sendControllerInput(
            0,  // Controller index
            0b1010,  // Buttons: A (bit 1) and Y (bit 3) pressed
            15000,  // Left stick X
            -8000,  // Left stick Y
            0,  // Right stick X
            0,  // Right stick Y
            128,  // Left trigger (half pressed)
            0,  // Right trigger
        );
    }, 16);  // Send input at 60 Hz
}

// Example 3: Switching between P2P and Relay
async function monitorConnection() {
    const connection = new SmartConnectionManager();

    await connection.connect({
        sessionId: '12345678',
        peerIp: '192.168.1.100',
        relayIp: '123.45.67.89',
    });

    // Initially tries P2P
    console.log('Initial mode:', connection.getMode());  // 'connecting' or 'p2p'

    // After 500ms, if P2P didn't work, automatically switches to relay
    setTimeout(() => {
        console.log('Current mode:', connection.getMode());  // 'p2p' or 'relay'

        if (connection.getMode() === ConnectionMode.RELAY) {
            console.log('Using relay server - connection guaranteed!');
        } else {
            console.log('Direct P2P connection - lowest latency!');
        }
    }, 1000);
}

// Example 4: Integration with Hardware Capture Pipeline
// Note: Uncomment after running 'npm run build' to generate NAPI-RS types
/*
async function integrateWithCapture() {
  const connection = new SmartConnectionManager();
  
  await connection.connect({
    sessionId: '12345678',
    relayIp: '123.45.67.89',
  });
  
  // Start hardware capture (DXGI + NVENC)
  // Requires: import { start_capture, EncodedFrame } from '../../index.node';
  start_capture(
    {
      display_index: 0,
      fps: 60,
      bitrate: 10_000_000,  // 10 Mbps
      use_hardware_encoder: true,
    },
    (frame: any) => {
      // Send each encoded frame over custom UDP
      connection.sendVideoFrame(
        frame.frame_number,
        1,  // H264
        frame.is_keyframe,
        frame.data,
      );
    }
  );
  
  console.log('Streaming with hardware acceleration + custom UDP protocol!');
}
*/

// Example 5: Error Handling and Cleanup
async function robustConnection() {
    const connection = new SmartConnectionManager();

    try {
        await connection.connect({
            sessionId: '12345678',
            relayIp: '123.45.67.89',
        });

        // Use connection...

    } catch (error) {
        console.error('Connection failed:', error);
    } finally {
        // Always cleanup
        connection.disconnect();
    }
}

export {
    startHosting,
    startClient,
    monitorConnection,
    // integrateWithCapture,  // Uncomment after NAPI-RS types are generated
    robustConnection,
};
