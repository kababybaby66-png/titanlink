/**
 * DriverManager - ViGEmBus driver detection and installation
 * Handles checking for and installing the virtual controller driver
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { DriverCheckResult, DriverStatus } from '../../shared/types/ipc';

const execAsync = promisify(exec);

export class DriverManager {
    private vigemStatus: DriverStatus = 'checking';

    // Path to bundled ViGEmBus installer in resources
    private get vigemInstallerPath(): string {
        if (app.isPackaged) {
            return path.join(process.resourcesPath, 'resources', 'ViGEmBusSetup_x64.msi');
        }
        return path.join(app.getAppPath(), 'resources', 'ViGEmBusSetup_x64.msi');
    }

    /**
     * Check if ViGEmBus driver is installed
     * Uses Windows registry and service check
     */
    async checkDriverStatus(): Promise<DriverCheckResult> {
        this.vigemStatus = 'checking';

        try {
            // Method 1: Check for ViGEmBus service
            const serviceCheck = await this.checkViGEmService();
            if (serviceCheck) {
                this.vigemStatus = 'installed';
                return { vigembus: 'installed', message: 'ViGEmBus driver is installed and running' };
            }

            // Method 2: Check Windows registry for ViGEmBus
            const registryCheck = await this.checkViGEmRegistry();
            if (registryCheck) {
                this.vigemStatus = 'installed';
                return { vigembus: 'installed', message: 'ViGEmBus driver is installed' };
            }

            // Method 3: Check for driver files
            const fileCheck = await this.checkViGEmFiles();
            if (fileCheck) {
                this.vigemStatus = 'installed';
                return { vigembus: 'installed', message: 'ViGEmBus driver files found' };
            }

            this.vigemStatus = 'not-installed';
            return {
                vigembus: 'not-installed',
                message: 'ViGEmBus driver is not installed. Required for controller emulation.'
            };
        } catch (error) {
            console.error('Error checking driver status:', error);
            this.vigemStatus = 'error';
            return {
                vigembus: 'error',
                message: `Error checking driver: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    /**
     * Check if ViGEmBus Windows service exists and is running
     */
    private async checkViGEmService(): Promise<boolean> {
        try {
            const { stdout } = await execAsync('sc query ViGEmBus', { windowsHide: true });
            return stdout.includes('RUNNING') || stdout.includes('STATE');
        } catch {
            return false;
        }
    }

    /**
     * Check Windows registry for ViGEmBus installation
     */
    private async checkViGEmRegistry(): Promise<boolean> {
        try {
            const { stdout } = await execAsync(
                'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Services\\ViGEmBus" /v ImagePath',
                { windowsHide: true }
            );
            return stdout.includes('ViGEmBus');
        } catch {
            return false;
        }
    }

    /**
     * Check for ViGEmBus driver files
     */
    private async checkViGEmFiles(): Promise<boolean> {
        const possiblePaths = [
            'C:\\Program Files\\ViGEmBus',
            'C:\\Program Files\\Nefarius\\ViGEmBus',
            path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'drivers', 'ViGEmBus.sys'),
        ];

        for (const p of possiblePaths) {
            try {
                await fs.promises.access(p, fs.constants.F_OK);
                return true;
            } catch {
                continue;
            }
        }
        return false;
    }

    /**
     * Install ViGEmBus driver
     * Launches the MSI installer with admin privileges
     */
    async installViGEmBus(): Promise<{ success: boolean; error?: string }> {
        try {
            // Check if installer exists
            try {
                await fs.promises.access(this.vigemInstallerPath, fs.constants.F_OK);
            } catch {
                // Fallback: Open download page if installer is included
                const { shell } = await import('electron');
                await shell.openExternal('https://github.com/nefarius/ViGEmBus/releases/latest');
                return {
                    success: false,
                    error: 'Installer not found locally. Opened download page in browser.'
                };
            }

            // Launch MSI installer with elevated privileges
            return new Promise((resolve) => {
                const installer = spawn('msiexec', ['/i', this.vigemInstallerPath, '/passive', '/norestart'], {
                    shell: true,
                    stdio: 'ignore',
                    detached: true,
                });

                installer.on('close', async (code) => {
                    if (code === 0) {
                        // Re-check driver status after installation
                        await this.checkDriverStatus();
                        resolve({ success: true });
                    } else {
                        resolve({ success: false, error: `Installer exited with code ${code}` });
                    }
                });

                installer.on('error', (err) => {
                    resolve({ success: false, error: err.message });
                });

                // Don't wait for installer if running detached
                installer.unref();
            });
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error during installation'
            };
        }
    }

    /**
     * Open ViGEmBus download page in browser
     */
    async openDownloadPage(): Promise<void> {
        const { shell } = await import('electron');
        await shell.openExternal('https://github.com/nefarius/ViGEmBus/releases/latest');
    }

    /**
     * Get current driver status
     */
    getStatus(): DriverStatus {
        return this.vigemStatus;
    }
}
