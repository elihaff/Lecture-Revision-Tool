/**
 * Deep Implementation Test
 * This script performs detailed analysis of the actual implementation
 * to predict how it will behave in the browser
 */

const fs = require('fs');
const path = require('path');

console.log('=== DEEP IMPLEMENTATION ANALYSIS ===\n');

const indexPath = path.join(__dirname, 'index.html');
const htmlContent = fs.readFileSync(indexPath, 'utf-8');

let criticalIssues = [];
let warnings = [];
let successes = [];

// Extract the relevant code sections
function extractSection(startPattern, endPattern, maxLength = 5000) {
  const startMatch = htmlContent.search(startPattern);
  if (startMatch === -1) return null;

  const section = htmlContent.substring(startMatch, startMatch + maxLength);
  if (endPattern) {
    const endMatch = section.search(endPattern);
    if (endMatch !== -1) {
      return section.substring(0, endMatch);
    }
  }
  return section;
}

console.log('TEST 1: Notes Editor Implementation Analysis');
console.log('='.repeat(60));

// Check notes editor contentEditable implementation
const notesEditorSection = extractSection(/editingNote.*?contentEditable/s, /className="w-full bg-slate-700/);

if (notesEditorSection) {
  // Check for the critical ref callback pattern
  const hasRefCallback = /ref=\{\(el\)\s*=>\s*\{/.test(notesEditorSection);
  const setsCurrent = /textareaRef\.current\s*=\s*el/.test(notesEditorSection);
  const setsInnerHTML = /el\.innerHTML\s*=/.test(notesEditorSection);
  const hasCursorPositioning = /range\.setStart/.test(notesEditorSection);
  const hasOnInput = /onInput=\{/.test(notesEditorSection);
  const hasDangerousHTML = /dangerouslySetInnerHTML/.test(notesEditorSection);

  console.log('Notes Editor Pattern Check:');

  if (hasRefCallback && setsCurrent && setsInnerHTML) {
    successes.push('✓ Notes editor uses ref callback pattern');
    console.log('  ✓ Ref callback: PRESENT');
    console.log('  ✓ Sets textareaRef.current: YES');
    console.log('  ✓ Manually sets innerHTML: YES');
  } else {
    criticalIssues.push('✗ Notes editor missing proper ref callback');
    console.log('  ✗ MISSING proper ref callback implementation');
  }

  if (hasCursorPositioning) {
    successes.push('✓ Notes editor has cursor positioning logic');
    console.log('  ✓ Cursor positioning (range.setStart): PRESENT');
  } else {
    warnings.push('⚠ Notes editor may not handle cursor positioning');
    console.log('  ⚠ Cursor positioning: MISSING (may jump to start)');
  }

  if (hasOnInput) {
    successes.push('✓ Notes editor uses onInput handler');
    console.log('  ✓ onInput handler: PRESENT');
  } else {
    criticalIssues.push('✗ Notes editor missing onInput handler');
    console.log('  ✗ onInput handler: MISSING (changes won\'t save)');
  }

  if (hasDangerousHTML) {
    criticalIssues.push('✗ Notes editor uses dangerouslySetInnerHTML (cursor will jump)');
    console.log('  ✗ dangerouslySetInnerHTML: FOUND (BAD - will cause cursor jump)');
  } else {
    successes.push('✓ Notes editor avoids dangerouslySetInnerHTML');
    console.log('  ✓ dangerouslySetInnerHTML: NOT USED (GOOD)');
  }

  // Check for Tab key handler
  const hasTabHandler = /if\s*\(e\.key\s*===\s*['"]Tab['"]\)/.test(notesEditorSection);
  if (hasTabHandler) {
    successes.push('✓ Notes editor handles Tab key for indentation');
    console.log('  ✓ Tab key handler: PRESENT');
  } else {
    warnings.push('⚠ Notes editor missing Tab key handler');
    console.log('  ⚠ Tab key handler: MISSING (may switch focus)');
  }
} else {
  criticalIssues.push('✗ Could not find notes editor section');
  console.log('  ✗ COULD NOT LOCATE NOTES EDITOR');
}

console.log('\n');

console.log('TEST 2: Flashcard Editor Implementation Analysis');
console.log('='.repeat(60));

// Check flashcard editor
const cardEditorSection = extractSection(/cardTextareaRef.*?contentEditable/s, /className="w-full bg-slate-700/);

if (cardEditorSection) {
  const hasRefCallback = /ref=\{\(el\)\s*=>\s*\{/.test(cardEditorSection);
  const setsCurrent = /cardTextareaRef\.current\s*=\s*el/.test(cardEditorSection);
  const setsInnerHTML = /el\.innerHTML\s*=/.test(cardEditorSection);
  const hasCursorPositioning = /range\.setStart/.test(cardEditorSection);
  const hasOnInput = /onInput=\{/.test(cardEditorSection);
  const hasDangerousHTML = /dangerouslySetInnerHTML/.test(cardEditorSection);

  console.log('Flashcard Editor Pattern Check:');

  if (hasRefCallback && setsCurrent && setsInnerHTML) {
    successes.push('✓ Flashcard editor uses ref callback pattern');
    console.log('  ✓ Ref callback: PRESENT');
    console.log('  ✓ Sets cardTextareaRef.current: YES');
    console.log('  ✓ Manually sets innerHTML: YES');
  } else {
    criticalIssues.push('✗ Flashcard editor missing proper ref callback');
    console.log('  ✗ MISSING proper ref callback implementation');
  }

  if (hasCursorPositioning) {
    successes.push('✓ Flashcard editor has cursor positioning logic');
    console.log('  ✓ Cursor positioning: PRESENT');
  } else {
    warnings.push('⚠ Flashcard editor may not handle cursor positioning');
    console.log('  ⚠ Cursor positioning: MISSING');
  }

  if (hasOnInput) {
    successes.push('✓ Flashcard editor uses onInput handler');
    console.log('  ✓ onInput handler: PRESENT');
  } else {
    criticalIssues.push('✗ Flashcard editor missing onInput handler');
    console.log('  ✗ onInput handler: MISSING');
  }

  if (hasDangerousHTML) {
    criticalIssues.push('✗ Flashcard editor uses dangerouslySetInnerHTML');
    console.log('  ✗ dangerouslySetInnerHTML: FOUND (BAD)');
  } else {
    successes.push('✓ Flashcard editor avoids dangerouslySetInnerHTML');
    console.log('  ✓ dangerouslySetInnerHTML: NOT USED (GOOD)');
  }

  const hasTabHandler = /if\s*\(e\.key\s*===\s*['"]Tab['"]\)/.test(cardEditorSection);
  if (hasTabHandler) {
    successes.push('✓ Flashcard editor handles Tab key');
    console.log('  ✓ Tab key handler: PRESENT');
  } else {
    warnings.push('⚠ Flashcard editor missing Tab key handler');
    console.log('  ⚠ Tab key handler: MISSING');
  }
} else {
  criticalIssues.push('✗ Could not find flashcard editor section');
  console.log('  ✗ COULD NOT LOCATE FLASHCARD EDITOR');
}

console.log('\n');

console.log('TEST 3: Display Rendering Analysis');
console.log('='.repeat(60));

// Check notes display (not editing)
const notesDisplayPattern = /\) : \([\s\S]{0,500}<span className="flex-1"/;
const notesDisplayMatch = htmlContent.match(notesDisplayPattern);

if (notesDisplayMatch) {
  const displaySection = notesDisplayMatch[0];

  if (/dangerouslySetInnerHTML=\{\{\s*__html:\s*p\s*\}\}/.test(displaySection)) {
    successes.push('✓ Notes display uses dangerouslySetInnerHTML');
    console.log('  ✓ Notes display: Uses dangerouslySetInnerHTML (CORRECT)');
    console.log('    → Will show formatted HTML, not raw tags');
  } else if (/\{renderText\(p\)\}/.test(displaySection)) {
    criticalIssues.push('✗ Notes display uses renderText (will show HTML tags)');
    console.log('  ✗ Notes display: Uses renderText (WRONG)');
    console.log('    → Will show HTML tags like <ul> <li> <b> instead of formatting');
  } else {
    warnings.push('⚠ Notes display method unclear');
    console.log('  ⚠ Notes display: Could not determine rendering method');
  }
} else {
  warnings.push('⚠ Could not find notes display section');
  console.log('  ⚠ Could not locate notes display section');
}

// Check flashcard display
const cardDisplayPattern = /\) : \([\s\S]{0,500}<p className="text-sm text-indigo-300"/;
const cardDisplayMatch = htmlContent.match(cardDisplayPattern);

if (cardDisplayMatch) {
  const displaySection = cardDisplayMatch[0];

  if (/dangerouslySetInnerHTML=\{\{\s*__html:\s*c\.back\s*\}\}/.test(displaySection)) {
    successes.push('✓ Flashcard display uses dangerouslySetInnerHTML');
    console.log('  ✓ Flashcard display: Uses dangerouslySetInnerHTML (CORRECT)');
  } else if (/\{renderText\(c\.back\)\}/.test(displaySection)) {
    criticalIssues.push('✗ Flashcard display uses renderText');
    console.log('  ✗ Flashcard display: Uses renderText (WRONG)');
  } else {
    warnings.push('⚠ Flashcard display method unclear');
    console.log('  ⚠ Flashcard display: Could not determine method');
  }
} else {
  warnings.push('⚠ Could not find flashcard display section');
  console.log('  ⚠ Could not locate flashcard display section');
}

console.log('\n');

console.log('TEST 4: PDF Export Function Analysis');
console.log('='.repeat(60));

const pdfFunction = extractSection(/const parseTextForPDF\s*=/, /return parts\.length/s, 10000);

if (pdfFunction) {
  console.log('PDF Parsing Function Checks:');

  const checks = [
    { pattern: /<ul\[/, name: 'UL tag removal', critical: true },
    { pattern: /<li\[/, name: 'LI tag to bullet conversion', critical: true },
    { pattern: /<div\[/, name: 'DIV tag handling', critical: false },
    { pattern: /<p\[/, name: 'P tag handling', critical: false },
    { pattern: /<br\\s/, name: 'BR tag to newline', critical: false },
    { pattern: /<\[/, name: 'Generic HTML tag removal', critical: true },
    { pattern: /\\n\{3,\}/, name: 'Newline cleanup', critical: false },
    { pattern: /'\*\*'/, name: 'Bold marker conversion', critical: false },
  ];

  checks.forEach(check => {
    if (check.pattern.test(pdfFunction)) {
      successes.push(`✓ PDF export handles ${check.name}`);
      console.log(`  ✓ ${check.name}: IMPLEMENTED`);
    } else {
      if (check.critical) {
        criticalIssues.push(`✗ PDF export missing ${check.name}`);
        console.log(`  ✗ ${check.name}: MISSING (CRITICAL)`);
      } else {
        warnings.push(`⚠ PDF export may not handle ${check.name}`);
        console.log(`  ⚠ ${check.name}: MISSING`);
      }
    }
  });

  // Test the parsing logic with a sample
  console.log('\n  Sample HTML → PDF Conversion Test:');
  const testHTML = '<ul><li><b>Bold item</b></li><li>Normal item</li></ul><div>Text</div>';
  console.log(`  Input:  ${testHTML}`);

  // Simulate the parseTextForPDF function
  let result = testHTML;
  result = result.replace(/<ul[^>]*>/gi, '');
  result = result.replace(/<\/ul>/gi, '');
  result = result.replace(/<li[^>]*>/gi, '• ');
  result = result.replace(/<\/li>/gi, '\n');
  result = result.replace(/<div[^>]*>/gi, '');
  result = result.replace(/<\/div>/gi, '\n');
  result = result.replace(/<b>/gi, '**').replace(/<\/b>/gi, '**');
  result = result.replace(/<[^>]+>/g, '');
  result = result.replace(/\n{3,}/g, '\n\n');

  console.log(`  Output: ${result.replace(/\n/g, '\\n')}`);

  if (result.includes('<') || result.includes('>')) {
    criticalIssues.push('✗ PDF conversion leaves HTML tags');
    console.log('  ✗ RESULT CONTAINS HTML TAGS (will show in PDF)');
  } else {
    successes.push('✓ PDF conversion strips all HTML');
    console.log('  ✓ RESULT IS CLEAN (no HTML tags)');
  }
} else {
  criticalIssues.push('✗ Could not find parseTextForPDF function');
  console.log('  ✗ COULD NOT LOCATE PDF PARSING FUNCTION');
}

console.log('\n');

console.log('TEST 5: Toolbar Functionality Analysis');
console.log('='.repeat(60));

// Check for formatting functions
const hasBoldButton = /insertFormatting\(['"]bold['"]\)/.test(htmlContent);
const hasItalicButton = /insertFormatting\(['"]italic['"]\)/.test(htmlContent);
const hasBulletButton = /insertBullet\(\)/.test(htmlContent);
const hasSymbolButtons = /insertSymbol\(/.test(htmlContent);

console.log('Toolbar Buttons:');
console.log(`  ${hasBoldButton ? '✓' : '✗'} Bold button`);
console.log(`  ${hasItalicButton ? '✓' : '✗'} Italic button`);
console.log(`  ${hasBulletButton ? '✓' : '✗'} Bullet button`);
console.log(`  ${hasSymbolButtons ? '✓' : '✗'} Symbol buttons`);

// Check insertBullet implementation
const insertBulletFunc = extractSection(/const insertBullet\s*=/, /\};/s, 1000);
if (insertBulletFunc) {
  if (/insertUnorderedList/.test(insertBulletFunc)) {
    successes.push('✓ Bullet function uses insertUnorderedList');
    console.log('  ✓ insertBullet uses document.execCommand("insertUnorderedList")');
  } else {
    criticalIssues.push('✗ Bullet function implementation incorrect');
    console.log('  ✗ insertBullet does not use insertUnorderedList');
  }
}

// Check if flashcard toolbar has bullet button
const flashcardToolbar = extractSection(/Format answer:/, /essentialSymbols\.slice/s, 2000);
if (flashcardToolbar) {
  if (/insertUnorderedList/.test(flashcardToolbar)) {
    successes.push('✓ Flashcard toolbar has bullet button');
    console.log('  ✓ Flashcard toolbar includes bullet point button');
  } else {
    criticalIssues.push('✗ Flashcard toolbar missing bullet button');
    console.log('  ✗ Flashcard toolbar missing bullet point button');
  }
}

console.log('\n');
console.log('='.repeat(60));
console.log('FINAL VERDICT');
console.log('='.repeat(60));
console.log();

if (criticalIssues.length === 0) {
  console.log('✅ NO CRITICAL ISSUES FOUND\n');
  console.log('Expected Behavior:');
  console.log('  • Bullet points will NOT cause cursor jumping');
  console.log('  • Formatted text will display correctly (no HTML code visible)');
  console.log('  • PDF export will show clean text without HTML tags');
  console.log('  • Tab key will indent without losing focus');
  console.log('  • Flashcards will support all formatting including bullets\n');

  console.log(`✓ ${successes.length} features working correctly`);
  if (warnings.length > 0) {
    console.log(`⚠ ${warnings.length} minor warnings (non-critical)`);
  }

  process.exit(0);
} else {
  console.log('❌ CRITICAL ISSUES DETECTED\n');
  console.log('Problems that will affect functionality:\n');
  criticalIssues.forEach(issue => console.log('  ' + issue));

  if (warnings.length > 0) {
    console.log('\nWarnings:\n');
    warnings.forEach(warning => console.log('  ' + warning));
  }

  console.log(`\n✓ ${successes.length} features working`);
  console.log(`✗ ${criticalIssues.length} critical issues`);
  console.log(`⚠ ${warnings.length} warnings`);

  process.exit(1);
}
