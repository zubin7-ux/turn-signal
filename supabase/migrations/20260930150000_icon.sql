alter table public.scores add column if not exists icon text check (char_length(icon) <= 16);
