# Current Milestone

Milestone 2: Lecture workspace + AI notes pipeline

Last updated: March 4, 2026

## Completed in this milestone

- Supabase authentication is implemented
- Module and lecture structure is implemented
- Submodules and drag-and-drop ordering are implemented
- Lecture workspace UI is implemented
- PDF upload flow is implemented
- AI notes generation and save flow is implemented
- Existing notes conversion flow is implemented
- Notes editing, save, and PDF export/import are implemented

## In progress

- Stabilise edge function wiring and request payload consistency
- Finalise migration from legacy `index.html.old` flow into modular React components
- Tighten end-to-end reliability for notes generation/conversion paths

## Definition of done

- Upload slides and generate notes works reliably end-to-end
- Convert existing notes works reliably end-to-end
- Notes can be edited and saved without regressions
- Notes export/import roundtrip is reliable
- No endpoint mismatches between frontend and deployed edge functions

## Next milestone (Milestone 3)

- Native flashcard review system in the React app
- Move remaining flashcard workflow out of legacy implementation
