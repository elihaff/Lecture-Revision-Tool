# Iterative Learning: UI Alignment Fix

## The Problem
Lecture counts on submodule cards were slightly misaligned - varying horizontal positions when scanning down the list of cards, despite multiple attempted fixes.

## Attempted Solutions That Failed

### Attempt 1: Percentage-based widths (`w-[60%]`, `w-[45%]`)
**Why it failed:** Percentage widths are relative to the parent container. Different components have different nesting depths and container widths, causing the percentages to calculate to different pixel values.

### Attempt 2: Invalid Tailwind class (`w-30`)
**Why it failed:** `w-30` doesn't exist in Tailwind's default spacing scale. Tailwind jumps from `w-28` (112px) to `w-32` (128px). The class was silently ignored, leaving the element with no defined width.

### Attempt 3: Fixed pixel widths for all columns
**Why it failed:** Fixed the lecture count width (`w-[130px]`) but positioned it relative to the left side of the card (after the title). Since titles have variable lengths, the lecture count still ended up at different horizontal positions.

### Attempt 4: Using `flex-shrink-0` on title with fixed max-width
**Why it failed:** `flex-shrink-0` prevents shrinking but the title still occupied its full specified width, pushing subsequent elements. The lecture count position still depended on title width.

## The Solution That Worked

**Add a spacer element between the title and lecture count:**

```jsx
{/* Title - max-width restricted */}
<div className="flex-1 min-w-0 py-3 pr-4 max-w-[400px]">
  <span>{submodule.name}</span>
</div>

{/* Spacer - absorbs remaining space */}
<div className="flex-1"></div>

{/* Lecture count - fixed position from right */}
<div className="w-[130px] flex-shrink-0">
  ...
</div>
```

**Why it works:** The spacer (`flex-1`) absorbs all remaining horizontal space between the title and lecture count. This pushes the lecture count and action buttons to the right edge of the card, maintaining a fixed distance from the right border regardless of title length.

## Root Cause Analysis

The fundamental error was **positioning from the wrong reference point**. I was calculating positions from the left (after preceding elements), when the requirement was for consistent alignment from the right.

### Mental Model Error
I thought: "Title takes X width, then lecture count starts at X"
Should have thought: "Lecture count is always Y pixels from the right edge"

## Why I Missed This Earlier

1. **Incremental thinking:** Each fix addressed the immediate symptom rather than stepping back to understand the underlying layout requirement.

2. **Left-to-right bias:** Default mental model for flexbox layouts flows left-to-right, making it natural to define widths sequentially from the left.

3. **Over-reliance on fixed widths:** Assumed fixed pixel widths would solve alignment, without considering that fixed widths still position elements relative to preceding content.

4. **Insufficient validation of Tailwind classes:** Used `w-30` without verifying it exists in Tailwind's spacing scale.

## Principles for Future Problem-Solving

### 1. Identify the Reference Point First
Before implementing, ask: "What should this element's position be relative to?"
- Left edge of container?
- Right edge of container?
- Another element?
- Centre of container?

### 2. Validate Framework-Specific Syntax
When using utility classes (Tailwind, Bootstrap, etc.), verify the class exists. Check documentation for:
- Valid spacing scale values
- Arbitrary value syntax (`w-[130px]` vs `w-130`)

### 3. Recognise the Spacer Pattern
When elements need to be pushed to opposite ends of a container:
```
[Left content] [Spacer flex-1] [Right content]
```
This is a common pattern that should be recognised immediately when requirements mention "fixed distance from edge."

### 4. Step Back After Two Failed Attempts
If two fixes don't work, stop and re-analyse the problem from first principles rather than making incremental adjustments.

### 5. Test with Extreme Cases
When debugging alignment, mentally test with:
- Very short content
- Very long content
- Empty content

If positions would differ, the solution is likely positioning from the wrong reference point.

## Applying to Future Issues

When a user reports misalignment:

1. **First question:** "Aligned relative to what?" (left edge, right edge, another element, centre)
2. **Second question:** "What varies?" (content length, container width, number of elements)
3. **Solution pattern:** Position fixed elements from the edge they should align to, use spacers to absorb variable space.

---

*This document captures learnings from the submodule card alignment fix. Future issues should reference this to avoid repeating the same debugging cycle.*

---

# Entry 2: Discovering Existing Functionality

## The Situation
When implementing PDF upload and AI notes generation, I initially started building an Edge Function from scratch with a simplified prompt for learning objectives extraction.

## What I Missed
The project already has a fully operational AI notes and flashcard generation tool deployed at **https://lecture-revision-tool-v2.vercel.app** (the `index.html.old` file). This existing implementation includes:

- Complete notes generation prompt (comprehensive, well-tested)
- Flashcard generation
- PDF thumbnail extraction
- Image cropping and annotation
- Export functionality (DOCX, PDF, CSV)
- Rich text editing for notes

## The Discovery
The user pointed out: *"this project already has the AI notes and flashcard generation operational"*

This revealed I had been:
1. Re-implementing existing functionality rather than integrating it
2. Using a simplified prompt when a battle-tested comprehensive prompt existed
3. Missing the opportunity to reuse proven code

## Root Cause Analysis

### Why I Missed This
1. **File naming assumption**: `index.html.old` suggested deprecated/legacy code, not actively deployed production code
2. **Scope interpretation**: Focused on "building new" rather than "integrating existing"
3. **Insufficient codebase reconnaissance**: Read the file but didn't check if it was deployed/operational

### Mental Model Error
I thought: "This is legacy code to reference for patterns"
Should have thought: "This is production code - how do I integrate with it?"

## Corrective Actions Taken
1. Updated the Edge Function to use the **complete notes generation prompt** from `index.html.old`
2. Added `notes` column to store the full notes structure (not just learning objectives)
3. Created `NotesView` component matching the existing tool's design
4. Navigation flow: Upload PDF → Generate notes → View notes

## Principles for Future Problem-Solving

### 1. Ask About Existing Deployments First
Before implementing any feature, ask:
- "Is there existing code that does this?"
- "Is there a deployed version I should check?"
- "What's the relationship between different files/versions?"

### 2. Don't Assume File Names Indicate Status
`*.old`, `*.backup`, `*.legacy` files might be:
- Actively deployed production code
- Reference implementations
- Previous architecture to migrate from

Always verify deployment status before assuming.

### 3. Integration Over Re-implementation
When existing code exists:
1. Understand it fully first
2. Reuse prompts, logic, and patterns
3. Build integration layers, not replacements
4. Preserve battle-tested elements

### 4. Check Deployment URLs
If given a production URL, **visit it** to understand:
- What's currently working
- What the user experience is
- What features exist

## Applying to Future Issues

When starting a new feature:

1. **First question**: "Does this already exist somewhere in the codebase?"
2. **Second question**: "Is there a deployed version I can reference?"
3. **Third question**: "What can I reuse vs. what needs to be built new?"

The goal is integration and enhancement, not reinvention.

---

*Added after implementing PDF upload feature and realising the existing tool at lecture-revision-tool-v2.vercel.app contained the complete AI processing logic.*

---

# Entry 3: Supabase Edge Function 401 Debugging - Interpretation Cards

## The Problem
Implementing the "Interpretation Cards" feature resulted in persistent 401 Unauthorized errors. The function `generate-interpretation` consistently failed while `generate-flashcards` worked perfectly with identical authentication patterns.

## Timeline of Investigation (v2.84 - v2.93)

### Phase 1: Initial Implementation (v2.84)
- Added interpretation card state variables and UI modal
- Created Edge Function using Claude Sonnet 4 with vision API
- Deployed with same pattern as `generate-flashcards`
- **Result:** 401 Unauthorized errors

### Phase 2: Authentication Troubleshooting (v2.85-v2.87)
**Hypotheses tested:**
1. Manual auth headers not being sent → Added explicit Authorization header
2. Supabase SDK not handling auth → Switched to direct fetch() with manual headers
3. Header case sensitivity → Tried both 'Authorization' and 'authorization'
4. Missing apikey header → Added explicit apikey header
5. Wrong Deno imports → Switched from `Deno.serve()` to `serve()` from std library

**Result:** Still 401 errors on every attempt

### Phase 3: Deep Investigation (v2.88-v2.91)
- Added extensive logging to both client and server
- Analyzed server metadata from Supabase logs
- **Key discovery:** Headers section showed NO authorization header, despite:
  - JWT being validated correctly (`sb.jwt.authorization` showed valid user)
  - Access token present on client
  - Headers being explicitly set in fetch() call

**Critical observation:** Execution time was 60-100ms (too fast for code to run), suggesting gateway-level rejection

### Phase 4: Configuration Investigation (v2.91-v2.92)
- Found `config.toml` has `verify_jwt = true` for both functions
- Attempted to match exact deployment patterns between working and broken functions
- Refactored to use `supabase.functions.invoke()` as primary method (matching flashcards)
- **Result:** Both primary and fallback methods still returned 401

### Phase 5: Root Cause Discovery
**The breakthrough:** Checked Supabase Dashboard settings

**Finding:** `generate-interpretation` had **"Verify JWT with legacy secret"** enabled
- This was a Dashboard setting, NOT in code
- `generate-flashcards` had verify_jwt completely OFF
- The setting validates JWT with an old secret instead of current one
- User's JWT was signed with current secret → validation failed → 401 before function code runs

**Resolution:** Disabled "Verify JWT with legacy secret" in Dashboard

### Phase 6: Secondary Issue (v2.93)
After fixing auth, encountered new error:
```
Anthropic API error: messages.0.content.0.image.source.base64:
The image was specified using the image/jpeg media type,
but the image appears to be a image/png image
```

**Cause:** Edge Function hardcoded `media_type: 'image/jpeg'` but images were PNG

**Fix:**
- Extract media type from data URL prefix (`data:image/png;base64,...`)
- Pass detected media type to Edge Function
- Use dynamic media type in Anthropic API call

### Phase 7: Settings Persistence Issue
After deploying the media type fix, 401 errors returned
- "Verify JWT with legacy secret" had been re-enabled
- **Likely cause:** Supabase deployment process reset Dashboard settings
- **Resolution:** Manually disabled setting again

## Root Cause Analysis

### Why 401 Persisted Despite Correct Code

**The disconnect between code and deployment:**
1. ✅ Edge Function code was correct (identical to working function)
2. ✅ Frontend auth handling was correct
3. ✅ Local `config.toml` had correct settings
4. ❌ **Supabase Dashboard had wrong JWT verification setting**

**Why this was hard to diagnose:**
- Dashboard settings are separate from code
- Settings don't show in deployment logs
- No error message indicating "wrong secret" vs generic "unauthorized"
- Working function had verify_jwt completely OFF (not using legacy secret)

### Mental Model Errors

**Error 1: Assuming code controls all behavior**
- Thought: "If code is identical, behavior should be identical"
- Reality: Dashboard settings override code configuration
- `config.toml` is for local development, not production deployment

**Error 2: Focus on header transmission**
- Spent hours debugging header case, fetch vs invoke, manual auth
- Real issue was gateway rejecting request before headers mattered
- Should have compared Dashboard settings earlier

**Error 3: File-based configuration assumptions**
- Assumed `verify_jwt = true` in config.toml would sync to Dashboard
- Reality: Separate configuration systems that don't auto-sync

## Principles for Future Problem-Solving

### 1. Check Dashboard Settings Immediately for Platform-Specific Issues

When debugging Supabase Edge Functions:
1. **First**: Compare Dashboard settings between working and broken functions
2. **Second**: Compare code
3. **Third**: Debug auth headers/implementation details

**Why:** Platform UI settings often override code configuration

### 2. Recognize Gateway vs. Function Errors

**Gateway-level rejection indicators:**
- Very fast execution time (< 100ms)
- No function logs appear
- No console.log output
- 401/403 errors without reaching code

**Function-level errors:**
- Normal execution time
- Logs appear showing code execution
- Specific error messages from function code
- 500 errors with stack traces

**Action:** If gateway-level, check authentication settings FIRST

### 3. Compare Configuration Holistically

When a working function exists, compare:
- ✅ Source code
- ✅ Environment variables
- ✅ **Dashboard UI settings** ← Often forgotten
- ✅ Deployment configuration
- ✅ API keys and secrets

Don't assume identical code means identical configuration.

### 4. Deployment Can Reset Settings

**Observation:** Dashboard settings were reset after deployment

**Implications:**
- Manual UI settings might not persist through deployments
- Need to verify settings after each deploy
- Consider infrastructure-as-code for settings persistence

### 5. Media Type Validation for Vision APIs

When using AI vision APIs (Claude, GPT-4V, etc.):
- **Never hardcode image format** (jpeg, png, etc.)
- Extract from data URL: `data:image/TYPE;base64,...`
- Pass actual format to API
- APIs strictly validate media_type vs actual image data

## Prevention Checklist for Future Edge Function Implementation

### Before Writing Code:
- [ ] Check if similar function exists (compare Dashboard and code)
- [ ] Review Dashboard settings of working reference function
- [ ] Document any UI-configured settings needed

### During Implementation:
- [ ] Use same Dashboard settings as working reference
- [ ] Don't hardcode media types for file uploads
- [ ] Add logging that would reveal gateway vs function errors

### After First Deployment:
- [ ] Verify Dashboard settings persisted
- [ ] Compare complete configuration (code + Dashboard) with working function
- [ ] Test with actual data (not just mock/minimal data)

### When Debugging 401/403:
- [ ] Check execution time (< 100ms = likely gateway)
- [ ] Check if function logs appear at all
- [ ] Compare Dashboard settings BEFORE diving into code
- [ ] Look for "legacy secret" or JWT validation toggles

## Applying to Future Issues

### Red Flags That Should Trigger "Check Dashboard Settings":
1. Identical code behaves differently
2. 401 errors with very fast execution time
3. No function logs appear
4. Working function exists with "identical" code
5. Gateway/authentication layer errors

### Questions to Ask Immediately:
1. "Does this platform have UI-based configuration?" (Dashboard, console, portal)
2. "What settings exist outside the codebase?"
3. "Are there any JWT/auth toggles in the UI?"
4. "Did settings change between working and broken deployments?"

### When User Reports It's Working:
If user manually fixes settings (like disabling verify_jwt):
1. **Document the exact setting changed**
2. **Check if deployment will reset it**
3. **Consider making it persist (IaC, deployment scripts)**
4. **Add to deployment checklist**

## Key Insight

**The hardest bugs to solve are those where the root cause exists outside the codebase.**

Platform configuration, Dashboard settings, external service configurations, API keys in wrong environment - these are invisible to code review and require systematic comparison of the entire deployment environment, not just the code.

When code is identical but behavior differs, the answer is always **environmental**, not **implementational**.

---

*Added after implementing Interpretation Cards feature and debugging 401 errors across versions 2.84-2.93. The resolution required disabling "Verify JWT with legacy secret" in Supabase Dashboard and implementing dynamic media type detection for image formats.*

---

# Entry 4: PDF Export Unicode Font Loading - "Unknown font format" Error

## The Problem
PDF export was failing with "Unknown font format" error. Clicking "Export PDF" would open a blank tab (about:blank) and the PDF would not generate. Console showed:
```
Uncaught (in promise) Error: Unknown font format
Unicode font preload failed, using fallback glyph mapping: Error: Unicode font probe failed after registration
```

## Timeline of Investigation (v3.3.1 - v3.04)

### Phase 1: Initial Error Discovery (v3.3.1)
**Symptoms:**
- Export PDF button opens new blank tab but PDF doesn't render
- Console error: "Unknown font format"
- Secondary error: "Unicode font probe failed after registration"

**Initial hypothesis:** Font files are corrupted or in wrong format

### Phase 2: Understanding the Font System
**Code analysis revealed:**
1. Code attempts to load `/DejaVuSans-Regular.ttf` and `/DejaVuSans-Bold.ttf`
2. Falls back to `/custom-fonts.js` if direct TTF load fails
3. Registers fonts as "NotoSans" in pdfMake (despite using DejaVu files)
4. Runs probe test to verify font can render Unicode characters (using arrow: →)

**Mental model error:** Initially thought font files themselves were the problem

### Phase 3: File System Investigation
**Discovery process:**
```bash
# Check what font files exist
find . -name "*.ttf"
```

**Findings:**
- `DejaVuSans-Regular.ttf` exists in project root (added Dec 19)
- `DejaVuSans-Bold.ttf` exists in project root (added Dec 19)
- Multiple NotoSans fonts exist (older, added Dec 18)
- DejaVu fonts are the MOST RECENT (intended to be used)
- No `custom-fonts.js` file exists

**Key realization:** Font files exist and are correct format

### Phase 4: Vite Static Asset Serving
**Root cause discovered:**

In Vite projects:
- Files in `public/` directory are served as static assets at root URL
- Files in project root are NOT automatically served
- Code was trying to fetch `/DejaVuSans-Regular.ttf` from web server
- But files were in project root, not accessible via HTTP

**Verification:**
```bash
ls -la  # No public directory exists
```

The fonts were in the wrong location for Vite to serve them.

### Phase 5: Resolution (v3.04)
**Solution implemented:**
```bash
mkdir -p public
mv DejaVuSans-Regular.ttf DejaVuSans-Bold.ttf public/
```

**Why this works:**
- Vite automatically serves files from `public/` at root URL
- `/DejaVuSans-Regular.ttf` now resolves to `public/DejaVuSans-Regular.ttf`
- Font loading succeeds
- Unicode probe test passes
- PDF exports successfully with DejaVu font supporting Unicode characters (arrows, symbols)

### Phase 6: User Confusion - Delayed Success
**Observation:** User reported error still occurring, but then clarified PDF actually loaded after a few seconds

**Why delay occurred:**
- First-time font load requires downloading ~1.4MB of font files
- Font probe test takes time to complete
- Browser caching improves subsequent exports

## Root Cause Analysis

### Why PDF Export Failed

**The fundamental error:** Font files in wrong directory for Vite build system

1. ❌ DejaVu fonts in project root
2. ✅ Code correctly tries to fetch from `/DejaVuSans-*.ttf`
3. ❌ Vite doesn't serve files from project root
4. ❌ 404 errors on font files (not visible to user)
5. ❌ Fallback to `custom-fonts.js` also fails (file doesn't exist)
6. ❌ pdfMake receives no valid fonts → "Unknown font format"

**After fix:**
1. ✅ Fonts in `public/` directory
2. ✅ Vite serves `public/` contents at root URL
3. ✅ Font files load successfully
4. ✅ Probe test passes
5. ✅ PDF exports with Unicode support

### Mental Model Errors

**Error 1: Assuming font file format was the issue**
- Thought: "Unknown font format means the .ttf files are corrupted or wrong type"
- Reality: Font files were perfect - they just weren't accessible via HTTP

**Error 2: Not understanding Vite's static asset system**
- Thought: "Files in project root should be accessible"
- Reality: Only `public/` directory contents are served as static assets in Vite

**Error 3: Misinterpreting "probe failed" error**
- Thought: "Probe failing means fonts are registered but incorrectly formatted"
- Reality: Probe failed because fonts never loaded in the first place

## Principles for Future Problem-Solving

### 1. Understand Build Tool Asset Serving

**For Vite projects:**
- `public/` → Served at root URL (`/file.txt`)
- `src/` → Bundled/processed, use imports
- Project root → NOT served

**Check first:**
1. Where are static files located?
2. How does the build tool serve them?
3. Can the browser actually fetch them?

### 2. Verify HTTP Requests Before Debugging Code

When files fail to load:
1. **First**: Open browser DevTools Network tab
2. **Check**: Are there 404 errors for the files?
3. **Test**: Can you manually navigate to the file URL?

**Action:** A 404 error immediately tells you it's a serving issue, not a file format issue

### 3. Error Messages Can Be Misleading

"Unknown font format" suggests:
- ❌ File is wrong format
- ❌ File is corrupted
- ✅ **Actually means:** Font couldn't be loaded at all

**Principle:** When an error message seems to suggest one thing, verify the prerequisite steps first (can the file even be accessed?)

### 4. Check File Timestamps for Intent

When multiple similar files exist (NotoSans vs DejaVu):
```bash
ls -lt *.ttf
```

Most recent files = current intention. Older files = legacy/abandoned.

### 5. First-Time vs Subsequent Behavior

**Observation:** Font loading takes time on first use, cached on subsequent uses

**Implication:**
- Don't assume instant failure if UI seems unresponsive
- Large assets (fonts, images) need time to load
- Browser caching affects testing (might work second time even if broken)

## Prevention Checklist for Future Static Asset Issues

### Before Adding Static Assets:
- [ ] Confirm where build tool expects static files (`public/` for Vite)
- [ ] Place files in correct directory from the start
- [ ] Test file accessibility via browser (navigate to URL)

### When Debugging Asset Loading Errors:
- [ ] Open browser DevTools → Network tab
- [ ] Look for 404/403 errors on asset files
- [ ] Manually test asset URL in browser
- [ ] Check build tool documentation for static asset serving

### When "Format" or "Invalid" Errors Occur:
- [ ] First verify file is accessible (not 404)
- [ ] Then verify file format/encoding
- [ ] Check if file needs to be processed by build tool

## Applying to Future Issues

### Red Flags That Should Trigger "Check Asset Serving":
1. Error mentions file format but file exists locally
2. Blank pages or missing content
3. Code tries to fetch from root URL (`/file.ext`)
4. Build tool is Vite, Next.js, or similar with specific asset handling
5. Works in development but fails in production

### Questions to Ask Immediately:
1. "Where is this file located in the project?"
2. "How does the build tool serve static assets?"
3. "Can the browser actually access this file via HTTP?"
4. "Are there 404 errors in the Network tab?"

### Standard Vite Static Asset Locations:
- **`public/`** → Static assets served at root (fonts, PDFs, etc.)
- **`src/assets/`** → Assets that need processing (images, CSS)
- **Project root** → Config files, NOT served to browser

## Key Insight

**File location errors manifest as file format errors.**

When a file can't be loaded, libraries often throw generic errors like "unknown format" or "invalid file" because they receive nothing (404) instead of file content. The error message points to the symptom (can't parse) rather than the cause (can't access).

**Before debugging file parsing/format:**
1. Verify the file is accessible via HTTP
2. Check browser Network tab for 404s
3. Confirm file is in correct directory for build tool

Static asset serving is environmental, not implementational.

---

*Added after fixing PDF export Unicode font loading issue in v3.04. The resolution required moving DejaVuSans font files from project root to `public/` directory so Vite could serve them as static assets.*

---

# Entry 5: Link Existing Image Created Duplicate Figure Instead of Reference-Only

## The Problem
After moving "Link Existing Image" into the image insertion modal, selecting an existing image from that flow was creating a new figure entry instead of only adding a reference to the existing figure.

**Expected behavior:**
- Link action should only append `(Fig X)` to the target bullet point.
- No new image should be inserted.
- No new figure number should be created.

**Actual behavior:**
- Linked bullet was treated like a newly inserted image.
- A separate figure number was created.
- The same image appeared again in the section image grid.

## Timeline of Investigation (v3.06 - v3.07)

### Phase 1: UI Refactor Completed (v3.06)
- Moved "Link Existing Image" into the image insertion tool.
- Removed old standalone link modal.
- UI looked correct and linking options were accessible from the new flow.

### Phase 2: Functional Regression Discovered
- User reported that link selection duplicated images instead of creating pure references.
- Confirmed mismatch between UI intent and data/rendering behavior.

### Phase 3: Root Cause Isolation
Code review identified two coupling issues in `NotesView`:

1. `getPointImage()` resolved references by returning source image data.
2. `getFigureNumber()` counted `imageReferences` as if they were real images.

Together this caused linked points to be interpreted as direct image-bearing points.

## Root Cause Analysis

### Why Duplication Happened
The model treated **"has reference"** as equivalent to **"has image"**.

That made linked bullets participate in:
- figure counting,
- figure assignment,
- and image grid rendering.

### Mental Model Error
I thought: "A linked image can be represented by returning image data from `getPointImage()`."
Should have thought: "Reference and image are different entity types with different rendering/counting rules."

## Corrective Actions Taken

1. Changed `getPointImage()` to return only direct point images (no reference resolution).
2. Updated figure-number logic so linked points resolve to the source figure number and never create a new figure.
3. Updated counting logic to count only real images (`pointImages`), not references.
4. Updated reference creation to clear any direct image at the target point to enforce reference-only behavior.
5. Updated export path to resolve references by key and reuse existing figure numbering.

## Principles for Future Problem-Solving

### 1. Separate Entity Types Explicitly
Do not blur:
- direct assets (real images)
- symbolic links/references (metadata pointers)

Each should have separate logic paths.

### 2. Keep Counting Logic Source-of-Truth Clean
If a counter represents "number of real assets", never include references in that counter.

### 3. UI Refactor Requires Behavioral Invariants
When moving features between modals/components, verify not only UI parity but also:
- persistence semantics,
- counting semantics,
- and export semantics.

### 4. Prefer Reference Resolution at Display Time, Not Storage Time
Store references as keys/pointers.
Resolve to figure labels when rendering text (e.g., `(Fig X)`), not as copied image objects.

## Prevention Checklist for Reference Features

- [ ] Confirm direct image and reference states are disjoint.
- [ ] Confirm linking cannot produce new grid images.
- [ ] Confirm figure numbering only increments for direct images.
- [ ] Confirm linked bullets inherit existing figure number.
- [ ] Confirm PDF export uses same reference semantics as UI.

## Applying to Future Issues

### Red Flags That Should Trigger "Reference vs Asset" Review:
1. Linked items appear as duplicates.
2. Numbered references unexpectedly increment.
3. "Pointer" actions create new visual artifacts.
4. Export output contains duplicated figures not present in intended model.

### Questions to Ask Immediately:
1. "Is this item stored as an asset or as a pointer?"
2. "Which code paths increment counters?"
3. "Does render logic treat references as concrete assets?"
4. "Does export logic match UI semantics?"

## Key Insight

**A reference is not a resource.**

If a reference is allowed to masquerade as a concrete asset in helper functions, duplication bugs become inevitable across UI, numbering, and export. Keep direct content and references distinct at every layer.

---

*Added after fixing the "Link Existing Image" regression in v3.07, where links were incorrectly counted/rendered as new figures instead of reference-only `(Fig X)` annotations.*

---

# Entry 6: PDF Image Tiling for Mixed Aspect Ratios (Space Efficiency + Readability)

## The Problem
PDF exports were wasting significant vertical space when sections contained mixed-aspect-ratio images.

The target layout requirement was explicit:
- Very wide images (e.g. Fig 1) should appear on their own row.
- Complementary images (e.g. tall/narrow + moderate-wide, like Fig 2 + Fig 3) should be tiled together on a shared row.
- Prioritise space efficiency in PDF without making images unreadably small.

## Timeline of Investigation (v3.11 - v3.16)

### Phase 1: Initial Readability Promotion
- Added logic to promote "difficult" images to larger, full-width rows.
- This improved readability for some slides but over-expanded many figures.
- Result: too many single-image rows, increased page count.

### Phase 2: Removed Unbreakable Grouping
- Removed `unbreakable` on section image groups so rows could spill across pages.
- This fixed blank-space page jumps but did not solve poor row composition.

### Phase 3: First Tiling Attempt
- Introduced a justified row fit model for 1-4 images per row.
- Better general packing, but still failed specific user case:
  - Fig 3 was still treated too aggressively as a single-row image.

### Phase 4: Root-Cause Clarification with User Screenshots
Screenshots showed:
- Fig 1 placement was correct.
- Fig 2 and Fig 3 were still split across pages/rows and oversized.

Key requirement clarification:
- Aesthetics are secondary.
- If two images can fit in one row, they should be forced together.

### Phase 5: Final Rule Set
- Increased "single-row forced promotion" threshold to only **extreme ultra-wide** images.
- Added hard pairing override:
  - Complementary pair (`tall + moderate-wide`) should be forced into same row if physically fit.
  - Final two remaining non-promoted images should attempt pairing first.
- Kept adaptive 1-4 image row packing for other cases.

## Root Cause Analysis

### Why Earlier Attempts Failed
1. Promotion thresholds were too permissive, causing moderate-wide figures to be treated as full-row figures.
2. Pairing was heuristic-only, so desired pairings could be skipped by scoring.
3. No hard fallback for final two images, causing avoidable split rows.

### Mental Model Error
I thought: "A good scoring heuristic will naturally choose the best layout."
Should have thought: "Some layout outcomes are hard constraints from user intent and must be encoded as explicit rules."

## Corrective Actions Taken

1. Restricted full-row promotion to only extreme width ratios.
2. Implemented adaptive row packing (1-4 images) with justified-width math.
3. Added deterministic pair-forcing for complementary and final-two cases.
4. Preserved page spillover behavior by avoiding unbreakable section image blocks.
5. Tuned row height bounds for compact PDF usage.

## Principles for Future Problem-Solving

### 1. Separate Soft Heuristics from Hard Layout Requirements
Use scoring only after mandatory rules are satisfied.

### 2. Encode Complementary Geometry Explicitly
Tall+narrow and moderate-wide pairings should be treated as first-class patterns, not accidental outcomes.

### 3. User-Visible Export Layout Needs Example-Driven Validation
When users provide a specific figure arrangement target, validate against that exact arrangement before generalising.

### 4. PDF Constraints Differ from Interactive UI
In PDF there is no zoom/expand affordance, so compaction and pairing logic must be stronger and more deterministic.

## Prevention Checklist for Future PDF Layout Work

- [ ] Validate against a concrete mixed-ratio sample (wide + tall + moderate-wide).
- [ ] Ensure only extreme-wide images are forced to solo rows.
- [ ] Ensure final-two images attempt pairing before splitting.
- [ ] Confirm section image blocks can spill across pages (no unnecessary blank pages).
- [ ] Check total page count impact after layout changes.

## Applying to Future Issues

### Red Flags
1. Moderate-wide images repeatedly rendered as full-row.
2. Final two images split despite obvious pairing opportunity.
3. Page count jumps significantly after adding a small number of figures.
4. Large blank areas appear between section text and figures.

### Questions to Ask Immediately
1. "Is this a hard layout constraint or a soft preference?"
2. "What exact pair/group should be forced to stay on one row?"
3. "Are promotion thresholds too broad for this dataset?"
4. "Does final-two fallback logic exist and run?"

## Key Insight

**For export layouts, deterministic packing rules beat pure heuristics.**

Heuristics improve average quality, but user-critical arrangements (like specific complementary pairs) require explicit, enforceable rules to avoid regressions and unnecessary page growth.

---

*Added after iterative fixes to PDF image tiling through v3.16. The final approach combined stricter full-row thresholds with adaptive justified rows and hard complementary/final-two pairing rules to achieve space-efficient, user-aligned layouts.*

---

# Entry 7: PDF Singleton Image Sizing - Fixing Oversized Standalone Figures

## The Problem
After improving mixed-ratio tiling (Fig 1/2/3 case), standalone images in later sections (e.g. Fig 4) were still too large in exported PDFs and consumed excessive vertical space.

Desired behavior:
- Keep paired/tiled rows readable.
- Keep singleton rows compact and consistent with space-efficiency goals.

## What Went Wrong

### Surface Assumption
I initially tuned the "single image" size caps (`single` mode), expecting standalone images to use that path.

### Actual Control Path
Standalone images were being sized by the adaptive row packer (`count === 1` case), not by the fallback `single` size mode.

Result:
- Adjusting fallback caps had little/no effect on real singleton output.

## Root Cause Analysis

### Why Previous Changes Didn't Fully Work
1. The wrong sizing path was tuned.
2. Adaptive row solver allowed singleton rows to resolve to relatively large heights.
3. No singleton-specific clamp existed inside the solver itself.

### Mental Model Error
I thought: "Standalone figures are controlled by explicit single-image sizing settings."
Should have thought: "In the current architecture, singleton rows are part of the adaptive justified layout and must be constrained there."

## Corrective Actions Taken

1. Added explicit singleton row constraints inside the adaptive packer:
   - `singletonMinHeight`
   - `singletonMaxHeight`
   - `singletonTargetHeight`
2. Applied singleton-specific clamping only when `count === 1`.
3. Added a small scoring penalty to discourage unnecessary singleton rows when pairing is viable.
4. Kept multi-image row logic unchanged to preserve the already-good Fig 1/2/3 behavior.

## Principles for Future Problem-Solving

### 1. Tune the Active Path, Not the Backup Path
Before tuning constants, verify which branch is actually producing the observed output.

### 2. Add Local Constraints Where Decisions Are Made
If layout decisions are made in a solver, constraints must be embedded in that solver, not only in helper functions.

### 3. Preserve Working Subsystems While Fixing Edge Cases
When one scenario is already correct, isolate fixes to the failing branch to avoid regressions.

## Prevention Checklist

- [ ] Confirm which branch handles singleton rows in current layout algorithm.
- [ ] Add per-branch caps (singleton vs paired vs promoted).
- [ ] Validate with multi-section sample containing both paired and singleton figures.
- [ ] Re-check page count impact after singleton tuning.

## Key Insight

**Layout bugs often persist when configuration is changed outside the actual decision engine.**

If a renderer uses a central packer/solver, the only reliable fix is to enforce constraints in that same packer/solver branch that emits the problematic layout.

---

*Added after refining PDF export behavior post-v3.16 to fix oversized standalone figures while preserving successful complementary tiling behavior.*

---

# Entry 8: Flashcard Attached Image Deletion UX - In-Place Controls in Edit Mode

## The Problem
After adding removable attached images in Flashcards view, deletion controls were shown on duplicate mini previews below the answer, not on the actual images inside the answer content.

Desired behavior:
- No duplicate mini image strip.
- In edit mode, `X` should appear on the real image inside the answer box.
- No removal controls in non-edit (read-only) view.

## What Went Wrong

### Initial Implementation Error
I used a separate `answerImages` preview block to render removable thumbnails.  
That created a second visual representation of images and disconnected deletion UI from the actual editable content.

### UX Mismatch
The user interacted with images in the answer body, but removal affordance existed on a different copy, which felt wrong and cluttered.

## Root Cause Analysis

1. I treated metadata (`answerImages`) as primary UI instead of treating `back` HTML as primary render surface.
2. The deletion path operated on data-level references rather than direct in-editor DOM context.
3. Edit/read-only visibility rules were not strict enough in the initial approach.

## Corrective Actions Taken

1. Removed duplicate mini preview strip from edit view.
2. Added in-place image interaction in the answer editor:
   - click an image in the editable answer
   - show `X` overlay on that exact image
3. Deletion now removes the selected image directly from editor HTML.
4. On save, `answerImages` metadata is synced from the final `back` HTML so stale entries are pruned.
5. Kept removal affordance edit-only; read-only card view has no `X` controls.

## Principles for Future Problem-Solving

### 1. Use the User’s Primary Surface as the Control Surface
If users edit content in-place, destructive controls should be attached to that same content, not a parallel representation.

### 2. Avoid Duplicate Representations Unless Strictly Necessary
A duplicated view for convenience can create state drift and confusing UX unless explicitly required.

### 3. Sync Metadata from Canonical Content
When HTML content is the canonical answer body, attachment metadata must be reconciled against that HTML after edits.

## Prevention Checklist

- [ ] Confirm controls are on the same visual element users perceive as “the source of truth.”
- [ ] Avoid creating secondary preview strips for operations that can be done in-place.
- [ ] Ensure edit-only controls do not leak into read-only views.
- [ ] Reconcile attachment metadata with final saved HTML to prevent stale references.

## Key Insight

**For rich-text answers, in-place controls beat sidecar controls.**

Users trust the content they directly edit; attaching actions (like delete image) to that exact content avoids cognitive mismatch and reduces UI clutter.

---

*Added after v3.28 fix to move flashcard image deletion controls from duplicate previews to in-editor, in-place image overlays.*
