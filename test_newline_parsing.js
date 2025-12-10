/**
 * Test newline and sub-bullet parsing for PDF
 */

function parseTextForPDF(text) {
  if (!text) return '';
  let str = String(text);

  console.log('\n=== INPUT HTML ===');
  console.log(str);
  console.log('=================\n');

  // Count <ul> nesting depth at each <li> to detect indentation
  let depth = -1;
  let result = '';
  let i = 0;

  while (i < str.length) {
    // Check for <ul> start
    if (str.substr(i, 3) === '<ul' || str.substr(i, 3) === '<UL') {
      if (depth >= 0) {
        result += '\n';
      }
      depth++;
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
      const actualDepth = Math.max(0, depth);
      const indentStr = '  '.repeat(actualDepth);
      const bullet = actualDepth === 0 ? '• ' : actualDepth === 1 ? '◦ ' : '▪ ';
      result += indentStr + bullet;
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

    // Regular character
    result += str.charAt(i);
    i++;
  }

  // Convert remaining HTML
  str = result;

  // Handle divs and paragraphs - opening tags create newlines
  str = str.replace(/<div[^>]*>/gi, '\n');
  str = str.replace(/<\/div>/gi, '');
  str = str.replace(/<p[^>]*>/gi, '\n');
  str = str.replace(/<\/p>/gi, '');

  // Convert <br> tags to newlines
  str = str.replace(/<br\s*\/?>/gi, '\n');

  // Clean up double newlines
  str = str.replace(/\n\n+/g, '\n');

  // Remove zero-width spaces
  str = str.replace(/\u200B/g, '');

  // Remove remaining HTML tags
  str = str.replace(/<[^>]+>/g, '');

  console.log('=== OUTPUT TEXT ===');
  console.log(JSON.stringify(str));
  console.log('===================\n');

  return str;
}

const testCases = [
  {
    name: 'Newline with <div>',
    input: 'First line<div>Second line</div>',
    description: 'Testing Enter key creating <div>'
  },
  {
    name: 'Newline with <br>',
    input: 'First line<br>Second line',
    description: 'Testing Shift+Enter creating <br>'
  },
  {
    name: 'Sub-bullet point',
    input: '<ul><li>Main point<ul><li>Sub point</li></ul></li></ul>',
    description: 'Testing nested bullet formatting'
  },
  {
    name: 'Sub-bullet with text after',
    input: '<ul><li>Main<ul><li>Sub</li></ul></li><li>Next main</li></ul>',
    description: 'Multiple items with nesting'
  },
  {
    name: 'Plain text with newline in contenteditable',
    input: 'Line 1\nLine 2',
    description: 'Raw newline character'
  }
];

console.log('🧪 Testing Newline and Sub-Bullet Parsing\n');

testCases.forEach((test, idx) => {
  console.log(`\nTest ${idx + 1}: ${test.name}`);
  console.log(`Description: ${test.description}`);
  const result = parseTextForPDF(test.input);
  console.log('Final result has', (result.match(/\n/g) || []).length, 'newlines');
});
