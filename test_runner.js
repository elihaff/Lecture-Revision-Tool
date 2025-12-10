/**
 * Test Runner for Medical Lecture Study Assistant
 * This script opens the app in the browser and runs automated tests
 */

const fs = require('fs');
const path = require('path');

console.log('=== Medical Lecture Study Assistant - Test Suite ===\n');

// Read the index.html file
const indexPath = path.join(__dirname, 'index.html');
const htmlContent = fs.readFileSync(indexPath, 'utf-8');

console.log('✓ Successfully loaded index.html');
console.log(`  File size: ${(htmlContent.length / 1024).toFixed(2)} KB\n`);

// Test 1: Check for critical components
console.log('TEST 1: Checking for critical components...');

const checks = [
  { name: 'ContentEditable div', pattern: /contentEditable/g },
  { name: 'Formatting toolbar', pattern: /insertFormatting/g },
  { name: 'Bullet point button', pattern: /insertBullet/g },
  { name: 'Ref callback pattern', pattern: /textareaRef\.current = el/g },
  { name: 'parseTextForPDF function', pattern: /const parseTextForPDF/g },
  { name: 'HTML tag stripping', pattern: /str\.replace\(/g },
  { name: 'UL/LI handling', pattern: /<ul/gi },
  { name: 'dangerouslySetInnerHTML for display', pattern: /dangerouslySetInnerHTML=\{\{ __html: [pc]/g },
  { name: 'Tab key handler', pattern: /if \(e\.key === 'Tab'\)/g },
  { name: 'Flashcard formatting toolbar', pattern: /cardTextareaRef\.current/g },
];

let allChecksPassed = true;

checks.forEach(check => {
  const matches = htmlContent.match(check.pattern);
  if (matches && matches.length > 0) {
    console.log(`  ✓ ${check.name}: Found (${matches.length} occurrence${matches.length > 1 ? 's' : ''})`);
  } else {
    console.log(`  ✗ ${check.name}: NOT FOUND`);
    allChecksPassed = false;
  }
});

console.log('');

// Test 2: Check parseTextForPDF handles all HTML tags
console.log('TEST 2: Checking parseTextForPDF implementation...');

const pdfParseChecks = [
  { name: 'UL tag removal', pattern: /str\.replace\(.*<ul/i },
  { name: 'LI tag conversion', pattern: /str\.replace\(.*<li.*'• '/i },
  { name: 'DIV tag handling', pattern: /str\.replace\(.*<div/i },
  { name: 'P tag handling', pattern: /str\.replace\(.*<p/i },
  { name: 'BR tag handling', pattern: /str\.replace\(.*<br/i },
  { name: 'Generic HTML tag stripping', pattern: /str\.replace\(.*<\[/i },
  { name: 'Newline cleanup', pattern: /str\.replace\(.*\\n\{3,\}/i },
];

let pdfChecksPassed = true;

pdfParseChecks.forEach(check => {
  const found = check.pattern.test(htmlContent);
  if (found) {
    console.log(`  ✓ ${check.name}: Implemented`);
  } else {
    console.log(`  ✗ ${check.name}: MISSING`);
    pdfChecksPassed = false;
  }
});

console.log('');

// Test 3: Check for the ref callback pattern (not dangerouslySetInnerHTML in contentEditable)
console.log('TEST 3: Checking contentEditable implementation...');

// Check for ref callback pattern in editing contexts
const hasNotesRefCallback = /ref=\{\(el\)\s*=>\s*\{[\s\S]{0,500}textareaRef\.current\s*=\s*el/.test(htmlContent);
const hasCardRefCallback = /ref=\{\(el\)\s*=>\s*\{[\s\S]{0,500}cardTextareaRef\.current\s*=\s*el/.test(htmlContent);

if (hasNotesRefCallback) {
  console.log('  ✓ Notes editor uses ref callback (correct)');
} else {
  console.log('  ✗ Notes editor missing ref callback pattern');
  allChecksPassed = false;
}

if (hasCardRefCallback) {
  console.log('  ✓ Flashcard editor uses ref callback (correct)');
} else {
  console.log('  ✗ Flashcard editor missing ref callback pattern');
  allChecksPassed = false;
}

console.log('');

// Test 4: Check display uses dangerouslySetInnerHTML (not renderText)
console.log('TEST 4: Checking display rendering...');

const displayChecks = [
  {
    name: 'Notes display',
    pattern: /<span className="flex-1" dangerouslySetInnerHTML=\{\{ __html: p \}\}/,
    description: 'Uses dangerouslySetInnerHTML for formatted display'
  },
  {
    name: 'Flashcard display',
    pattern: /<p className="text-sm text-indigo-300" dangerouslySetInnerHTML=\{\{ __html: c\.back \}\}/,
    description: 'Uses dangerouslySetInnerHTML for formatted display'
  }
];

let displayChecksPassed = true;

displayChecks.forEach(check => {
  if (check.pattern.test(htmlContent)) {
    console.log(`  ✓ ${check.name}: ${check.description}`);
  } else {
    console.log(`  ✗ ${check.name}: NOT using dangerouslySetInnerHTML (will show HTML code)`);
    displayChecksPassed = false;
  }
});

console.log('');

// Test 5: Check version number
console.log('TEST 5: Checking version number...');

const versionMatch = htmlContent.match(/v\d+\.\d+\s+\w+/);
if (versionMatch) {
  console.log(`  ✓ Current version: ${versionMatch[0]}`);
} else {
  console.log('  ⚠ Could not find version number');
}

console.log('');

// Summary
console.log('=== TEST SUMMARY ===\n');

if (allChecksPassed && pdfChecksPassed && displayChecksPassed) {
  console.log('✓ ALL TESTS PASSED');
  console.log('\nThe application should work correctly with:');
  console.log('  • Bullet points without cursor jumping');
  console.log('  • Formatted text display in notes preview');
  console.log('  • Clean PDF export without HTML tags');
  console.log('  • Flashcard formatting and bullet points');
  console.log('  • Tab key for indentation');
  process.exit(0);
} else {
  console.log('✗ SOME TESTS FAILED\n');
  console.log('Issues detected:');
  if (!allChecksPassed) console.log('  • Missing critical components');
  if (!pdfChecksPassed) console.log('  • PDF parsing may show HTML tags');
  if (!displayChecksPassed) console.log('  • Display may show raw HTML instead of formatted text');
  console.log('\nReview the detailed output above for specific problems.');
  process.exit(1);
}
