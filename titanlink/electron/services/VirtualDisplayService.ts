/**
 * VirtualDisplayService - Manages Virtual Display Driver (VDD) integration
 * 
 * Uses the open-source Virtual Display Driver (VirtualDrivers/Virtual-Display-Driver)
 * to create virtual monitors for headless capture, custom resolutions, and improved
 * streaming performance.
 * 
 * Communication is done via named pipe: \\.\pipe\MTTVirtualDisplayPipe
 * Settings are managed via: C:\VirtualDisplayDriver\vdd_settings.xml
 */

import { EventEmitter } from 'events';
import { execSync, exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';

const LOG_PREFIX = '[VirtualDisplay]';

// VDD named pipe for driver communication
const VDD_PIPE_NAME = '\\\\.\\pipe\\MTTVirtualDisplayPipe';

// Default VDD settings path
const VDD_SETTINGS_PATH = 'C:\\VirtualDisplayDriver\\vdd_settings.xml';

export interface VirtualDisplayConfig {
    width: number;
    height: number;
    refreshRate: number;
}

export interface VirtualDisplayStatus {
    installed: boolean;
    driverVersion?: string;
    activeDisplays: number;
    displays: VirtualDisplayConfig[];
}

// Supported resolutions for quick selection
export const SUPPORTED_RESOLUTIONS: VirtualDisplayConfig[] = [
    { width: 1280, height: 720, refreshRate: 60 },
    { width: 1920, height: 1080, refreshRate: 60 },
    { width: 1920, height: 1080, refreshRate: 120 },
    { width: 1920, height: 1080, refreshRate: 144 },
    { width: 1920, height: 1080, refreshRate: 240 },
    { width: 2560, height: 1440, refreshRate: 60 },
    { width: 2560, height: 1440, refreshRate: 120 },
    { width: 2560, height: 1440, refreshRate: 144 },
    { width: 3840, height: 2160, refreshRate: 60 },
    { width: 3840, height: 2160, refreshRate: 120 },
];

export class VirtualDisplayService extends EventEmitter {
    private isDriverInstalled: boolean = false;
    private activeDisplays: VirtualDisplayConfig[] = [];

    constructor() {
        super();
        this.checkInstallation();
    }

    /**
     * Check if VDD is installed on the system
     */
    checkInstallation(): boolean {
        try {
            // Check if the VDD settings file exists (indicates installation)
            if (fs.existsSync(VDD_SETTINGS_PATH)) {
                this.isDriverInstalled = true;
                console.log(`${LOG_PREFIX} VDD found at ${VDD_SETTINGS_PATH}`);
                return true;
            }

            // Also check Device Manager for the driver
            const result = execSync(
                'powershell -Command "Get-PnpDevice | Where-Object { $_.FriendlyName -like \'*Virtual Display*\' -or $_.FriendlyName -like \'*IddSample*\' } | Select-Object -First 1 -ExpandProperty Status"',
                { timeout: 5000, encoding: 'utf8' }
            ).trim();

            if (result === 'OK') {
                this.isDriverInstalled = true;
                console.log(`${LOG_PREFIX} VDD driver found in Device Manager`);
                return true;
            }
        } catch (e) {
            // Driver not found - that's OK
        }

        this.isDriverInstalled = false;
        console.log(`${LOG_PREFIX} VDD not installed`);
        return false;
    }

    /**
     * Get the current status of the virtual display driver
     */
    getStatus(): VirtualDisplayStatus {
        return {
            installed: this.isDriverInstalled,
            activeDisplays: this.activeDisplays.length,
            displays: [...this.activeDisplays],
        };
    }

    /**
     * Send a command to the VDD driver via named pipe
     */
    private async sendPipeCommand(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const client = net.createConnection(VDD_PIPE_NAME, () => {
                client.write(command);
            });

            let responseData = '';

            client.on('data', (data) => {
                responseData += data.toString();
            });

            client.on('end', () => {
                resolve(responseData);
            });

            client.on('error', (err) => {
                reject(new Error(`${LOG_PREFIX} Pipe error: ${err.message}`));
            });

            // Timeout after 5 seconds
            setTimeout(() => {
                client.destroy();
                reject(new Error(`${LOG_PREFIX} Pipe command timed out`));
            }, 5000);
        });
    }

    /**
     * Write VDD settings XML with the desired display configurations
     */
    private writeSettingsXml(displays: VirtualDisplayConfig[]): void {
        const resolutionEntries = displays.map(d =>
            `    <resolution>
      <width>${d.width}</width>
      <height>${d.height}</height>
      <refresh_rate>${d.refreshRate}</refresh_rate>
    </resolution>`
        ).join('\n');

        const xml = `<?xml version="1.0" encoding="utf-8"?>
<vdd_settings>
  <number_of_displays>${displays.length}</number_of_displays>
  <gpu_affinity>0</gpu_affinity>
${resolutionEntries}
</vdd_settings>`;

        const dir = path.dirname(VDD_SETTINGS_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(VDD_SETTINGS_PATH, xml, 'utf8');
        console.log(`${LOG_PREFIX} Settings XML written: ${displays.length} display(s)`);
    }

    /**
     * Read current settings from VDD settings XML
     */
    private readSettingsXml(): VirtualDisplayConfig[] {
        if (!fs.existsSync(VDD_SETTINGS_PATH)) return [];

        try {
            const content = fs.readFileSync(VDD_SETTINGS_PATH, 'utf8');
            const displays: VirtualDisplayConfig[] = [];

            // Simple XML parsing for resolution entries
            const resBlocks = content.match(/<resolution>[\s\S]*?<\/resolution>/g) || [];
            for (const block of resBlocks) {
                const width = parseInt(block.match(/<width>(\d+)<\/width>/)?.[1] || '1920');
                const height = parseInt(block.match(/<height>(\d+)<\/height>/)?.[1] || '1080');
                const refreshRate = parseInt(block.match(/<refresh_rate>(\d+)<\/refresh_rate>/)?.[1] || '60');
                displays.push({ width, height, refreshRate });
            }

            return displays;
        } catch (e) {
            console.error(`${LOG_PREFIX} Failed to read settings XML:`, e);
            return [];
        }
    }

    /**
     * Create a virtual display with the specified configuration
     */
    async createDisplay(config: VirtualDisplayConfig): Promise<boolean> {
        if (!this.isDriverInstalled) {
            console.error(`${LOG_PREFIX} VDD not installed`);
            return false;
        }

        try {
            // Read existing displays, add new one
            const existing = this.readSettingsXml();
            const newDisplays = [...existing, config];

            // Write updated settings
            this.writeSettingsXml(newDisplays);

            // Notify driver to reload settings via pipe
            try {
                await this.sendPipeCommand('reload');
                console.log(`${LOG_PREFIX} Driver notified to reload settings`);
            } catch (pipeErr) {
                // Pipe may not be available - try restarting the driver device
                console.warn(`${LOG_PREFIX} Pipe notification failed, attempting device restart`);
                this.restartDriver();
            }

            this.activeDisplays = newDisplays;
            this.emit('display-created', config);
            console.log(`${LOG_PREFIX} Virtual display created: ${config.width}x${config.height}@${config.refreshRate}Hz`);
            return true;
        } catch (e) {
            console.error(`${LOG_PREFIX} Failed to create virtual display:`, e);
            return false;
        }
    }

    /**
     * Remove all virtual displays
     */
    async removeAllDisplays(): Promise<boolean> {
        if (!this.isDriverInstalled) return false;

        try {
            // Write empty settings
            this.writeSettingsXml([]);

            // Notify driver
            try {
                await this.sendPipeCommand('reload');
            } catch {
                this.restartDriver();
            }

            this.activeDisplays = [];
            this.emit('displays-removed');
            console.log(`${LOG_PREFIX} All virtual displays removed`);
            return true;
        } catch (e) {
            console.error(`${LOG_PREFIX} Failed to remove displays:`, e);
            return false;
        }
    }

    /**
     * Remove a specific virtual display by index
     */
    async removeDisplay(index: number): Promise<boolean> {
        if (!this.isDriverInstalled) return false;

        try {
            const existing = this.readSettingsXml();
            if (index < 0 || index >= existing.length) return false;

            existing.splice(index, 1);
            this.writeSettingsXml(existing);

            try {
                await this.sendPipeCommand('reload');
            } catch {
                this.restartDriver();
            }

            this.activeDisplays = existing;
            this.emit('display-removed', index);
            return true;
        } catch (e) {
            console.error(`${LOG_PREFIX} Failed to remove display:`, e);
            return false;
        }
    }

    /**
     * Restart the VDD driver to apply settings changes
     */
    private restartDriver(): void {
        try {
            // Disable and re-enable the driver via elevated PowerShell
            const script = `Get-PnpDevice | Where-Object { $_.FriendlyName -like '*Virtual Display*' -or $_.FriendlyName -like '*IddSample*' } | Disable-PnpDevice -Confirm:$false; Start-Sleep -Seconds 1; Get-PnpDevice | Where-Object { $_.FriendlyName -like '*Virtual Display*' -or $_.FriendlyName -like '*IddSample*' } | Enable-PnpDevice -Confirm:$false`;
            const command = `powershell -Command "Start-Process powershell -ArgumentList '-Command \"${script}\"' -Verb RunAs -Wait"`;

            execSync(command, { timeout: 30000 });
            console.log(`${LOG_PREFIX} Driver restart command sent (elevated)`);
        } catch (e) {
            console.error(`${LOG_PREFIX} Failed to restart driver:`, e);
        }
    }

    /**
     * Install VDD via winget (requires user approval since it needs admin)
     */
    async installDriver(): Promise<{ success: boolean; message: string }> {
        return new Promise((resolve) => {
            exec(
                'winget install --id=VirtualDrivers.Virtual-Display-Driver -e --accept-package-agreements --accept-source-agreements',
                { timeout: 120000 },
                (error, stdout, stderr) => {
                    if (error) {
                        console.error(`${LOG_PREFIX} Install failed:`, error.message);
                        resolve({
                            success: false,
                            message: `Installation failed: ${error.message}. Try installing manually from https://github.com/VirtualDrivers/Virtual-Display-Driver/releases`
                        });
                        return;
                    }

                    // Re-check installation
                    this.checkInstallation();

                    resolve({
                        success: true,
                        message: 'Virtual Display Driver installed successfully. You may need to restart your computer.'
                    });
                }
            );
        });
    }

    /**
     * Cleanup - remove all virtual displays on shutdown
     */
    async cleanup(): Promise<void> {
        if (this.activeDisplays.length > 0) {
            console.log(`${LOG_PREFIX} Cleaning up ${this.activeDisplays.length} virtual display(s)`);
            await this.removeAllDisplays();
        }
    }
}

// Singleton instance
export const virtualDisplayService = new VirtualDisplayService();
