-- Optimisation pass: query/index coverage + lightweight stats aggregation RPC

create index if not exists idx_flashcards_user_state_due
  on public.flashcards (user_id, state, due_date);

create index if not exists idx_flashcards_lecture_state
  on public.flashcards (lecture_id, state);

create index if not exists idx_review_logs_user_reviewed_at
  on public.review_logs (user_id, reviewed_at desc);

-- Existing migrations already create a similar index for this query path,
-- but we keep this idempotent check to ensure coverage across environments.
create index if not exists idx_study_sessions_user_started_at
  on public.study_sessions (user_id, started_at desc);

create or replace function public.get_review_activity_days(
  p_since timestamptz default (now() - interval '365 days')
)
returns table(activity_day date)
language sql
stable
security definer
set search_path = public
as $$
  select distinct rl.reviewed_at::date as activity_day
  from public.review_logs rl
  where rl.user_id = auth.uid()
    and rl.reviewed_at >= p_since
  order by activity_day desc;
$$;

revoke all on function public.get_review_activity_days(timestamptz) from public;
grant execute on function public.get_review_activity_days(timestamptz) to authenticated;
grant execute on function public.get_review_activity_days(timestamptz) to service_role;
