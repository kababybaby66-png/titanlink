    # Verifying the NVENC Fix

I have rebuilt the native addon with a specific visual marker to confirm it is loaded correctly.

## Steps

1.  **Stop the running server**: Click in your terminal and press `Ctrl+C`.
2.  **Restart the server**: Run `npm run dev`.
3.  **Check the logs**:
    *   Look for the line: `[HardwareCapture] Health check: TitanLink Capture Native Addon v0.1.0 - NVENC FIX ENABLED (Build v2)`
    *   Look for: `[NVENC] Loaded DLL from explicit path: ...` (if the fallback is triggered).

## Troubleshooting

If you still see "Using software encoder":
*   Ensure you are checking the logs from the *Main* process (lines starting with `[Main]` or `[HardwareCapture]`), not just the renderer.
*   Check if `nvEncodeAPI64.dll` exists in `C:\Windows\System32`.
