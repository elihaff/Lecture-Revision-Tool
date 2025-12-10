/**
 * Test the actual HTML structure from the console logs
 */

function parseTextForPDF(text) {
  if (!text) return '';
  let str = String(text);

  console.log('=== INPUT ===');
  console.log(str);
  console.log('=============\n');

  // Decode URL encoding
  try {
    const decoded = decodeURIComponent(str);
    if (decoded !== str) {
      console.log('Decoded URL encoding');
      str = decoded;
    }
  } catch (e) {}

  // Parse <ul>/<li> structure
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
  console.log('After list parsing:', JSON.stringify(str));

  // Handle divs/paragraphs
  str = str.replace(/<div[^>]*>/gi, '\n');
  str = str.replace(/<\/div>/gi, '');
  str = str.replace(/<p[^>]*>/gi, '\n');
  str = str.replace(/<\/p>/gi, '');
  str = str.replace(/<br\s*\/?>/gi, '\n');
  str = str.replace(/\n\n+/g, '\n');
  str = str.replace(/\u200B/g, '');

  console.log('After div/p replacement:', JSON.stringify(str));

  // Remove HTML tags
  str = str.replace(/<[^>]+>/g, '');

  console.log('\n=== OUTPUT ===');
  console.log(str);
  console.log('==============\n');

  return str;
}

// The actual problematic HTML from the console
const testCase = '<b>Diastole</b>: Ventricles relax, filling with blood from atria<div><ul><li>efjopfewje</li><ul><li>fejofjopew</li></ul></ul></div>';

console.log('🧪 Testing Actual Issue from Console\n');
parseTextForPDF(testCase);
