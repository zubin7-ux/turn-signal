alter table public.scores add column if not exists top_mph int check (top_mph between 1 and 400);
create index if not exists scores_mph_idx on public.scores (top_mph desc nulls last);
