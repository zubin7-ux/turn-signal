  // ---- Leaderboard (public site): usernames and scores over Supabase ----
  // No live channel: ghost cars and the "driving now" list were dropped because their cost grew with players squared.
  const SUPABASE_URL = '%%SUPABASE_URL%%', SUPABASE_KEY = '%%SUPABASE_KEY%%';
  let mp = { sb: null, board: [], boardSpeed: [], boardToday: [], boardState: 'loading', note: '' };
  let lastLive = -1;

  const nameInput = $('playerName');
  const cleanName = v => String(v || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  function myName() { return cleanName(nameInput ? nameInput.value : ''); }

  // Name filter. The same word list and rules run in the database (mod.py filter), so this is just early feedback.
  const NAME_FILTER = %%NAME_FILTER%%;
  const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '|': 'i' };
  const squash = w => w.replace(/(.)\1+/g, '$1');
  function nameOk(name) {
    const norm = String(name).toLowerCase().replace(/[013457@$!|]/g, c => LEET[c]);
    const letters = norm.replace(/[^a-z]/g, '');
    if (NAME_FILTER.inside.some(w => squash(letters).includes(w))) return false;
    const words = norm.split(/[^a-z]+/).filter(Boolean).concat(letters);
    return !words.some(c => NAME_FILTER.whole.some(w => c.length >= w.length && squash(c) === squash(w)));
  }
  const BAD_NAME_NOTE = 'Pick a different name to post scores. That one is not allowed on the leaderboard.';
  if (nameInput) {
    nameInput.value = store.get('name', '');
    const check = () => { const bad = myName() && !nameOk(myName()); nameInput.setCustomValidity(bad ? BAD_NAME_NOTE : ''); if (bad) mp.note = BAD_NAME_NOTE; else if (mp.note === BAD_NAME_NOTE) mp.note = ''; };
    nameInput.addEventListener('input', () => { store.set('name', myName()); check(); renderBoards(); });
    check();
  }

  function initOnline() {
    if (!window.supabase || SUPABASE_URL.startsWith('%%')) { mp.boardState = 'off'; renderBoards(); return; }
    try {
      mp.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    } catch (e) { mp.boardState = 'off'; renderBoards(); return; }
    loadBoard();
    setInterval(loadBoard, 20000);
  }
  initOnline();

  // Best row per name, for one column
  function bestPerName(data, field) {
    const seen = new Set(), rows = [];
    for (const r of data || []) {
      const nm = cleanName(r.name), key = nm.toLowerCase(), v = Math.max(0, Math.floor(Number(r[field]) || 0));
      if (!nm || !v || seen.has(key) || !nameOk(nm)) continue;
      seen.add(key); rows.push({ name: nm, value: v, ride: r.ride, icon: r.icon });
      if (rows.length >= 25) break;
    }
    return rows;
  }
  async function loadBoard() {
    if (!mp.sb) return;
    try {
      const [byTurns, bySpeed, byToday] = await Promise.all([
        mp.sb.from('scores').select('name,turns,ride,icon').eq('mode', 'classic').order('turns', { ascending: false }).limit(300),
        mp.sb.from('scores').select('name,top_mph,ride,icon').eq('mode', 'straight').not('top_mph', 'is', null).order('top_mph', { ascending: false }).limit(300),
        mp.sb.from('scores').select('name,turns,ride,icon').eq('mode', 'd' + todayKey()).order('turns', { ascending: false }).limit(300)
      ]);
      if (byTurns.error) throw byTurns.error;
      mp.board = bestPerName(byTurns.data, 'turns');
      mp.boardSpeed = bySpeed.error ? [] : bestPerName(bySpeed.data, 'top_mph');
      mp.boardToday = byToday.error ? [] : bestPerName(byToday.data, 'turns');
      mp.boardState = 'ok';
    } catch (e) { if (mp.boardState !== 'ok') mp.boardState = 'off'; }
    renderBoards();
  }

  function renderBoards() {
    const rows = boardMode === 'speed' ? mp.boardSpeed : boardMode === 'today' ? mp.boardToday : mp.board;
    const me = myName().toLowerCase();
    for (const el of document.querySelectorAll('.board')) {
      const list = el.querySelector('.board-list'), sub = el.querySelector('.board-sub');
      const note = el.querySelector('.board-note');
      list.textContent = '';
      sub.textContent = mp.boardState === 'loading' ? 'Loading scores…'
        : mp.boardState !== 'ok' ? 'The leaderboard is offline right now. You can still play.'
        : !rows.length ? 'No scores yet. Finish a run to post the first one.'
        : boardMode === 'speed' ? 'Fastest Straight-mode speed for each name.' : boardMode === 'today' ? "Today's daily challenge. Resets at midnight." : 'Most Classic-mode turns for each name.';
      rows.forEach((row, i) => {
        const li = document.createElement('li');
        const mine = me && row.name.toLowerCase() === me;
        if (mine) li.className = 'me';
        const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = String(i + 1);
        const who = document.createElement('span'); who.className = 'who';
        who.append(iconCanvas(ICONS.some(x => x.id === row.icon) ? row.icon : 'smile', 18));
        who.append(document.createTextNode(row.name + (mine ? ' (you)' : '')));
        const rd = RIDES.find(r => r.id === row.ride);
        if (rd) { const sm = document.createElement('small'); sm.textContent = rd.name; who.append(sm); }
        const pts = document.createElement('span'); pts.className = 'pts'; pts.textContent = String(row.value);
        if (boardMode === 'speed') { const u = document.createElement('small'); u.textContent = 'mph'; pts.append(u); }
        li.append(rank, who, pts);
        list.append(li);
      });
      note.hidden = !mp.note;
      note.textContent = mp.note;
    }
    renderLive();
  }

  // the game loop still calls these; with no live channel there is nothing to show or send
  function renderLive() { ui.live.hidden = true; }
  function sendPresence() {}

  function postScore() {
    if (turns <= 0) return;
    const name = myName();
    if (!name) { mp.note = 'Type a name on the start screen to post your scores.'; renderBoards(); return; }
    if (!nameOk(name)) { mp.note = BAD_NAME_NOTE; renderBoards(); return; }
    if (!mp.sb) return;
    const mph = toMph(topSpeed);
    // Classic posts when your turns improve, Straight when your top speed improves
    const key = (straight() ? 'postedS.' : daily() ? 'postedD' + todayKey() + '.' : 'posted.') + name.toLowerCase(), val = straight() ? mph : turns;
    if (val <= store.get(key, 0)) return;
    mp.sb.from('scores').insert({ name, turns, ride: ride.id, top_mph: mph, secs: Math.round(runSecs), icon: iconId, mode: daily() ? 'd' + todayKey() : gameMode }).then(({ error }) => {
      if (error) mp.note = /name/i.test(error.message || '') ? BAD_NAME_NOTE
        : /too fast|slow down/i.test(error.message || '') ? 'Scores are coming in too fast. Your next run will post.'
        : 'Your score could not be posted. Check your connection and try another run.';
      else { mp.note = ''; store.set(key, Math.max(val, store.get(key, 0))); }
      loadBoard();
    });
  }
