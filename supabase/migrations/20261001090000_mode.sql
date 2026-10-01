alter table public.scores add column if not exists mode text not null default 'classic' check (mode in ('classic', 'straight'));
create index if not exists scores_mode_idx on public.scores (mode);
