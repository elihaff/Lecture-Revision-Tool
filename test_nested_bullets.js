/**
 * Test nested bullet parsing for PDF export
 */

console.log('🧪 Testing Nested Bullet Parsing\n');

// Simulate the parseTextForPDF function
function parseTextForPDF(text) {
  if (!text) return [{ text: '', bold: false }];
  let str = String(text);

  // Count <ul> nesting depth at each <li> to detect indentation
  // Start at -1 because first <ul> brings us to depth 0
  let depth = -1;
  let result = '';
  let i = 0;

  while (i < str.length) {
    // Check for <ul> start
    if (str.substr(i, 3) === '<ul' || str.substr(i, 3) === '<UL') {
      // If we're starting a nested list (depth >= 0), add a newline first
      if (depth >= 0) {
        result += '\n';
      }
      depth++;
      // Skip to end of tag
      const endTag = str.indexOf('>', i);
      i = endTag + 1;
      continue;
    }

    // Check for </ul> end
    if (str.substr(i, 5) === '</ul>' || str.substr(i, 5) === '</UL>') {
      depth = Math.max(-1, depth - 1);
      i += 5;
      continue;
    }

    // Check for <li> start
    if (str.substr(i, 3) === '<li' || str.substr(i, 3) === '<LI') {
      // Add appropriate indentation based on current depth
      const actualDepth = Math.max(0, depth);
      const indentStr = '  '.repeat(actualDepth);
      const bullet = actualDepth === 0 ? '• ' : actualDepth === 1 ? '◦ ' : '▪ ';
      result += indentStr + bullet;

      // Skip to end of opening <li> tag
      const endTag = str.indexOf('>', i);
      i = endTag + 1;
      continue;
    }

    // Check for </li> end
    if (str.substr(i, 5) === '</li>' || str.substr(i, 5) === '</LI>') {
      result += '\n';
      i += 5;
      continue;
    }

    // Regular character - add to result
    result += str[i];
    i++;
  }

  str = result;

  // Clean up
  str = str.replace(/<div[^>]*>/gi, '');
  str = str.replace(/<\/div>/gi, '\n');
  str = str.replace(/<p[^>]*>/gi, '');
  str = str.replace(/<\/p>/gi, '\n');
  str = str.replace(/<br\s*\/?>/gi, '\n');

  // Handle bold
  str = str.replace(/<b>/gi, '**').replace(/<\/b>/gi, '**');
  str = str.replace(/<strong>/gi, '**').replace(/<\/strong>/gi, '**');

  // Remove remaining HTML
  str = str.replace(/<[^>]+>/g, '');

  // Clean up double newlines that occur at list boundaries
  str = str.replace(/\n\n+/g, '\n');

  return str;
}

// Test cases
const testCases = [
  {
    name: 'Simple bullet list',
    input: '<ul><li>Item 1</li><li>Item 2</li></ul>',
    expected: '• Item 1\n• Item 2\n'
  },
  {
    name: 'Nested bullet list (1 level)',
    input: '<ul><li>Item 1<ul><li>Sub item 1</li><li>Sub item 2</li></ul></li><li>Item 2</li></ul>',
    expected: '• Item 1\n  ◦ Sub item 1\n  ◦ Sub item 2\n• Item 2\n'
  },
  {
    name: 'Nested bullet list (2 levels)',
    input: '<ul><li>Item 1<ul><li>Sub 1<ul><li>Sub-sub 1</li></ul></li></ul></li></ul>',
    expected: '• Item 1\n  ◦ Sub 1\n    ▪ Sub-sub 1\n'
  },
  {
    name: 'Mixed content with bold',
    input: '<ul><li><b>Bold item</b></li><li>Normal<ul><li>Sub</li></ul></li></ul>',
    expected: '• **Bold item**\n• Normal\n  ◦ Sub\n'
  },
  {
    name: 'ContentEditable style (what browser actually generates)',
    input: '<ul><li>Item 1</li><li>Item 2<ul><li>Nested A</li><li>Nested B</li></ul></li><li>Item 3</li></ul>',
    expected: '• Item 1\n• Item 2\n  ◦ Nested A\n  ◦ Nested B\n• Item 3\n'
  }
];

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
  console.log(`Test ${index + 1}: ${test.name}`);
  console.log(`Input:  ${test.input}`);

  const result = parseTextForPDF(test.input);

  console.log(`Expected:\n${test.expected.replace(/\n/g, '\\n')}`);
  console.log(`Got:\n${result.replace(/\n/g, '\\n')}`);

  if (result === test.expected) {
    console.log('✅ PASS\n');
    passed++;
  } else {
    console.log('❌ FAIL\n');
    failed++;

    // Show character-by-character comparison
    console.log('Character comparison:');
    const maxLen = Math.max(result.length, test.expected.length);
    for (let i = 0; i < maxLen; i++) {
      const gotChar = i < result.length ? result[i] : '(end)';
      const expChar = i < test.expected.length ? test.expected[i] : '(end)';
      if (gotChar !== expChar) {
        console.log(`  Position ${i}: expected '${expChar}' got '${gotChar}'`);
      }
    }
    console.log();
  }
});

console.log('='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed === 0) {
  console.log('\n✅ All tests passed! Nested bullets will work correctly in PDF.');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed. Review output above.');
  process.exit(1);
}
