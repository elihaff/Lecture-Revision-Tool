# Learning Workflow

Last updated: March 25, 2026

## Actual in-app pipeline (current)

Each lecture currently follows this practical flow:

1. Create module/submodule/lecture structure
2. Add lecture content using one of:
   - slides upload -> AI notes generation
   - existing notes PDF conversion
3. Review/edit notes
4. Generate flashcards from notes (or import via CSV)
5. Study using one or more modes:
   - Learn Mode (lecture-scoped, first-pass understanding)
   - Lecture review session
   - Global due-card review
   - Custom filtered study session
6. Continue spaced repetition over time

## Important behavior notes

- Learn Mode exists and updates lecture learning progress.
- Flashcard editing/review flows are available in-app and can be entered independently of Learn Mode.
- Session state can be paused/resumed (local persistence + `study_sessions` log rows).
- Exam date can be set to cap interval growth in review scheduling.

## Lecture progress model (current)

Lecture phase/progress is recomputed from notes/card state:

- `not_started`: notes not generated
- `learn`: notes generated, no flashcard progression yet
- `memorise`: flashcards exist and NEW cards remain
- `maintain`: no NEW cards remain (all seen/graduated)

Progress trends toward 100% as cards mature in long-interval review states.
