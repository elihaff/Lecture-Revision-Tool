# Testing Checklist - Medical Lecture Study Assistant v2.2

**URL**: https://lecture-revision-tool-v2-fjj1s3y4v-elihaffs-projects.vercel.app

---

## 🎯 QUICK TEST (5-10 minutes)

### Prerequisites
- [ ] Have a small PDF ready (2-3 slides is enough)
- [ ] Have your Anthropic API key ready
- [ ] Open the website in your browser

---

## TEST 1: Notes Generation ⏱️ ~2 minutes

### Steps:
1. [ ] Enter your API key in settings
2. [ ] Upload a PDF (2-3 slides recommended for quick test)
3. [ ] Wait for notes to generate

### Expected Result:
- [ ] ✅ Notes appear in sections
- [ ] ✅ Each section has bullet points
- [ ] ✅ Text is readable and relevant to PDF content
- [ ] ✅ No error messages

### If it fails:
- ❌ Check console for errors (F12 → Console tab)
- ❌ Verify API key is correct
- ❌ Check API usage limits

---

## TEST 2: Flashcards Generation ⏱️ ~1 minute

### Steps:
1. [ ] After notes generate, wait for flashcards
2. [ ] Click on a flashcard to expand it

### Expected Result:
- [ ] ✅ Flashcards appear with front (question) and back (answer)
- [ ] ✅ Can expand/collapse flashcards
- [ ] ✅ Text is readable and relevant

### If it fails:
- ❌ Check console for errors
- ❌ Verify flashcard generation step completed

---

## TEST 3: Notes Editing - Formatting ⏱️ ~3 minutes

### Steps:
1. [ ] Click "Edit" button on any note point
2. [ ] See the formatting toolbar appear (should have red background)
3. [ ] Type some test text: "This is a test"

### Test Each Format:
4. [ ] Select "test" and click **B** (Bold)
   - Expected: Text becomes bold visually
   - NOT Expected: You see `<b>test</b>` or `<strong>test</strong>`

5. [ ] Select "is" and click **I** (Italic)
   - Expected: Text becomes italic visually
   - NOT Expected: You see `<i>is</i>` or `<em>is</em>`

6. [ ] Select "This" and click **U** (Underline)
   - Expected: Text becomes underlined visually
   - NOT Expected: You see `<u>This</u>`

7. [ ] Click the bullet button (•)
   - Expected: Creates a bullet point
   - Expected: **Cursor stays where you are** (CRITICAL FIX)
   - NOT Expected: Cursor jumps to beginning of text

8. [ ] Press Tab key
   - Expected: Indents the bullet point
   - Expected: Focus stays in editor
   - NOT Expected: Focus switches to another button

9. [ ] Try special symbols: α, β, →, ±
   - Expected: Each symbol appears in text
   - Expected: Displays correctly

10. [ ] Click "Save"

---

## TEST 4: Notes Preview Display ⏱️ ~1 minute

### After saving edits from Test 3:

### Expected Result:
- [ ] ✅ Bold text appears **bold** (not `<b>bold</b>` or `**bold**`)
- [ ] ✅ Italic text appears *italic* (not `<i>italic</i>`)
- [ ] ✅ Underlined text appears underlined (not `<u>underlined</u>`)
- [ ] ✅ Bullets appear as actual bullet points (not `<ul><li>`)
- [ ] ✅ Special symbols display correctly (α, β, →, ±)
- [ ] ✅ **NO HTML TAGS VISIBLE** anywhere

### If you see HTML tags:
- ❌ CRITICAL BUG - Display is not using dangerouslySetInnerHTML
- ❌ Take a screenshot and let me know

---

## TEST 5: PDF Export ⏱️ ~2 minutes

### Steps:
1. [ ] Click "Download PDF" button
2. [ ] PDF opens in new tab
3. [ ] Scroll through the PDF

### Expected Result:
- [ ] ✅ Title appears at top
- [ ] ✅ Learning objectives listed
- [ ] ✅ All sections from notes included
- [ ] ✅ Bullet points show as `•` or `-`
- [ ] ✅ Bold text appears bold (or marked with `**`)
- [ ] ✅ Special symbols display or converted (→ becomes ->)
- [ ] ✅ **NO HTML TAGS** like `<b>`, `<ul>`, `<li>`, `<div>`, `<br>`

### If you see HTML tags in PDF:
- ❌ CRITICAL BUG - parseTextForPDF is not working
- ❌ Take a screenshot and tell me exactly which tags appear

---

## TEST 6: Flashcard Editing - Formatting ⏱️ ~2 minutes

### Steps:
1. [ ] Expand a flashcard
2. [ ] Click "Edit" button on the flashcard
3. [ ] See the formatting toolbar (gray background)
4. [ ] Type test text in the answer field

### Test Each Format:
5. [ ] Click **B** (Bold) and type "bold"
   - Expected: Text appears bold visually
   - NOT Expected: You see `<b>bold</b>`

6. [ ] Click **I** (Italic) and type "italic"
   - Expected: Text appears italic visually

7. [ ] Click **U** (Underline) and type "underline"
   - Expected: Text appears underlined visually

8. [ ] Click bullet button (•)
   - Expected: Creates a bullet
   - Expected: **Cursor stays in place** (CRITICAL FIX)
   - NOT Expected: Cursor jumps to beginning

9. [ ] Press Tab key
   - Expected: Indents
   - Expected: Focus stays in editor

10. [ ] Add special symbols (α, β, →)
    - Expected: Symbols appear

11. [ ] Click "Save"

---

## TEST 7: Flashcard Display ⏱️ ~1 minute

### After saving edits from Test 6:

### Expected Result:
- [ ] ✅ Bold text appears **bold** (not `<b>bold</b>`)
- [ ] ✅ Italic text appears *italic* (not `<i>italic</i>`)
- [ ] ✅ Underlined text appears underlined (not `<u>underlined</u>`)
- [ ] ✅ Bullets appear as actual bullet points (not `<ul><li>`)
- [ ] ✅ Special symbols display correctly
- [ ] ✅ **NO HTML TAGS VISIBLE**
- [ ] ✅ No console errors about "Cannot read properties of null"

### If you see HTML tags:
- ❌ CRITICAL BUG - Flashcard display issue
- ❌ Let me know

---

## TEST 8: Browser Console Check ⏱️ ~30 seconds

### Steps:
1. [ ] Press F12 (or right-click → Inspect)
2. [ ] Go to "Console" tab
3. [ ] Look for red error messages

### Expected Result:
- [ ] ✅ No red error messages
- [ ] ✅ No warnings about "innerHTML"
- [ ] ✅ No React warnings

### If you see errors:
- ❌ Copy the error message
- ❌ Tell me what action triggered it

---

## 📊 RESULTS SUMMARY

Fill this out after testing:

### ✅ What Works:
- [ ] Notes generation
- [ ] Flashcard generation
- [ ] Notes editing toolbar
- [ ] Flashcard editing toolbar
- [ ] Bold formatting (notes)
- [ ] Italic formatting (notes)
- [ ] Underline formatting (notes)
- [ ] Bullet points (notes)
- [ ] Tab indentation (notes)
- [ ] Special symbols (notes)
- [ ] Notes preview display (no HTML)
- [ ] PDF export (no HTML)
- [ ] Bold formatting (flashcards)
- [ ] Italic formatting (flashcards)
- [ ] Underline formatting (flashcards)
- [ ] Bullet points (flashcards)
- [ ] Tab indentation (flashcards)
- [ ] Special symbols (flashcards)
- [ ] Flashcard display (no HTML)

### ❌ What's Broken:
(List any issues found)

1.
2.
3.

---

## 🚨 CRITICAL BUGS TO WATCH FOR:

1. **Cursor Jumping**: When you click bullet button (•), does cursor jump to beginning?
   - If YES → Bug still exists
   - If NO → Fixed ✅

2. **HTML Tags Visible**: Do you see `<b>`, `<ul>`, `<li>`, `<div>` anywhere?
   - In notes preview? → Bug in display
   - In PDF? → Bug in parseTextForPDF
   - In flashcards? → Bug in flashcard display

3. **Console Errors**: Any errors about "Cannot read properties of null (reading 'innerHTML')"?
   - If YES → Bug in flashcard editor
   - If NO → Fixed ✅

4. **Tab Key**: Does Tab key move focus to next button instead of indenting?
   - If YES → Bug in keyDown handler
   - If NO → Fixed ✅

---

## 💡 TIPS FOR EFFICIENT TESTING:

1. **Use a small PDF** (2-3 slides) to speed up generation
2. **Test all formatting in one edit** instead of separate edits
3. **Check console immediately** if something looks wrong
4. **Take screenshots** of any bugs you find
5. **Note the exact steps** that caused any bugs

---

## ⏱️ ESTIMATED TOTAL TIME: 10-15 minutes

This comprehensive test will verify every fix made in v2.2.

If everything passes, the implementation is confirmed working! ✅
