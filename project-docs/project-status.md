# Project Status Snapshot

Last updated: March 25, 2026

## Stack

- Frontend: React 18 + Vite + Tailwind
- Backend: Supabase Auth + Postgres + Storage + Edge Functions
- Primary AI provider in edge functions: Anthropic Claude Sonnet 4

## Primary app surfaces

- Home wheel dashboard
- Module/submodule/lecture management
- Lecture workspace (upload slides / convert existing notes)
- Notes view and editing
- Flashcards view and editing
- Learn Mode
- Lecture review session
- Global review session
- Custom study session
- Session log
- Stats view
- Settings (exam date, account, scoped reset)

## Key data flows

1. Lecture content ingestion
- Slides uploaded to `lecture-pdfs` storage bucket
- `process-lecture` edge function generates structured notes and learning objectives
- Legacy notes conversion path available via `convert-legacy-notes`

2. Flashcard generation and sync
- Frontend converts notes to tagged text payload
- `generate-flashcards` edge function returns source-grounded cards
- Tags are suggested/validated against controlled taxonomy
- Frontend syncs cards into `flashcards` table while preserving SRS fields

3. Review + scheduling
- Card transitions use SRS V2 (`new`, `learning`, `review`, `relearning`)
- Review actions write to `flashcards` and `review_logs`
- Exam date can cap interval growth
- Lecture phase/progress is recomputed from notes + card state maturity

4. Session lifecycle
- Session state persists locally for resume
- Session summaries persist in `study_sessions` (`active`, `paused`, `completed`, `abandoned`)

## Important migrations already present

- Flashcard tagging fields and indexes
- Study sessions table + paused status support
- Structured card payload fields (`occlusion_data`, `interpretation_data`)
- Stats/review index optimization + `get_review_activity_days` RPC

## Current technical priorities

- Harden edge-function response and payload contracts
- Reduce duplicate fallback logic and legacy compatibility complexity
- Improve test coverage on notes/flashcard/review critical paths
- Keep docs and release/version metadata aligned with actual shipped behavior
