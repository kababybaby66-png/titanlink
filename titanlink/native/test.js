// Test the native addon

const { healthCheck, getEncoderSupport, getDisplays } = require('./index.js');

console.log('=== TitanLink Capture Native Addon Test ===\n');

// Test health check
console.log('Health Check:', healthCheck());

// Test encoder support
console.log('\nEncoder Support:');
const encoders = getEncoderSupport();
console.log('  NVENC:', encoders.nvenc ? '✓ Available' : '✗ Not available');
console.log('  AMF:', encoders.amf ? '✓ Available' : '✗ Not available');
console.log('  QuickSync:', encoders.quicksync ? '✓ Available' : '✗ Not available');
console.log('  Software:', encoders.software ? '✓ Available' : '✗ Not available');

// Test display enumeration
console.log('\nAvailable Displays:');
try {
    const displays = getDisplays();
    displays.forEach((d, i) => {
        console.log(`  [${d.index}] ${d.name} - ${d.width}x${d.height}${d.isPrimary ? ' (Primary)' : ''}`);
    });
} catch (e) {
    console.log('  Error getting displays:', e.message);
}

console.log('\n=== Test Complete ===');
