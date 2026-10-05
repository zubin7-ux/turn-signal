-- Revives board (added 2026-10-02): runs that used a revive are stored with how many,
-- and the site shows them only on the Revives board. Older scores count as no revives.
alter table public.scores add column if not exists revives int not null default 0 check (revives between 0 and 20);
create index if not exists scores_revives_idx on public.scores (revives) where revives > 0;
