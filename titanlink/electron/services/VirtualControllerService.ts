/**
 * VirtualControllerService - Xbox 360 controller emulation
 * Uses a helper executable (vigem-feeder.exe) to inject controller input via ViGEmBus
 * This approach avoids native Node.js module compilation issues
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import { hardwareCaptureService } from './HardwareCaptureService';
import type { GamepadInputState } from '../../shared/types/ipc';
import { isButtonPressed } from '../../shared/types/ipc';

export class VirtualControllerService {
    private feederProcess: ChildProcess | null = null;
    private isConnected: boolean = false;
    private lastInputTimestamp: number = 0;
    private inputCount: number = 0;

    /**
     * Get the path to the vigem-feeder executable
     */
    private getFeederPath(): string {
        // In development, look in resources/bin
        // In production, look in the app's resources folder
        const isDev = !app.isPackaged;

        if (isDev) {
            return path.join(process.cwd(), 'resources', 'bin', 'vigem-feeder.exe');
        } else {
            return path.join(process.resourcesPath, 'bin', 'vigem-feeder.exe');
        }
    }

    /**
     * Create and connect a virtual Xbox 360 controller (or Mac KBM emulator)
     */
    async createController(): Promise<{ success: boolean; error?: string }> {
        if (process.platform === 'darwin') {
            // Mac MVP: We emulate KBM using CGEvent, so no process needed
            console.log('[VirtualController] macOS detected, utilizing native KBM CGEvent injection instead of ViGEmBus');
            this.isConnected = true;
            return { success: true };
        }

        try {
            const feederPath = this.getFeederPath();

            console.log('[VirtualController] isDev:', !app.isPackaged);
            console.log('[VirtualController] process.cwd():', process.cwd());
            console.log('[VirtualController] Feeder path:', feederPath);

            // Check if the feeder executable exists
            const fs = await import('fs');
            try {
                await fs.promises.access(feederPath, fs.constants.F_OK);
            } catch (error) {
                console.error('[VirtualController] Vigem feeder NOT FOUND at:', feederPath);
                return {
                    success: false,
                    error: `Virtual controller helper not found at: ${feederPath}`
                };
            }

            console.log('[VirtualController] Feeder executable found, starting...');

            // Spawn the feeder process
            this.feederProcess = spawn(feederPath, [], {
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
            });

            // Handle stdout (success/error messages from feeder)
            this.feederProcess.stdout?.on('data', (data: Buffer) => {
                const message = data.toString().trim();
                console.log('[Feeder]', message);

                if (message.includes('CONNECTED')) {
                    this.isConnected = true;
                }
            });

            // Handle stderr
            this.feederProcess.stderr?.on('data', (data: Buffer) => {
                console.error('[Feeder Error]', data.toString().trim());
            });

            // Handle process exit
            this.feederProcess.on('exit', (code) => {
                console.log('[Feeder] Process exited with code:', code);
                this.isConnected = false;
                this.feederProcess = null;
            });

            this.feederProcess.on('error', (err: Error) => {
                console.error('[Feeder] Process error:', err);
                this.isConnected = false;
            });

            // Wait a bit for the process to initialize
            await new Promise(resolve => setTimeout(resolve, 500));

            if (this.feederProcess && !this.feederProcess.killed) {
                console.log('[VirtualController] Virtual Xbox 360 controller helper started');
                this.isConnected = true;
                return { success: true };
            } else {
                return { success: false, error: 'Feeder process failed to start' };
            }
        } catch (error) {
            console.error('[VirtualController] Error creating virtual controller:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Destroy the virtual controller and disconnect
     */
    async destroyController(): Promise<void> {
        if (process.platform === 'darwin') {
            this.isConnected = false;
            console.log('[VirtualController] macOS CGEvent injection disconnected');
            return;
        }

        try {
            const process = this.feederProcess;
            if (process) {
                // Remove reference immediately to prevent race conditions
                this.feederProcess = null;

                // Send quit command
                process.stdin?.write('QUIT\n');

                // Give it a moment to clean up
                await new Promise(resolve => setTimeout(resolve, 100));

                // Force kill if still running
                if (!process.killed) {
                    process.kill();
                }
            }

            this.isConnected = false;
            console.log('[VirtualController] Virtual controller destroyed');
        } catch (error) {
            console.error('[VirtualController] Error destroying virtual controller:', error);
        }
    }

    /**
     * Update virtual controller with input from remote peer
     * Called for each received input packet
     */
    updateInput(input: GamepadInputState): void {
        if (process.platform === 'darwin') {
            this.updateInputMac(input);
            return;
        }
        if (!this.feederProcess || !this.isConnected) {
            return;
        }

        // Drop outdated inputs (UDP-like behavior)
        if (input.timestamp <= this.lastInputTimestamp) {
            return;
        }
        this.lastInputTimestamp = input.timestamp;

        try {
            // Build button flags
            let buttons = 0;
            if (isButtonPressed(input.buttons, 'DPAD_UP')) buttons |= 0x0001;
            if (isButtonPressed(input.buttons, 'DPAD_DOWN')) buttons |= 0x0002;
            if (isButtonPressed(input.buttons, 'DPAD_LEFT')) buttons |= 0x0004;
            if (isButtonPressed(input.buttons, 'DPAD_RIGHT')) buttons |= 0x0008;
            if (isButtonPressed(input.buttons, 'START')) buttons |= 0x0010;
            if (isButtonPressed(input.buttons, 'BACK')) buttons |= 0x0020;
            if (isButtonPressed(input.buttons, 'LEFT_STICK')) buttons |= 0x0040;
            if (isButtonPressed(input.buttons, 'RIGHT_STICK')) buttons |= 0x0080;
            if (isButtonPressed(input.buttons, 'LB')) buttons |= 0x0100;
            if (isButtonPressed(input.buttons, 'RB')) buttons |= 0x0200;
            if (isButtonPressed(input.buttons, 'GUIDE')) buttons |= 0x0400;
            if (isButtonPressed(input.buttons, 'A')) buttons |= 0x1000;
            if (isButtonPressed(input.buttons, 'B')) buttons |= 0x2000;
            if (isButtonPressed(input.buttons, 'X')) buttons |= 0x4000;
            if (isButtonPressed(input.buttons, 'Y')) buttons |= 0x8000;

            // Convert analog values to Xbox 360 format
            const leftTrigger = Math.round(input.leftTrigger * 255);
            const rightTrigger = Math.round(input.rightTrigger * 255);
            const thumbLX = Math.round(input.leftStickX * 32767);
            const thumbLY = Math.round(-input.leftStickY * 32767); // Invert Y axis
            const thumbRX = Math.round(input.rightStickX * 32767);
            const thumbRY = Math.round(-input.rightStickY * 32767); // Invert Y axis

            // Send input line to feeder: buttons,LT,RT,LX,LY,RX,RY
            const inputLine = `${buttons},${leftTrigger},${rightTrigger},${thumbLX},${thumbLY},${thumbRX},${thumbRY}\n`;

            this.feederProcess.stdin?.write(inputLine);

            // Log every 100 inputs to confirm data is being sent
            this.inputCount++;
            if (this.inputCount % 100 === 0) {
                console.log(`[VirtualController] Sent ${this.inputCount} inputs. Last: buttons=${buttons}, LX=${thumbLX}, LY=${thumbLY}`);
            }
        } catch (error) {
            console.error('[VirtualController] Error updating virtual controller:', error);
        }
    }

    /**
     * Map Gamepad input to basic macOS Mouse/Keyboard events (MVP)
     */
    private updateInputMac(input: GamepadInputState): void {
        // Drop outdated inputs
        if (input.timestamp <= this.lastInputTimestamp) {
            return;
        }
        this.lastInputTimestamp = input.timestamp;

        try {
            // Emulate basic mouse movement using Right Stick
            if (Math.abs(input.rightStickX) > 0.1 || Math.abs(input.rightStickY) > 0.1) {
                // In production, we need a way to move relatively.
                // For MVP, we pass a dummy 'mouse' type which moves to an absolute coordinate,
                // but we would need relative displacement. We will send a basic event for now.
                // CGEvent in MacHostCapture handles absolute (x,y) currently.
            }

            // Emulate basic clicks (A = Left click, B = Right click)
            const leftClick = isButtonPressed(input.buttons, 'A');
            const rightClick = isButtonPressed(input.buttons, 'B');

            if (leftClick) {
                hardwareCaptureService.injectInput({ type: 'mouse', button: 'left', down: true });
            } else {
                hardwareCaptureService.injectInput({ type: 'mouse', button: 'left', down: false });
            }

            if (rightClick) {
                hardwareCaptureService.injectInput({ type: 'mouse', button: 'right', down: true });
            } else {
                hardwareCaptureService.injectInput({ type: 'mouse', button: 'right', down: false });
            }

            // Map D-Pad or Left Stick to arrow keys (WASD could also work)
            // macOS CGKeyCode: W=13, A=0, S=1, D=2, Up=126, Down=125, Left=123, Right=124
            const up = isButtonPressed(input.buttons, 'DPAD_UP') || input.leftStickY < -0.5;
            const down = isButtonPressed(input.buttons, 'DPAD_DOWN') || input.leftStickY > 0.5;
            const left = isButtonPressed(input.buttons, 'DPAD_LEFT') || input.leftStickX < -0.5;
            const right = isButtonPressed(input.buttons, 'DPAD_RIGHT') || input.leftStickX > 0.5;

            hardwareCaptureService.injectInput({ type: 'key', keyCode: 126, down: up });
            hardwareCaptureService.injectInput({ type: 'key', keyCode: 125, down: down });
            hardwareCaptureService.injectInput({ type: 'key', keyCode: 123, down: left });
            hardwareCaptureService.injectInput({ type: 'key', keyCode: 124, down: right });

        } catch (error) {
            console.error('[VirtualController] Error injecting mac input:', error);
        }
    }

    /**
     * Check if controller is currently active
     */
    isActive(): boolean {
        return this.isConnected;
    }
}
