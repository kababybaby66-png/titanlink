// Test script to verify native module loading
const path = require('path');
const fs = require('fs');

const binaryName = `titanlink-capture.${process.platform}-${process.arch}-msvc.node`;
const binaryPath = path.join(__dirname, binaryName);

console.log('=== Native Module Test ===');
console.log('Platform:', process.platform);
console.log('Arch:', process.arch);
console.log('Binary name:', binaryName);
console.log('Binary path:', binaryPath);
console.log('File exists:', fs.existsSync(binaryPath));

if (fs.existsSync(binaryPath)) {
    try {
        const native = require(binaryPath);
        console.log('✅ Native module loaded successfully!');
        console.log('Health check:', native.healthCheck());
        console.log('Encoder support:', native.getEncoderSupport());
    } catch (e) {
        console.error('❌ Failed to load native module:', e.message);
        console.error('Stack:', e.stack);
    }
} else {
    console.error('❌ Binary file not found!');
}
