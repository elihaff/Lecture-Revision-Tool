-- Session log records for study sessions across review/custom/lecture modes

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  source_type text not null check (source_type in ('global', 'custom', 'lecture')),
  session_mode text not null check (session_mode in ('new', 'review')),
  lecture_id uuid references public.lectures(id) on delete set null,
  filters_json jsonb,
  again_count integer not null default 0,
  hard_count integer not null default 0,
  good_count integer not null default 0,
  easy_count integer not null default 0,
  cards_covered_count integer not null default 0,
  accuracy numeric(5,4) not null default 0,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_study_sessions_user_started
  on public.study_sessions (user_id, started_at desc);

create index if not exists idx_study_sessions_user_status
  on public.study_sessions (user_id, status);

alter table public.study_sessions enable row level security;

do $$ begin
  create policy "Users can view own study sessions"
    on public.study_sessions
    for select
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Users can insert own study sessions"
    on public.study_sessions
    for insert
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Users can update own study sessions"
    on public.study_sessions
    for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

create or replace function public.set_study_sessions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_study_sessions_updated_at on public.study_sessions;
create trigger trg_study_sessions_updated_at
before update on public.study_sessions
for each row execute function public.set_study_sessions_updated_at();
