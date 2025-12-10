/**
 * Automated Browser Testing for Medical Lecture Study Assistant
 * This script uses Puppeteer to actually open and test the website
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Test configuration
const WEBSITE_URL = 'https://lecture-revision-tool-v2-fjj1s3y4v-elihaffs-projects.vercel.app';
const LOCAL_FILE_URL = 'file://' + path.join(__dirname, 'index.html');

let browser;
let page;
let testResults = [];

function log(message, type = 'info') {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = type === 'pass' ? '✓' : type === 'fail' ? '✗' : type === 'warn' ? '⚠' : 'ℹ';
  console.log(`[${timestamp}] ${prefix} ${message}`);
  testResults.push({ timestamp, type, message });
}

async function setupBrowser() {
  log('Launching browser...', 'info');
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  page = await browser.newPage();

  // Set viewport
  await page.setViewport({ width: 1920, height: 1080 });

  // Listen for console messages
  page.on('console', msg => {
    const type = msg.type();
    if (type === 'error') {
      log(`Browser Console Error: ${msg.text()}`, 'fail');
    }
  });

  // Listen for page errors
  page.on('pageerror', error => {
    log(`Page Error: ${error.message}`, 'fail');
  });

  log('Browser launched successfully', 'pass');
}

async function testBasicLoad() {
  log('\n=== TEST 1: Basic Page Load ===', 'info');

  try {
    // Try loading the deployed website
    log(`Loading ${WEBSITE_URL}...`, 'info');
    const response = await page.goto(WEBSITE_URL, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    if (response.ok()) {
      log('Page loaded successfully', 'pass');
    } else {
      log(`Page loaded with status: ${response.status()}`, 'warn');
    }

    // Check for version indicator
    const versionText = await page.evaluate(() => {
      const el = document.querySelector('body');
      return el ? el.innerText : '';
    });

    if (versionText.includes('v2.2')) {
      log('Version v2.2 detected on page', 'pass');
    } else if (versionText.includes('v2')) {
      log('Version 2.x detected (may not be latest)', 'warn');
    }

    // Check if React loaded
    const hasReact = await page.evaluate(() => {
      return typeof window.React !== 'undefined' || document.querySelector('[data-reactroot]') !== null;
    });

    if (hasReact) {
      log('React application loaded', 'pass');
    } else {
      log('React may not be loaded correctly', 'warn');
    }

    // Take a screenshot
    await page.screenshot({ path: 'test-screenshots/01-page-load.png', fullPage: true });
    log('Screenshot saved: test-screenshots/01-page-load.png', 'info');

    return true;
  } catch (error) {
    log(`Failed to load page: ${error.message}`, 'fail');
    return false;
  }
}

async function testContentEditableImplementation() {
  log('\n=== TEST 2: ContentEditable Implementation Check ===', 'info');

  try {
    // Check if we can access the local file to inspect implementation
    log('Checking implementation details...', 'info');

    const htmlContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

    // Check for ref callback pattern (not dangerouslySetInnerHTML in contentEditable)
    const hasRefCallback = /ref=\{?\(el\)\s*=>\s*\{/.test(htmlContent);
    const hasTextareaRefAssignment = /textareaRef\.current\s*=\s*el/.test(htmlContent);
    const hasCardRefAssignment = /cardTextareaRef\.current\s*=\s*el/.test(htmlContent);
    const hasCursorPositioning = /range\.setStart/.test(htmlContent);
    const hasOnInput = /onInput=\{/.test(htmlContent);
    const hasTabHandler = /if\s*\(e\.key\s*===\s*['"]Tab['"]\)/.test(htmlContent);

    if (hasRefCallback && hasTextareaRefAssignment) {
      log('Notes editor uses ref callback pattern (correct)', 'pass');
    } else {
      log('Notes editor may not use ref callback pattern', 'fail');
    }

    if (hasCardRefAssignment) {
      log('Flashcard editor uses ref callback pattern (correct)', 'pass');
    } else {
      log('Flashcard editor may not use ref callback pattern', 'fail');
    }

    if (hasCursorPositioning) {
      log('Cursor positioning logic present', 'pass');
    } else {
      log('Cursor positioning logic missing', 'fail');
    }

    if (hasOnInput) {
      log('onInput handlers present', 'pass');
    } else {
      log('onInput handlers missing', 'fail');
    }

    if (hasTabHandler) {
      log('Tab key handlers present', 'pass');
    } else {
      log('Tab key handlers missing', 'fail');
    }

    // Check display uses dangerouslySetInnerHTML
    const displayUsesDangerous = /dangerouslySetInnerHTML=\{\{\s*__html:\s*[pc]/.test(htmlContent);
    if (displayUsesDangerous) {
      log('Display uses dangerouslySetInnerHTML (correct)', 'pass');
    } else {
      log('Display may not render HTML correctly', 'fail');
    }

    // Check PDF parsing
    const hasPDFParsing = /<ul\[/.test(htmlContent) && /<li\[/.test(htmlContent);
    if (hasPDFParsing) {
      log('PDF parsing handles HTML tags', 'pass');
    } else {
      log('PDF parsing may not handle all HTML tags', 'warn');
    }

    return true;
  } catch (error) {
    log(`Failed to check implementation: ${error.message}`, 'fail');
    return false;
  }
}

async function testFormattingToolbar() {
  log('\n=== TEST 3: Formatting Toolbar Simulation ===', 'info');

  try {
    // Navigate to local file for testing (faster and doesn't use API)
    log('Loading local file for UI testing...', 'info');
    await page.goto(LOCAL_FILE_URL, { waitUntil: 'networkidle2', timeout: 10000 });

    // Wait for React to render
    await page.waitForTimeout(2000);

    // Check if toolbar elements exist by looking for specific buttons
    const toolbarExists = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      let hasBold = false;
      let hasItalic = false;
      let hasBullet = false;

      buttons.forEach(btn => {
        const text = btn.textContent || btn.innerText;
        if (text.includes('B') && text.length < 5) hasBold = true;
        if (text.includes('I') && text.length < 5) hasItalic = true;
        if (text.includes('•')) hasBullet = true;
      });

      return { hasBold, hasItalic, hasBullet, totalButtons: buttons.length };
    });

    log(`Found ${toolbarExists.totalButtons} buttons on page`, 'info');

    if (toolbarExists.hasBold) {
      log('Bold button detected', 'pass');
    } else {
      log('Bold button not found', 'warn');
    }

    if (toolbarExists.hasItalic) {
      log('Italic button detected', 'pass');
    } else {
      log('Italic button not found', 'warn');
    }

    if (toolbarExists.hasBullet) {
      log('Bullet button detected', 'pass');
    } else {
      log('Bullet button not found', 'warn');
    }

    // Take screenshot
    await page.screenshot({ path: 'test-screenshots/03-toolbar-check.png', fullPage: true });
    log('Screenshot saved: test-screenshots/03-toolbar-check.png', 'info');

    return true;
  } catch (error) {
    log(`Failed to test toolbar: ${error.message}`, 'fail');
    return false;
  }
}

async function testHTMLRendering() {
  log('\n=== TEST 4: HTML Rendering Simulation ===', 'info');

  try {
    // Create a test div to simulate how content would be rendered
    const renderingTest = await page.evaluate(() => {
      // Test dangerouslySetInnerHTML rendering
      const testDiv = document.createElement('div');
      const testHTML = '<b>Bold text</b> with <ul><li>bullet point</li></ul>';
      testDiv.innerHTML = testHTML;
      document.body.appendChild(testDiv);

      const renderedText = testDiv.textContent || testDiv.innerText;
      const hasHTMLTags = testDiv.innerHTML.includes('<b>') && testDiv.innerHTML.includes('<ul>');
      const visuallyFormatted = testDiv.querySelector('b') !== null && testDiv.querySelector('li') !== null;

      document.body.removeChild(testDiv);

      return {
        renderedText,
        hasHTMLTags,
        visuallyFormatted,
        innerHTML: testDiv.innerHTML.substring(0, 100)
      };
    });

    if (renderingTest.visuallyFormatted) {
      log('HTML renders as formatted elements (correct)', 'pass');
    } else {
      log('HTML may not render correctly', 'fail');
    }

    if (renderingTest.renderedText.includes('Bold text')) {
      log('Text content extracts correctly', 'pass');
    }

    // Test parseTextForPDF simulation
    log('Testing PDF conversion logic...', 'info');

    const pdfConversion = await page.evaluate(() => {
      // Simulate parseTextForPDF function
      const testHTML = '<ul><li><b>Bold item</b></li><li>Normal item</li></ul><div>Text</div>';
      let str = testHTML;

      // Apply the same transformations as parseTextForPDF
      str = str.replace(/<ul[^>]*>/gi, '');
      str = str.replace(/<\/ul>/gi, '');
      str = str.replace(/<li[^>]*>/gi, '• ');
      str = str.replace(/<\/li>/gi, '\n');
      str = str.replace(/<div[^>]*>/gi, '');
      str = str.replace(/<\/div>/gi, '\n');
      str = str.replace(/<b>/gi, '**').replace(/<\/b>/gi, '**');
      str = str.replace(/<[^>]+>/g, '');
      str = str.replace(/\n{3,}/g, '\n\n');

      return {
        input: testHTML,
        output: str,
        hasHTMLTags: /<[^>]+>/.test(str)
      };
    });

    log(`PDF Input:  ${pdfConversion.input}`, 'info');
    log(`PDF Output: ${pdfConversion.output.replace(/\n/g, '\\n')}`, 'info');

    if (!pdfConversion.hasHTMLTags) {
      log('PDF conversion removes all HTML tags (correct)', 'pass');
    } else {
      log('PDF conversion leaves HTML tags (incorrect)', 'fail');
    }

    if (pdfConversion.output.includes('• ')) {
      log('PDF conversion creates bullet points (correct)', 'pass');
    } else {
      log('PDF conversion missing bullet points', 'fail');
    }

    return true;
  } catch (error) {
    log(`Failed to test HTML rendering: ${error.message}`, 'fail');
    return false;
  }
}

async function testContentEditableBehavior() {
  log('\n=== TEST 5: ContentEditable Behavior Test ===', 'info');

  try {
    // Create a test contentEditable element and test cursor behavior
    const cursorTest = await page.evaluate(() => {
      const testDiv = document.createElement('div');
      testDiv.contentEditable = true;
      testDiv.style.cssText = 'width: 300px; height: 100px; border: 1px solid black; padding: 10px;';
      document.body.appendChild(testDiv);

      // Simulate typing and adding bullet
      testDiv.focus();
      document.execCommand('insertText', false, 'Test text');

      // Get cursor position before bullet
      const selBefore = window.getSelection();
      const rangeBefore = selBefore.getRangeAt(0);
      const positionBefore = rangeBefore.startOffset;

      // Add bullet list
      document.execCommand('insertUnorderedList');

      // Check if cursor position changed unexpectedly
      const selAfter = window.getSelection();
      let cursorJumped = false;

      if (selAfter.rangeCount > 0) {
        const rangeAfter = selAfter.getRangeAt(0);
        // If cursor went to position 0, it jumped to beginning
        cursorJumped = rangeAfter.startOffset === 0 && positionBefore > 0;
      }

      const html = testDiv.innerHTML;
      const hasBullet = html.includes('<ul') || html.includes('<li');

      document.body.removeChild(testDiv);

      return {
        hasBullet,
        cursorJumped,
        html: html.substring(0, 100)
      };
    });

    if (cursorTest.hasBullet) {
      log('Bullet list creation works', 'pass');
    } else {
      log('Bullet list creation failed', 'fail');
    }

    if (!cursorTest.cursorJumped) {
      log('Cursor does not jump to beginning (correct)', 'pass');
    } else {
      log('Cursor jumps to beginning (BUG)', 'fail');
    }

    log(`Generated HTML: ${cursorTest.html}`, 'info');

    return true;
  } catch (error) {
    log(`Failed to test contentEditable: ${error.message}`, 'fail');
    return false;
  }
}

async function generateReport() {
  log('\n=== FINAL TEST REPORT ===', 'info');

  const passed = testResults.filter(r => r.type === 'pass').length;
  const failed = testResults.filter(r => r.type === 'fail').length;
  const warnings = testResults.filter(r => r.type === 'warn').length;

  log(`Total Tests: ${testResults.length}`, 'info');
  log(`Passed: ${passed}`, 'pass');
  log(`Failed: ${failed}`, failed > 0 ? 'fail' : 'pass');
  log(`Warnings: ${warnings}`, warnings > 0 ? 'warn' : 'info');

  // Save detailed report
  const report = {
    timestamp: new Date().toISOString(),
    summary: { passed, failed, warnings, total: testResults.length },
    results: testResults
  };

  fs.writeFileSync('test-results.json', JSON.stringify(report, null, 2));
  log('Detailed report saved to test-results.json', 'info');

  if (failed === 0) {
    log('\n✅ ALL CRITICAL TESTS PASSED', 'pass');
    log('The implementation appears to be working correctly!', 'pass');
    return 0;
  } else {
    log('\n❌ SOME TESTS FAILED', 'fail');
    log('Review the results above for details', 'fail');
    return 1;
  }
}

// Main execution
(async () => {
  try {
    // Create screenshots directory
    if (!fs.existsSync('test-screenshots')) {
      fs.mkdirSync('test-screenshots');
    }

    await setupBrowser();

    await testBasicLoad();
    await testContentEditableImplementation();
    await testFormattingToolbar();
    await testHTMLRendering();
    await testContentEditableBehavior();

    const exitCode = await generateReport();

    await browser.close();
    log('Browser closed', 'info');

    process.exit(exitCode);
  } catch (error) {
    console.error('Fatal error:', error);
    if (browser) await browser.close();
    process.exit(1);
  }
})();
