#!/usr/bin/env python3
"""Builds the public site (index.html) from the Claude artifact version (game.html).

game.html is the source of truth. The public build swaps the Claude-only
multiplayer code for online.js (Supabase), adds a username field, and wraps
the page in a full HTML document.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent
SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"


def swap(text, old, new):
    if text.count(old) != 1:
        sys.exit(f"build: expected exactly one match for: {old[:70]!r}")
    return text.replace(old, new)


def main():
    game = (ROOT / "game.html").read_text()
    online = (ROOT / "online.js").read_text()
    config = json.loads((ROOT / "config.json").read_text())

    start = game.index("  // ---- Multiplayer: shared leaderboard")
    end = game.index("  // ---- Drawing helpers ----")
    online = online.replace("%%SUPABASE_URL%%", config["url"]).replace("%%SUPABASE_KEY%%", config["anonKey"])
    page = game[:start] + online + game[end:]

    page = swap(page, '      <button class="go" id="startBtn"', '''      <label class="name-field" for="playerName"><span>YOUR NAME</span>
        <input id="playerName" type="text" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Shown on the leaderboard">
      </label>
      <button class="go" id="startBtn"''')
    page = swap(page, "  window.addEventListener('keydown', e => {\n    if (state === 'revive')",
                "  window.addEventListener('keydown', e => {\n"
                "    if (e.target && e.target.tagName === 'INPUT') {\n"
                "      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); if (state === 'menu') startGame(); }\n"
                "      return;\n"
                "    }\n"
                "    if (state === 'revive')")
    page = swap(page, "  @media (max-width: 440px) {", """  .name-field { display: grid; gap: 7px; }
  .name-field span { font-size: 12px; font-weight: 800; letter-spacing: .16em; }
  .name-field input {
    font: 700 16px/1.2 "Overpass", system-ui, sans-serif; color: var(--ink);
    background: var(--sign-ink); border: 0; border-radius: 8px;
    padding: 11px 12px 9px; width: 100%; box-sizing: border-box;
  }
  .name-field input:focus-visible { outline: 3px solid var(--caution); outline-offset: 2px; }

  @media (max-width: 440px) {""")

    head = (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n"
        "<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        "<meta name=\"description\" content=\"A chase-cam driving game. Take every corner inside the box, dodge obstacles, and climb the class leaderboard.\">\n"
        "<style>*,*::before,*::after{box-sizing:border-box}[hidden]{display:none!important}</style>\n"
        f"<script src=\"{SUPABASE_JS}\"></script>\n"
    )
    # Move the page's own <title>/<link>/<style> into <head>, the rest into <body>
    body_start = page.index('<canvas id="c"')
    out = head + page[:body_start] + "</head>\n<body>\n" + page[body_start:] + "\n</body>\n</html>\n"
    # Guard: every function in game.html must survive the swap, apart from the
    # Claude-only multiplayer helpers that online.js replaces.
    replaced = {"whenClaude", "liveDrivers"}
    lost = [n for n in re.findall(r"function (\w+)", game) if n not in replaced and f"function {n}" not in out]
    if lost:
        sys.exit("build: these functions were dropped by the swap: " + ", ".join(sorted(set(lost))))
    (ROOT / "index.html").write_text(out)
    print(f"built index.html ({len(out) // 1024} KB)")


if __name__ == "__main__":
    main()
