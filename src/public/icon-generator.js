// Simple icon generator for PWA
// This creates basic SVG icons with the Claude Code logo

function generateIcon(size) {
    const svg = `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <rect width="${size}" height="${size}" fill="#1a1a1a" rx="${size * 0.1}"/>
            <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" 
                  font-family="monospace" font-size="${size * 0.4}px" font-weight="bold" fill="#ff6b00">
                CC
            </text>
        </svg>
    `;
    return 'data:image/svg+xml;base64,' + btoa(svg);
}

// Export for use in server
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { generateIcon };
}