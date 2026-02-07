/**
 * Tests for IPC type definitions and encoding/decoding functions
 */

import { describe, it, expect } from 'vitest';
import {
    encodeGamepadInput,
    decodeGamepadInput,
    isButtonPressed,
    setButton,
    XBOX_BUTTONS,
    GAMEPAD_PACKET_SIZE,
    type GamepadInputState,
} from '../../../shared/types/ipc';

describe('GamepadInputState Encoding/Decoding', () => {
    it('should encode and decode gamepad input correctly', () => {
        const input: GamepadInputState = {
            buttons: 0b1010101010101010, // Alternating pattern
            leftStickX: 0.5,
            leftStickY: -0.75,
            rightStickX: -0.25,
            rightStickY: 1.0,
            leftTrigger: 0.8,
            rightTrigger: 0.3,
            timestamp: Date.now(),
        };

        const encoded = encodeGamepadInput(input);
        expect(encoded.byteLength).toBe(GAMEPAD_PACKET_SIZE);

        const decoded = decodeGamepadInput(encoded);

        // Buttons should match exactly
        expect(decoded.buttons).toBe(input.buttons);

        // Analog values should be close (within precision limits)
        expect(decoded.leftStickX).toBeCloseTo(input.leftStickX, 4);
        expect(decoded.leftStickY).toBeCloseTo(input.leftStickY, 4);
        expect(decoded.rightStickX).toBeCloseTo(input.rightStickX, 4);
        expect(decoded.rightStickY).toBeCloseTo(input.rightStickY, 4);
        expect(decoded.leftTrigger).toBeCloseTo(input.leftTrigger, 4);
        expect(decoded.rightTrigger).toBeCloseTo(input.rightTrigger, 4);

        // Timestamp should match
        expect(decoded.timestamp).toBe(input.timestamp);
    });

    it('should handle edge case values correctly', () => {
        const input: GamepadInputState = {
            buttons: 0,
            leftStickX: -1.0,
            leftStickY: 1.0,
            rightStickX: 0.0,
            rightStickY: 0.0,
            leftTrigger: 0.0,
            rightTrigger: 1.0,
            timestamp: 0,
        };

        const encoded = encodeGamepadInput(input);
        const decoded = decodeGamepadInput(encoded);

        expect(decoded.leftStickX).toBeCloseTo(-1.0, 4);
        expect(decoded.leftStickY).toBeCloseTo(1.0, 4);
        expect(decoded.leftTrigger).toBe(0.0);
        expect(decoded.rightTrigger).toBeCloseTo(1.0, 4);
    });
});

describe('Button Helper Functions', () => {
    it('should correctly check if button is pressed', () => {
        const buttons = (1 << XBOX_BUTTONS.A) | (1 << XBOX_BUTTONS.B);

        expect(isButtonPressed(buttons, 'A')).toBe(true);
        expect(isButtonPressed(buttons, 'B')).toBe(true);
        expect(isButtonPressed(buttons, 'X')).toBe(false);
        expect(isButtonPressed(buttons, 'Y')).toBe(false);
    });

    it('should correctly set button state', () => {
        let buttons = 0;

        buttons = setButton(buttons, 'A', true);
        expect(isButtonPressed(buttons, 'A')).toBe(true);

        buttons = setButton(buttons, 'B', true);
        expect(isButtonPressed(buttons, 'A')).toBe(true);
        expect(isButtonPressed(buttons, 'B')).toBe(true);

        buttons = setButton(buttons, 'A', false);
        expect(isButtonPressed(buttons, 'A')).toBe(false);
        expect(isButtonPressed(buttons, 'B')).toBe(true);
    });

    it('should handle all Xbox buttons', () => {
        let buttons = 0;

        // Set all buttons
        Object.keys(XBOX_BUTTONS).forEach((button) => {
            buttons = setButton(buttons, button as keyof typeof XBOX_BUTTONS, true);
        });

        // Verify all buttons are set
        Object.keys(XBOX_BUTTONS).forEach((button) => {
            expect(isButtonPressed(buttons, button as keyof typeof XBOX_BUTTONS)).toBe(true);
        });
    });
});

describe('Packet Size Validation', () => {
    it('should always produce packets of correct size', () => {
        const testCases = [
            { buttons: 0, leftStickX: 0, leftStickY: 0, rightStickX: 0, rightStickY: 0, leftTrigger: 0, rightTrigger: 0, timestamp: 0 },
            { buttons: 0xFFFF, leftStickX: 1, leftStickY: 1, rightStickX: 1, rightStickY: 1, leftTrigger: 1, rightTrigger: 1, timestamp: Date.now() },
            { buttons: 0x5555, leftStickX: -1, leftStickY: -1, rightStickX: -1, rightStickY: -1, leftTrigger: 0.5, rightTrigger: 0.5, timestamp: 12345 },
        ];

        testCases.forEach((input) => {
            const encoded = encodeGamepadInput(input);
            expect(encoded.byteLength).toBe(GAMEPAD_PACKET_SIZE);
        });
    });
});
