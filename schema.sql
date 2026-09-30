-- Leaderboard for Turn Signal. Anyone with the site can read scores and add one;
-- nobody (without the service key) can edit or delete them.
create table if not exists public.scores (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 16),
  turns int not null check (turns between 1 and 400),
  ride text not null default 'roadster' check (char_length(ride) <= 16),
  created_at timestamptz not null default now()
);

create index if not exists scores_turns_idx on public.scores (turns desc);

alter table public.scores enable row level security;

drop policy if exists "anyone can read scores" on public.scores;
create policy "anyone can read scores" on public.scores
  for select to anon, authenticated using (true);

drop policy if exists "anyone can add a score" on public.scores;
create policy "anyone can add a score" on public.scores
  for insert to anon, authenticated with check (true);

-- Top speed leaderboard (added 2026-09-30)
alter table public.scores add column if not exists top_mph int check (top_mph between 1 and 400);
create index if not exists scores_mph_idx on public.scores (top_mph desc nulls last);

-- Character icons (added 2026-09-30)
alter table public.scores add column if not exists icon text check (char_length(icon) <= 16);
