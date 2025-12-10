/**
 * Test complex nesting with user-added bullets
 */

function parseHTML(str) {
  let depth = -1;
  let result = '';
  let i = 0;
  let indentDepthLevel = -1;

  while (i < str.length) {
    if (str.substr(i, 3) === '<ul') {
      const hasTextBefore = result.length > 0 && !result.endsWith('\n');

      if (depth >= 0 || hasTextBefore) {
        result += '\n';
        if (depth === -1 && hasTextBefore) {
          indentDepthLevel = 0;
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
        indentDepthLevel = -1;
      }
      i += 5;
      continue;
    }

    if (str.substr(i, 3) === '<li') {
      let actualDepth = Math.max(0, depth);

      // If we're indenting because of preceding text, shift ALL depths in that list
      if (indentDepthLevel >= 0 && depth >= indentDepthLevel) {
        actualDepth = depth - indentDepthLevel + 1;
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
    name: 'Topic with list (Pressure changes)',
    input: 'Pressure changes: <ul><li>Aortic pressure peaks</li><li>Ventricular pressure drops</li></ul>',
  },
  {
    name: 'User adds bullet under AI text with sub-bullet',
    input: 'AI generated text<ul><li>Your bullet<ul><li>Your sub-bullet</li></ul></li></ul>',
  },
  {
    name: 'Normal list without preceding text',
    input: '<ul><li>First</li><li>Second<ul><li>Nested</li></ul></li></ul>',
  },
];

testCases.forEach((test, idx) => {
  console.log(`\n=== Test ${idx + 1}: ${test.name} ===`);
  console.log('Input:', test.input);
  const output = parseHTML(test.input);
  console.log('\nOutput:');
  console.log(output);
  console.log('---');
});
