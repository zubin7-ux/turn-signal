#!/usr/bin/env python3
"""Leaderboard moderation for Turn Signal, run from your Mac.

  python3 mod.py recent [N]       latest N scores (default 30), hidden ones marked
  python3 mod.py hide NAME|#ID    hide every score for a name (or one score by id)
  python3 mod.py unhide NAME|#ID  bring them back
  python3 mod.py ban NAME         hide a name's scores and block it from posting again
  python3 mod.py unban NAME
  python3 mod.py filter           push namefilter.json to the database after editing it
  python3 mod.py sql "QUERY"      run any SQL

Uses the Supabase CLI login stored in the macOS keychain, through the Management API
(direct Postgres connections time out on the school Wi-Fi).
"""
import base64
import json
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).parent
PROJECT = "qicjuryvwqjltuwksuoa"


def token():
    tok = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-w"],
                         capture_output=True, text=True).stdout.strip()
    if tok.startswith("go-keyring-base64:"):
        tok = base64.b64decode(tok.split(":", 1)[1]).decode()
    if not tok:
        sys.exit("mod: no Supabase CLI login in the keychain. Run: supabase login")
    return tok


def sql(query):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT}/database/query",
        data=json.dumps({"query": query}).encode(),
        headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json", "User-Agent": "turn-signal-mod"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=60).read() or b"[]")
    except urllib.error.HTTPError as e:
        sys.exit("mod: " + e.read().decode(errors="replace"))


def lit(s):
    return "'" + str(s).replace("'", "''") + "'"


def target(arg):
    """WHERE clause for a name or #id."""
    if arg.startswith("#") and arg[1:].isdigit():
        return f"id = {int(arg[1:])}"
    return f"lower(name) = lower({lit(arg)})"


def filter_sql():
    """name_ok(): the same rules as nameOk() in online.js, with the list from namefilter.json."""
    words = json.loads((ROOT / "namefilter.json").read_text())
    arr = lambda ws: "array[" + ", ".join(lit(w) for w in ws) + "]::text[]"
    return f"""create or replace function public.name_ok(n text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  inside text[] := {arr(words["inside"])};
  whole text[] := {arr(words["whole"])};
  norm text := translate(lower(n), '013457@$!|', 'oieastasii');
  letters text := regexp_replace(norm, '[^a-z]', '', 'g');
  w text; c text;
begin
  foreach w in array inside loop
    if position(w in regexp_replace(letters, '(.)\\1+', '\\1', 'g')) > 0 then return false; end if;
  end loop;
  foreach c in array array_append(regexp_split_to_array(norm, '[^a-z]+'), letters) loop
    continue when c = '';
    foreach w in array whole loop
      if length(c) >= length(w)
         and regexp_replace(c, '(.)\\1+', '\\1', 'g') = regexp_replace(w, '(.)\\1+', '\\1', 'g') then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end $$;"""


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "recent":
        n = int(args[0]) if args else 30
        rows = sql(f"select id, name, turns, top_mph, secs, mode, hidden, created_at from public.scores order by id desc limit {n}")
        for r in rows:
            flag = " HIDDEN" if r.get("hidden") else ""
            print(f"#{r['id']:<5} {r['name']:<17} {r['turns']:>4} turns {str(r['top_mph'] or '-'):>4} mph "
                  f"{str(r['secs'] if r['secs'] is not None else '-'):>5}s  {r['mode']:<10} {r['created_at'][:16]}{flag}")
    elif cmd in ("hide", "unhide") and args:
        rows = sql(f"update public.scores set hidden = {str(cmd == 'hide').lower()} where {target(args[0])} returning id")
        print(f"{cmd}: {len(rows)} score(s)")
    elif cmd == "ban" and args:
        sql(f"insert into public.banned_names (name) values (lower({lit(args[0])})) on conflict do nothing")
        rows = sql(f"update public.scores set hidden = true where {target(args[0])} returning id")
        print(f"banned {args[0]!r}, hid {len(rows)} score(s)")
    elif cmd == "unban" and args:
        sql(f"delete from public.banned_names where name = lower({lit(args[0])})")
        print(f"unbanned {args[0]!r} (their scores stay hidden until you unhide them)")
    elif cmd == "filter":
        sql(filter_sql())
        print("name filter updated in the database")
    elif cmd == "sql" and args:
        print(json.dumps(sql(args[0]), indent=2))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
