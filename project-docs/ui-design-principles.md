# UI Design Principles

## Core Philosophy

This is an AI-powered revision tool designed to optimise how students learn and retain knowledge. The core philosophy is **radical simplicity and constraint**.

The goal is **not to give students flexibility**. Most learning tools fail because they give users too many choices (how to organise notes, how to revise, what to review next, what system to follow). This creates friction and decision fatigue, which leads to procrastination and inconsistent study habits.

Instead, this tool functions as a **learning operating system**: a structured environment that removes decision-making and guides the user through the optimal learning workflow automatically.

The system handles:

- Organising lectures
- Generating concise notes
- Generating flashcards
- Scheduling spaced repetition
- Guiding daily study sessions

The user's only job is **to follow the system**.

## Core Workflow

```
Modules
→ Lectures
→ Learn the lecture (section by section)
→ Active recall through flashcards
→ Scheduled review through spaced repetition
```

The interface reinforces this workflow at every step.

## Design Goals

The UI should feel:

- Calm
- Coherent
- Obvious to use
- Cognitively lightweight

Similar to Apple's design philosophy.

## Design Principles

### 1. One Clear Action Per Screen

Each page should have one obvious next step.

### 2. Minimal Decision-Making

Do not present the user with many options or controls.

### 3. Strong Visual Hierarchy

Important actions should be visually dominant.

### 4. Generous Whitespace

Avoid dense interfaces or clutter.

### 5. Consistency

Reuse the same components and layout patterns across the app.

### 6. Progressive Disclosure

Advanced features should be hidden unless needed.

### 7. Focus on Learning Flow

The UI should make it effortless to move through the sequence:

```
Dashboard → Module → Lecture → Study → Recall
```

## Anti-Patterns to Avoid

The design should prioritise **cognitive clarity over feature density**.

Avoid:

- Crowded dashboards
- Too many buttons or controls
- Complex menus
- Unnecessary settings
- User configuration where the system can decide automatically

The ideal experience: a user opens the tool and immediately sees **what they should study next**, without needing to plan or think about it.

## Visual Rhythm

Visual rhythm means the layout follows a consistent spatial pattern across the interface. When pages follow the same structure repeatedly, the brain quickly learns the pattern and navigation becomes effortless. This reduces cognitive load and allows the user to focus on learning rather than interpreting the interface.

### Lecture Study View Structure

Every section should follow the same structure:

```
Lecture Title

Section Title
Explanation paragraph
Key points (bullet list)
Image (optional)
Next section action
```

The order of elements should always remain consistent:
1. Explanation first
2. Key points second
3. Image third

This predictable structure helps the brain move through the content smoothly.

### Spacing Rhythm

- **Large spacing** separates major sections
- **Medium spacing** separates content blocks
- **Small spacing** separates text elements

Consistent spacing creates a calm and readable interface.

### Visual Anchors

Each page should have a **clear visual anchor** - the element that grounds the page and immediately tells the user where they are. For lecture pages, the section title serves as this anchor.

## Page Flow Experience

The overall experience should feel similar to **turning pages in a well-structured book**. The user naturally moves through:

```
read → understand → next section → recall → next
```

The system guides this flow automatically.

## Daily Study Screen

A key feature is the **daily study screen** that removes planning from the user. When a user opens the tool they immediately see what they need to study that day.

### Example Layout

```
Today's Study

2 Lectures to Learn
23 Flashcards to Review

[Start Session]
```

Pressing "Start Session" guides the user through the required lectures and flashcards in the correct order without requiring them to choose what to do next.

## Colour System

The visual design must prioritise **focus, readability, and cognitive comfort**, not branding or visual flashiness. The goal is to create a visual environment that supports **sustained concentration for long periods of reading and recall**.

### 1. Neutral Background

Avoid pure white backgrounds because they can cause glare and eye strain during long study sessions. Instead use a very light neutral grey or off-white background.

**Recommended background colour:** `#F7F7F8`

This reduces visual fatigue while maintaining clarity and contrast.

### 2. High Contrast Text (But Not Pure Black)

Avoid pure black text (`#000000`) because it can feel harsh against a light background. Use a slightly softened dark grey instead.

**Recommended:**
- Primary text: `#111111`
- Secondary text: `#6B6B6B`

This creates a clear hierarchy while remaining comfortable to read.

### 3. Single Calm Accent Colour

The interface should use only one main accent colour. Too many colours create distraction and visual noise.

Blue is ideal because it is associated with focus, stability, and calmness.

**Recommended accent colour:** `#007AFF`

This colour should be used only for:
- Primary buttons
- Links
- Active states
- Progress indicators

Most of the interface should remain neutral.

### 4. Avoid Stimulating Colours

Bright warm colours such as red, orange, and saturated yellow should not appear frequently in the interface because they can increase visual stimulation and distraction.

These colours should only appear for alerts or feedback.

**Example alert colours:**
- Correct: `#34C759`
- Incorrect: `#FF453A`

These should be used subtly rather than aggressively.

### 5. Subtle Structure

Instead of heavy borders or strong separators, the interface should use very light grey dividers.

**Recommended:**
- Divider: `#E5E5EA`
- Card background: `#FFFFFF`

This keeps the layout structured while maintaining a calm visual tone.

### 6. Use Colour Sparingly

Most of the interface should consist of neutral tones:
- White
- Light grey
- Dark grey

Accent colours should only appear when an element is interactive or requires attention. This helps the interface feel quiet and non-distracting.

### 7. Reading Comfort

Where possible, reading sections (such as lecture content) can use a slightly warmer background tone to mimic the comfort of paper and reduce eye strain during long reading sessions.

**Example reading background:** `#FAFAF8`

### Recommended Base Palette

| Element | Colour |
|---------|--------|
| Background | `#F7F7F8` |
| Cards | `#FFFFFF` |
| Primary text | `#111111` |
| Secondary text | `#6B6B6B` |
| Accent | `#007AFF` |
| Divider | `#E5E5EA` |
| Correct | `#34C759` |
| Incorrect | `#FF453A` |

The colour system supports the core philosophy: **calm, focused, distraction-free learning**. The interface should feel visually quiet so that the user's attention stays on the content rather than the interface itself.

## Summary

The interface should feel:

- **Calm** - no visual noise or overwhelming options
- **Structured** - clear hierarchy and predictable patterns
- **Inevitable** - the next step is always obvious

The system guides the user through the learning process in the most effective way while minimising friction and decision-making.
