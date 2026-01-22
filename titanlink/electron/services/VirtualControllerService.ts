/**
 * VirtualControllerService - Xbox 360 controller emulation
 * Uses ViGEmBus via vigemclient npm package to create a virtual Xbox controller and process input
 */

import type { GamepadInputState } from '../../shared/types/ipc';
import { isButtonPressed } from '../../shared/types/ipc';

// ViGEmClient types from the vigemclient npm package
interface ViGEmClient {
    connect(): Error | null;
    createX360Controller(): X360Controller;
}

interface InputButton {
    setValue(pressed: boolean): void;
}

interface InputAxis {
    setValue(value: number): void;
}

interface X360Controller {
    connect(opts?: object): Error | null;
    disconnect(): Error | null;
    updateMode: 'auto' | 'manual';
    button: {
        A: InputButton;
        B: InputButton;
        X: InputButton;
        Y: InputButton;
        START: InputButton;
        BACK: InputButton;
        LEFT_THUMB: InputButton;
        RIGHT_THUMB: InputButton;
        LEFT_SHOULDER: InputButton;
        RIGHT_SHOULDER: InputButton;
        GUIDE: InputButton;
    };
    axis: {
        leftX: InputAxis;
        leftY: InputAxis;
        rightX: InputAxis;
        rightY: InputAxis;
        leftTrigger: InputAxis;
        rightTrigger: InputAxis;
        dpadHorz: InputAxis;
        dpadVert: InputAxis;
    };
    update(): void;
}

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
            let ViGEmClientClass: new () => ViGEmClient;

            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const ViGEm = require('vigemclient');
                ViGEmClientClass = ViGEm;
            } catch (err) {
                console.warn('ViGEmClient native module not available:', err);
                // Return error for missing module
                return {
                    success: false,
                    error: 'ViGEmClient module not installed. Run: npm install vigemclient'
                };
            }

            // Create client instance
            const vigemClient = new ViGEmClientClass();

            // Connect to ViGEmBus driver
            const connectError = vigemClient.connect();
            if (connectError !== null) {
                return {
                    success: false,
                    error: `Failed to connect to ViGEmBus: ${connectError.message}. Is the driver installed?`
                };
            }

            this.client = vigemClient;

            // Create virtual Xbox 360 controller
            const controller = vigemClient.createX360Controller();
            if (!controller) {
                return { success: false, error: 'Failed to create virtual controller' };
            }

            // Connect the virtual controller (this makes it appear in Windows)
            const controllerConnectError = controller.connect();
            if (controllerConnectError !== null) {
                return { success: false, error: `Failed to connect virtual controller: ${controllerConnectError.message}` };
            }

            // Set to manual update mode for better performance when updating multiple values at once
            controller.updateMode = 'manual';

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

            // Note: vigemclient doesn't have a disconnect method on the client itself
            this.client = null;

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
            const ctrl = this.controller;

            // Update buttons using the correct vigemclient API
            ctrl.button.A.setValue(isButtonPressed(input.buttons, 'A'));
            ctrl.button.B.setValue(isButtonPressed(input.buttons, 'B'));
            ctrl.button.X.setValue(isButtonPressed(input.buttons, 'X'));
            ctrl.button.Y.setValue(isButtonPressed(input.buttons, 'Y'));
            ctrl.button.LEFT_SHOULDER.setValue(isButtonPressed(input.buttons, 'LB'));
            ctrl.button.RIGHT_SHOULDER.setValue(isButtonPressed(input.buttons, 'RB'));
            ctrl.button.BACK.setValue(isButtonPressed(input.buttons, 'BACK'));
            ctrl.button.START.setValue(isButtonPressed(input.buttons, 'START'));
            ctrl.button.LEFT_THUMB.setValue(isButtonPressed(input.buttons, 'LEFT_STICK'));
            ctrl.button.RIGHT_THUMB.setValue(isButtonPressed(input.buttons, 'RIGHT_STICK'));
            ctrl.button.GUIDE.setValue(isButtonPressed(input.buttons, 'GUIDE'));

            // Update axes (vigemclient uses -1 to 1 range for sticks)
            ctrl.axis.leftX.setValue(input.leftStickX);
            ctrl.axis.leftY.setValue(input.leftStickY);
            ctrl.axis.rightX.setValue(input.rightStickX);
            ctrl.axis.rightY.setValue(input.rightStickY);

            // Update triggers (vigemclient uses 0 to 1 range for triggers)
            ctrl.axis.leftTrigger.setValue(input.leftTrigger);
            ctrl.axis.rightTrigger.setValue(input.rightTrigger);

            // Handle D-Pad via axis values
            // dpadHorz: -1 = left, 0 = neutral, 1 = right
            // dpadVert: -1 = up, 0 = neutral, 1 = down
            let dpadHorz = 0;
            let dpadVert = 0;

            if (isButtonPressed(input.buttons, 'DPAD_LEFT')) dpadHorz = -1;
            else if (isButtonPressed(input.buttons, 'DPAD_RIGHT')) dpadHorz = 1;

            if (isButtonPressed(input.buttons, 'DPAD_UP')) dpadVert = -1;
            else if (isButtonPressed(input.buttons, 'DPAD_DOWN')) dpadVert = 1;

            ctrl.axis.dpadHorz.setValue(dpadHorz);
            ctrl.axis.dpadVert.setValue(dpadVert);

            // Submit all updates to the driver (since we're in manual mode)
            ctrl.update();
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
