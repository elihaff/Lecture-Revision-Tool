# Current Milestone

Milestone 6: Native Review System + Reliability Hardening

Last updated: March 25, 2026

## Current state summary

Core end-to-end workflow is now live in the React app:

- Authentication and account settings
- Module/submodule/lecture hierarchy with drag-and-drop ordering
- Lecture workspace with two note-ingestion paths:
  - generate notes from slides
  - convert existing notes PDF
- Notes editing with image support and export/import
- Flashcard generation from notes and CSV import
- Learn Mode per lecture
- Lecture review, global review, and custom study sessions
- Session pause/resume persistence + study session log
- Stats dashboard and exam-date-aware scheduling behavior

## Recently completed

- Migrated major revision flows into modular React components
- Implemented SRS V2 scheduling flow with learning/relearning states
- Added structured flashcard payload support (`occlusion_data`, `interpretation_data`)
- Added semantic tagging model for flashcards (`content_tags`, `custom_user_tags`, AI suggestions)
- Added scoped reset-progress controls in settings
- Added review activity/day RPC + index optimization migration

## In progress

- Reliability hardening for edge function response parsing and payload consistency
- Further cleanup of legacy compatibility paths and duplicated fallback logic
- UX consistency and performance pass across review/edit modals and long sessions

## Known gaps / risks

- Some docs and changelog history lag behind current versioning/state
- Dist artifacts are currently tracked and frequently churn in local changes
- Some flows still rely on broad try/catch fallback behavior instead of strongly typed contracts

## Definition of done for this milestone

- Notes generation/conversion and flashcard generation are consistently reliable in production
- Session resume/pause behavior is stable across all review modes
- Data contracts between frontend and edge functions are explicit and validated
- Project docs and roadmap stay synchronized with implemented behavior

## Next milestone direction

Milestone 7: Product quality + operational maturity

- Tighten test coverage for high-risk review and note-conversion paths
- Reduce edge-function coupling and simplify fallback complexity
- Improve analytics quality and observability for learning outcomes
- Prepare cleaner release and deployment hygiene (docs + artifacts + version trail)
