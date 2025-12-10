/**
 * Test indentation with current logic
 */

function testIndentation() {
  // Simulate depth levels
  for (let depth = 0; depth <= 2; depth++) {
    const actualDepth = Math.max(0, depth);
    const indentStr = '   '.repeat(actualDepth);
    const result = indentStr + '- ';

    console.log(`Depth ${depth}:`);
    console.log(`  String: "${result}"`);
    console.log(`  Length: ${result.length}`);
    console.log(`  Chars: [${result.split('').map(c => c === ' ' ? 'SP' : c).join(', ')}]`);
    console.log();
  }
}

testIndentation();

// Test the actual HTML case
const html = '<ul><li>Main<ul><li>Sub</li></ul></li></ul>';

function parseHTML(str) {
  let depth = -1;
  let result = '';
  let i = 0;

  while (i < str.length) {
    if (str.substr(i, 3) === '<ul') {
      if (depth >= 0) result += '\n';
      depth++;
      const endTag = str.indexOf('>', i);
      i = endTag + 1;
      continue;
    }

    if (str.substr(i, 5) === '</ul>') {
      depth = Math.max(-1, depth - 1);
      i += 5;
      continue;
    }

    if (str.substr(i, 3) === '<li') {
      const actualDepth = Math.max(0, depth);
      const indentStr = '   '.repeat(actualDepth);
      result += indentStr + '- ';
      const endTag = str.indexOf('>', i);
      i = endTag + 1;
      continue;
    }

    if (str.substr(i, 5) === '</li>') {
      result += '\n';
      i += 5;
      continue;
    }

    result += str.charAt(i);
    i++;
  }

  return result;
}

console.log('Testing HTML parsing:');
console.log('Input:', html);
const output = parseHTML(html);
console.log('Output:', JSON.stringify(output));
console.log('\nFormatted:');
console.log(output);
console.log('\nLine by line:');
output.split('\n').forEach((line, idx) => {
  console.log(`Line ${idx}: "${line}" (${line.length} chars)`);
  console.log(`  Starts with spaces: ${line.match(/^ +/) ? line.match(/^ +/)[0].length : 0}`);
});
