/**
 * Test formatting fixes
 */

console.log('🧪 Testing Formatting Fixes\n');

// Test 1: Superscript/Subscript removal in PDF
function parseTextForPDF(text) {
  let str = String(text);

  // Handle superscript and subscript - just extract the text content
  str = str.replace(/<sup>(.*?)<\/sup>/gi, '$1');
  str = str.replace(/<sub>(.*?)<\/sub>/gi, '$1');

  // Remove remaining HTML
  str = str.replace(/<[^>]+>/g, '');

  return str;
}

const testCases = [
  {
    name: 'Superscript',
    input: 'H<sup>2</sup>O becomes water',
    expected: 'H2O becomes water'
  },
  {
    name: 'Subscript',
    input: 'CO<sub>2</sub> is carbon dioxide',
    expected: 'CO2 is carbon dioxide'
  },
  {
    name: 'Mixed super and subscript',
    input: 'X<sup>2</sup> + Y<sub>1</sub>',
    expected: 'X2 + Y1'
  },
  {
    name: 'Nested in other HTML',
    input: '<b>Bold</b> with H<sup>+</sup> ion',
    expected: 'Bold with H+ ion'
  }
];

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
  console.log(`Test ${index + 1}: ${test.name}`);
  const result = parseTextForPDF(test.input);

  if (result === test.expected) {
    console.log(`✅ PASS: "${result}"\n`);
    passed++;
  } else {
    console.log(`❌ FAIL`);
    console.log(`   Expected: "${test.expected}"`);
    console.log(`   Got:      "${result}"\n`);
    failed++;
  }
});

console.log('='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed === 0) {
  console.log('\n✅ All formatting tests passed!');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed.');
  process.exit(1);
}
