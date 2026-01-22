# How to Compile TitanLink on macOS

Follow these steps to build the TitanLink application on a Mac.

## 1. Prerequisites
Ensure you have the following installed on your Mac:
*   **Node.js (v18 or newer):** Download from [nodejs.org](https://nodejs.org/).
*   **Git:** usually pre-installed, or download from [git-scm.com](https://git-scm.com/).

## 2. Get the Code
Open the **Terminal** app and run:

```bash
git clone https://github.com/kababybaby66-png/titanlink.git
cd titanlink
cd titanlink
```
*(Note: we enter the inner `titanlink` folder where the code lives)*

## 3. Install Dependencies
Run the following command to download all required libraries:

```bash
npm install
```

## 4. Build the App
Run the build script we configured:

```bash
npm run build:mac
```

## 5. Locate the App
Once the command finishes successfully, your Mac app will be in the `release` folder:
*   **`titanlink/release/TitanLink-1.0.6-mac.zip`** (Portable)
*   **`titanlink/release/TitanLink-1.0.6.dmg`** (Installer)

## Troubleshooting
*   **"App is damaged" or "Cannot be opened":** Since we are not paying for an Apple Developer Certificate ($99/year), the app is "unsigned".
    *   **Fix:** Right-click the app and select **Open**, then click **Open** again in the dialog. You only need to do this once.
*   **Build Error:** If you see errors about `bufferutil` or optional dependencies, run `npm install --no-optional` instead of step 3.
