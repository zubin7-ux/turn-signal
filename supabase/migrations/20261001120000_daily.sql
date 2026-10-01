alter table public.scores drop constraint if exists scores_mode_check;
alter table public.scores add constraint scores_mode_check check (mode ~ '^(classic|straight|d[0-9]{8})$');
