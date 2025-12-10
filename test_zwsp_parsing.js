/**
 * Test how zero-width spaces affect PDF parsing
 */

function parseTextForPDF(text) {
  if (!text) return '';
  let str = String(text);

  // Remove zero-width spaces
  console.log('Before ZWSP removal:', JSON.stringify(str));
  str = str.replace(/\u200B/g, '');
  console.log('After ZWSP removal:', JSON.stringify(str));

  // Handle superscript and subscript
  str = str.replace(/<sup>(.*?)<\/sup>/gi, '$1');
  str = str.replace(/<sub>(.*?)<\/sub>/gi, '$1');

  // Remove remaining HTML
  str = str.replace(/<[^>]+>/g, '');

  return str;
}

const testCases = [
  {
    name: 'Superscript with zero-width space after',
    input: 'Text with<sup>super</sup>\u200Bnormal text',
    expected: 'Text withsupernormal text'
  },
  {
    name: 'Superscript followed by text',
    input: 'H<sup>2</sup>\u200BO becomes water',
    expected: 'H2O becomes water'
  },
  {
    name: 'Multiple superscripts with breaks',
    input: 'X<sup>2</sup>\u200B + Y<sup>3</sup>\u200B = Z',
    expected: 'X2 + Y3 = Z'
  }
];

console.log('🧪 Testing Zero-Width Space PDF Parsing\n');

let passed = 0;
let failed = 0;

testCases.forEach((test, idx) => {
  console.log(`\nTest ${idx + 1}: ${test.name}`);
  console.log('Input:', JSON.stringify(test.input));
  const result = parseTextForPDF(test.input);

  if (result === test.expected) {
    console.log(`✅ PASS: "${result}"`);
    passed++;
  } else {
    console.log(`❌ FAIL`);
    console.log(`   Expected: "${test.expected}"`);
    console.log(`   Got:      "${result}"`);
    failed++;
  }
});

console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed === 0) {
  console.log('\n✅ All tests passed!');
} else {
  console.log('\n❌ Some tests failed.');
}
