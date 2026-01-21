/**
 * VirtualControllerService - Xbox 360 controller emulation
 * Uses ViGEmBus to create a virtual Xbox controller and process input
 */

import type { GamepadInputState, decodeGamepadInput } from '../../shared/types/ipc';
import { XBOX_BUTTONS, isButtonPressed } from '../../shared/types/ipc';

// ViGEmClient types (these will come from the native module)
interface ViGEmClient {
    connect(): boolean;
    disconnect(): void;
    createX360Controller(): X360Controller | null;
}

interface X360Controller {
    connect(): boolean;
    disconnect(): void;
    updateButton(button: number, pressed: boolean): void;
    updateAxis(axis: number, value: number): void;
    updateTrigger(trigger: 'left' | 'right', value: number): void;
    update(report: X360Report): void;
}

interface X360Report {
    wButtons: number;
    bLeftTrigger: number;
    bRightTrigger: number;
    sThumbLX: number;
    sThumbLY: number;
    sThumbRX: number;
    sThumbRY: number;
}

// ViGEmBus button constants (Xbox 360 controller)
const VIGEM_BUTTONS = {
    DPAD_UP: 0x0001,
    DPAD_DOWN: 0x0002,
    DPAD_LEFT: 0x0004,
    DPAD_RIGHT: 0x0008,
    START: 0x0010,
    BACK: 0x0020,
    LEFT_THUMB: 0x0040,
    RIGHT_THUMB: 0x0080,
    LEFT_SHOULDER: 0x0100,
    RIGHT_SHOULDER: 0x0200,
    GUIDE: 0x0400,
    A: 0x1000,
    B: 0x2000,
    X: 0x4000,
    Y: 0x8000,
} as const;

export class VirtualControllerService {
    private client: ViGEmClient | null = null;
    private controller: X360Controller | null = null;
    private isConnected: boolean = false;
    private lastInputTimestamp: number = 0;

    /**
     * Create and connect a virtual Xbox 360 controller
     */
    async createController(): Promise<{ success: boolean; error?: string }> {
        try {
            // Dynamically import vigemclient to handle missing native module gracefully
            let vigemClient: ViGEmClient;

            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const ViGEm = require('vigemclient');
                vigemClient = new ViGEm.ViGEmClient();
            } catch (err) {
                console.warn('ViGEmClient native module not available:', err);
                // Return success for development without the driver
                return {
                    success: false,
                    error: 'ViGEmClient module not installed. Run: npm install vigemclient'
                };
            }

            // Connect to ViGEmBus driver
            if (!vigemClient.connect()) {
                return {
                    success: false,
                    error: 'Failed to connect to ViGEmBus. Is the driver installed?'
                };
            }

            this.client = vigemClient;

            // Create virtual Xbox 360 controller
            const controller = vigemClient.createX360Controller();
            if (!controller) {
                return { success: false, error: 'Failed to create virtual controller' };
            }

            // Connect the virtual controller (this makes it appear in Windows)
            if (!controller.connect()) {
                return { success: false, error: 'Failed to connect virtual controller' };
            }

            this.controller = controller;
            this.isConnected = true;

            console.log('Virtual Xbox 360 controller created successfully');
            return { success: true };
        } catch (error) {
            console.error('Error creating virtual controller:', error);
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
        try {
            if (this.controller) {
                this.controller.disconnect();
                this.controller = null;
            }

            if (this.client) {
                this.client.disconnect();
                this.client = null;
            }

            this.isConnected = false;
            console.log('Virtual controller destroyed');
        } catch (error) {
            console.error('Error destroying virtual controller:', error);
        }
    }

    /**
     * Update virtual controller with input from remote peer
     * Called for each received input packet
     */
    updateInput(input: GamepadInputState): void {
        if (!this.controller || !this.isConnected) {
            return;
        }

        // Drop outdated inputs (UDP-like behavior)
        if (input.timestamp <= this.lastInputTimestamp) {
            return;
        }
        this.lastInputTimestamp = input.timestamp;

        try {
            // Convert our button bitfield to ViGEm format
            let vigemButtons = 0;

            if (isButtonPressed(input.buttons, 'A')) vigemButtons |= VIGEM_BUTTONS.A;
            if (isButtonPressed(input.buttons, 'B')) vigemButtons |= VIGEM_BUTTONS.B;
            if (isButtonPressed(input.buttons, 'X')) vigemButtons |= VIGEM_BUTTONS.X;
            if (isButtonPressed(input.buttons, 'Y')) vigemButtons |= VIGEM_BUTTONS.Y;
            if (isButtonPressed(input.buttons, 'LB')) vigemButtons |= VIGEM_BUTTONS.LEFT_SHOULDER;
            if (isButtonPressed(input.buttons, 'RB')) vigemButtons |= VIGEM_BUTTONS.RIGHT_SHOULDER;
            if (isButtonPressed(input.buttons, 'BACK')) vigemButtons |= VIGEM_BUTTONS.BACK;
            if (isButtonPressed(input.buttons, 'START')) vigemButtons |= VIGEM_BUTTONS.START;
            if (isButtonPressed(input.buttons, 'LEFT_STICK')) vigemButtons |= VIGEM_BUTTONS.LEFT_THUMB;
            if (isButtonPressed(input.buttons, 'RIGHT_STICK')) vigemButtons |= VIGEM_BUTTONS.RIGHT_THUMB;
            if (isButtonPressed(input.buttons, 'DPAD_UP')) vigemButtons |= VIGEM_BUTTONS.DPAD_UP;
            if (isButtonPressed(input.buttons, 'DPAD_DOWN')) vigemButtons |= VIGEM_BUTTONS.DPAD_DOWN;
            if (isButtonPressed(input.buttons, 'DPAD_LEFT')) vigemButtons |= VIGEM_BUTTONS.DPAD_LEFT;
            if (isButtonPressed(input.buttons, 'DPAD_RIGHT')) vigemButtons |= VIGEM_BUTTONS.DPAD_RIGHT;
            if (isButtonPressed(input.buttons, 'GUIDE')) vigemButtons |= VIGEM_BUTTONS.GUIDE;

            // Build the input report
            const report: X360Report = {
                wButtons: vigemButtons,
                bLeftTrigger: Math.round(input.leftTrigger * 255),
                bRightTrigger: Math.round(input.rightTrigger * 255),
                sThumbLX: Math.round(input.leftStickX * 32767),
                sThumbLY: Math.round(input.leftStickY * 32767),
                sThumbRX: Math.round(input.rightStickX * 32767),
                sThumbRY: Math.round(input.rightStickY * 32767),
            };

            // Send the input report to the virtual controller
            this.controller.update(report);
        } catch (error) {
            console.error('Error updating virtual controller:', error);
        }
    }

    /**
     * Check if controller is currently active
     */
    isActive(): boolean {
        return this.isConnected && this.controller !== null;
    }
}
