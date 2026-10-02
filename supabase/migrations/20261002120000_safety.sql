-- Leaderboard safety (added 2026-10-02): name filter, banned names, hidden scores,
-- plausibility checks against run length, and rate limits. Scores now need secs (run length).

alter table public.scores add column if not exists secs int check (secs between 0 and 86400);
alter table public.scores add column if not exists hidden boolean not null default false;
create index if not exists scores_name_time_idx on public.scores (lower(name), created_at desc);
create index if not exists scores_time_idx on public.scores (created_at desc);

-- Names blocked by hand with: python3 mod.py ban NAME. Nobody can read this from the site.
create table if not exists public.banned_names (name text primary key);
alter table public.banned_names enable row level security;

-- name_ok(): generated from namefilter.json by mod.py (python3 mod.py filter re-pushes it)
create or replace function public.name_ok(n text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  inside text[] := array['fuck', 'fuk', 'fck', 'shit', 'cunt', 'niga', 'niger', 'negro', 'bitch', 'whore', 'slut', 'nazi', 'hitler', 'penis', 'vagina', 'fag', 'porn', 'pusy', 'dildo', 'retard', 'jiz', 'twat', 'wank', 'bastard', 'hentai', 'trany', 'molest', 'rapist', 'ashole', 'dumbas', 'jackas']::text[];
  whole text[] := array['ass', 'arse', 'dick', 'dicks', 'cock', 'cocks', 'cum', 'sex', 'sexy', 'tit', 'tits', 'titty', 'boob', 'boobs', 'rape', 'raped', 'pedo', 'anal', 'kkk', 'kys', 'coon', 'spic', 'kike', 'chink', 'dyke', 'hoe', 'hoes', 'nude', 'nudes', 'xxx', 'piss', 'milf', 'thot']::text[];
  norm text := translate(lower(n), '013457@$!|', 'oieastasii');
  letters text := regexp_replace(norm, '[^a-z]', '', 'g');
  w text; c text;
begin
  foreach w in array inside loop
    if position(w in regexp_replace(letters, '(.)\1+', '\1', 'g')) > 0 then return false; end if;
  end loop;
  foreach c in array array_append(regexp_split_to_array(norm, '[^a-z]+'), letters) loop
    continue when c = '';
    foreach w in array whole loop
      if length(c) >= length(w)
         and regexp_replace(c, '(.)\1+', '\1', 'g') = regexp_replace(w, '(.)\1+', '\1', 'g') then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end $$;

create or replace function public.check_score() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.name_ok(new.name) or exists (select 1 from public.banned_names b where b.name = lower(new.name)) then
    raise exception 'name not allowed' using errcode = 'check_violation';
  end if;
  if new.secs is null then
    raise exception 'missing run length' using errcode = 'check_violation';
  end if;
  -- every corner takes at least about half a second even at top speed with turbo
  if new.turns > new.secs * 2 + 2 then
    raise exception 'score not possible for that run length' using errcode = 'check_violation';
  end if;
  -- fastest start is 110 mph, each turn adds at most 13 mph, and the cap is 350 mph
  if new.top_mph is not null and new.top_mph > least(350, 111 + 13 * new.turns) then
    raise exception 'speed not possible for that score' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.scores s where lower(s.name) = lower(new.name) and s.created_at > now() - interval '5 seconds')
     or (select count(*) from public.scores s where s.created_at > now() - interval '1 minute') >= 60 then
    raise exception 'too fast, slow down' using errcode = 'check_violation';
  end if;
  new.hidden := false;
  new.created_at := now();
  return new;
end $$;

drop trigger if exists check_score on public.scores;
create trigger check_score before insert on public.scores for each row execute function public.check_score();

drop policy if exists "anyone can read scores" on public.scores;
create policy "anyone can read scores" on public.scores
  for select to anon, authenticated using (not hidden);
