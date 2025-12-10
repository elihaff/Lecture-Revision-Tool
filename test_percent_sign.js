/**
 * Test for % sign appearing in sub-bullets
 */

function parseTextForPDF(text) {
  if (!text) return '';
  let str = String(text);

  console.log('INPUT:', JSON.stringify(str));

  // Check for URL encoding
  if (str.includes('%')) {
    console.log('⚠️  Contains % sign - might be URL encoded');
    console.log('Attempting decode:', decodeURIComponent(str));
  }

  // Count <ul> nesting
  let depth = -1;
  let result = '';
  let i = 0;

  while (i < str.length) {
    if (str.substr(i, 3) === '<ul' || str.substr(i, 3) === '<UL') {
      if (depth >= 0) result += '\n';
      depth++;
      const endTag = str.indexOf('>', i);
      i = endTag + 1;
      continue;
    }

    if (str.substr(i, 5) === '</ul>' || str.substr(i, 5) === '</UL>') {
      depth = Math.max(-1, depth - 1);
      i += 5;
      continue;
    }

    if (str.substr(i, 3) === '<li' || str.substr(i, 3) === '<LI') {
      const actualDepth = Math.max(0, depth);
      const indentStr = '  '.repeat(actualDepth);
      const bullet = actualDepth === 0 ? '• ' : actualDepth === 1 ? '◦ ' : '▪ ';
      result += indentStr + bullet;
      const endTag = str.indexOf('>', i);
      i = endTag + 1;
      continue;
    }

    if (str.substr(i, 5) === '</li>' || str.substr(i, 5) === '</LI>') {
      result += '\n';
      i += 5;
      continue;
    }

    result += str.charAt(i);
    i++;
  }

  str = result;

  // Handle divs/paragraphs
  str = str.replace(/<div[^>]*>/gi, '\n');
  str = str.replace(/<\/div>/gi, '');
  str = str.replace(/<p[^>]*>/gi, '\n');
  str = str.replace(/<\/p>/gi, '');
  str = str.replace(/<br\s*\/?>/gi, '\n');
  str = str.replace(/\n\n+/g, '\n');
  str = str.replace(/\u200B/g, '');

  // Remove HTML tags
  str = str.replace(/<[^>]+>/g, '');

  console.log('OUTPUT:', JSON.stringify(str));
  return str;
}

const testCases = [
  'Main point<ul><li>Sub point with %20 space</li></ul>',
  'Main point<ul><li>Sub point with%0Anewline</li></ul>',
  '<ul><li>Main<ul><li>Sub%20item</li></ul></li></ul>',
  '<ul><li>Item 1<ul><li>Nested item</li></ul></li></ul>',
];

console.log('🧪 Testing for % signs in sub-bullets\n');

testCases.forEach((input, idx) => {
  console.log(`\n--- Test ${idx + 1} ---`);
  parseTextForPDF(input);
});
