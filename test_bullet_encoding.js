/**
 * Test bullet character encoding
 */

// Test what happens when bullet chars are URL encoded
const bullets = {
  'main': '•',      // U+2022
  'sub': '◦',       // U+25E6
  'subsub': '▪'     // U+25AA
};

console.log('Bullet characters:');
Object.entries(bullets).forEach(([name, char]) => {
  console.log(`${name}: "${char}" (code: ${char.charCodeAt(0).toString(16)})`);
  console.log(`  URL encoded: ${encodeURIComponent(char)}`);
});

// Test the specific string with sub-bullet
const testStr = '  ◦ fejofjopew\n';
console.log('\nTest string:', JSON.stringify(testStr));
console.log('URL encoded:', encodeURIComponent(testStr));
console.log('Contains "◦":', testStr.includes('◦'));
console.log('First char code:', testStr.charCodeAt(2).toString(16));

// Check if ◦ gets encoded to something with %
const encoded = encodeURIComponent('◦');
console.log('\n"◦" encodes to:', encoded);

// Check what %25 decodes to
try {
  console.log('"%25" decodes to:', decodeURIComponent('%25'));
  console.log('"%a" would be incomplete encoding');
} catch (e) {
  console.log('Error decoding:', e.message);
}
