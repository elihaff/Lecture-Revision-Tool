/**
 * Test the "Pressure changes:" formatting
 */

function parseHTML(str) {
  let depth = -1;
  let result = '';
  let i = 0;
  let indentFirstLevel = false;

  while (i < str.length) {
    if (str.substr(i, 3) === '<ul') {
      const hasTextBefore = result.length > 0 && !result.endsWith('\n');

      // Add newline if nested OR if there's text on current line
      if (depth >= 0 || hasTextBefore) {
        result += '\n';
        if (depth === -1 && hasTextBefore) {
          indentFirstLevel = true;
        }
      }
      depth++;
      const endTag = str.indexOf('>', i);
      i = endTag + 1;
      continue;
    }

    if (str.substr(i, 5) === '</ul>') {
      depth = Math.max(-1, depth - 1);
      if (depth === -1) {
        indentFirstLevel = false;
      }
      i += 5;
      continue;
    }

    if (str.substr(i, 3) === '<li') {
      let actualDepth = Math.max(0, depth);

      // If first level list follows text, add extra indent
      if (actualDepth === 0 && indentFirstLevel) {
        actualDepth = 1;
      }

      const indentStr = '   '.repeat(actualDepth);
      const bullet = actualDepth === 0 ? '• ' : '- ';
      result += indentStr + bullet;
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

const testCases = [
  {
    name: 'Pressure changes case',
    input: 'Pressure changes: <ul><li>Aortic pressure peaks during systole</li><li>Ventricular pressure drops during diastole</li></ul>',
  },
  {
    name: 'List at start',
    input: '<ul><li>First item</li><li>Second item</li></ul>',
  },
  {
    name: 'Nested list',
    input: '<ul><li>Main<ul><li>Sub</li></ul></li></ul>',
  }
];

testCases.forEach((test, idx) => {
  console.log(`\n=== Test ${idx + 1}: ${test.name} ===`);
  console.log('Input:', test.input);
  const output = parseHTML(test.input);
  console.log('\nOutput:');
  console.log(output);
  console.log('---');
});
