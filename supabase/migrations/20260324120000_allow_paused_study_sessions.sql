alter table public.study_sessions
  drop constraint if exists study_sessions_status_check;

alter table public.study_sessions
  add constraint study_sessions_status_check
  check (status in ('active', 'completed', 'abandoned', 'paused'));
