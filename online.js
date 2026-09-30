  // ---- Multiplayer (public site): username leaderboard + live ghost cars over Supabase ----
  // Each run is its own road, so ghost cars only appear when two players share a seed; the live list always works.
  const SUPABASE_URL = '%%SUPABASE_URL%%', SUPABASE_KEY = '%%SUPABASE_KEY%%';
  const MY_KEY = Math.random().toString(36).slice(2, 12);
  let mp = { sb: null, chan: null, ready: false, board: [], boardState: 'loading', peers: new Map(), note: '' };
  let lastPresence = -1, lastLive = -1, lastState = '';

  const nameInput = $('playerName');
  const cleanName = v => String(v || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  function myName() { return cleanName(nameInput ? nameInput.value : ''); }
  if (nameInput) {
    nameInput.value = store.get('name', '');
    nameInput.addEventListener('input', () => { store.set('name', myName()); renderBoards(); });
  }

  function initOnline() {
    if (!window.supabase || SUPABASE_URL.startsWith('%%')) { mp.boardState = 'off'; renderBoards(); return; }
    try {
      mp.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    } catch (e) { mp.boardState = 'off'; renderBoards(); return; }
    loadBoard();
    setInterval(loadBoard, 20000);
    mp.chan = mp.sb.channel('lobby', { config: { broadcast: { self: false } } });
    mp.chan.on('broadcast', { event: 'pos' }, ({ payload }) => {
      if (!payload || typeof payload.k !== 'string' || payload.k === MY_KEY) return;
      mp.peers.set(payload.k, { ...payload, at: Date.now() });
    }).subscribe(status => { mp.ready = status === 'SUBSCRIBED'; });
  }
  initOnline();

  async function loadBoard() {
    if (!mp.sb) return;
    try {
      const { data, error } = await mp.sb.from('scores').select('name,turns,ride').order('turns', { ascending: false }).limit(300);
      if (error) throw error;
      const seen = new Set(), rows = [];
      for (const r of data || []) {
        const nm = cleanName(r.name), key = nm.toLowerCase();
        if (!nm || seen.has(key)) continue;
        seen.add(key); rows.push({ name: nm, turns: Math.max(0, Math.floor(Number(r.turns) || 0)), ride: r.ride });
        if (rows.length >= 25) break;
      }
      mp.board = rows; mp.boardState = 'ok';
    } catch (e) { if (mp.boardState !== 'ok') mp.boardState = 'off'; }
    renderBoards();
  }

  function livePeers() {
    const now = Date.now(), out = [];
    for (const [k, p] of mp.peers) {
      if (now - p.at > 3000) { mp.peers.delete(k); continue; }
      if (p.state === 'play') out.push(p);
    }
    return out;
  }

  function renderBoards() {
    const drivers = livePeers();
    const me = myName().toLowerCase();
    const liveNames = new Set(drivers.map(p => cleanName(p.name).toLowerCase()).filter(Boolean));
    for (const el of document.querySelectorAll('.board')) {
      const list = el.querySelector('.board-list'), sub = el.querySelector('.board-sub');
      const live = el.querySelector('.board-live'), note = el.querySelector('.board-note');
      live.textContent = drivers.length ? drivers.length + ' driving now' : '';
      live.hidden = !drivers.length;
      list.textContent = '';
      sub.textContent = mp.boardState === 'loading' ? 'Loading scores…'
        : mp.boardState !== 'ok' ? 'The leaderboard is offline right now. You can still play.'
        : !mp.board.length ? 'No scores yet. Finish a run to post the first one.'
        : 'Best run for each name.';
      mp.board.forEach((row, i) => {
        const li = document.createElement('li');
        const mine = me && row.name.toLowerCase() === me;
        if (mine) li.className = 'me';
        const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = String(i + 1);
        const who = document.createElement('span'); who.className = 'who';
        if (liveNames.has(row.name.toLowerCase())) { const dot = document.createElement('i'); dot.className = 'live-dot'; dot.title = 'Driving now'; who.append(dot); }
        who.append(document.createTextNode(row.name + (mine ? ' (you)' : '')));
        const rd = RIDES.find(r => r.id === row.ride);
        if (rd) { const sm = document.createElement('small'); sm.textContent = rd.name; who.append(sm); }
        const pts = document.createElement('span'); pts.className = 'pts'; pts.textContent = String(row.turns);
        li.append(rank, who, pts);
        list.append(li);
      });
      note.hidden = !mp.note;
      note.textContent = mp.note;
    }
    renderLive();
  }

  function renderLive() {
    const drivers = livePeers();
    const show = (state === 'play' || state === 'paused') && drivers.length > 0;
    ui.live.hidden = !show;
    if (!show) return;
    ui.liveList.textContent = '';
    drivers.sort((a, b) => (Number(b.turns) || 0) - (Number(a.turns) || 0)).slice(0, 5).forEach(p => {
      const li = document.createElement('li');
      const n = document.createElement('span'); n.textContent = cleanName(p.name) || 'Driver';
      const t = document.createElement('b'); t.textContent = String(Math.max(0, Math.floor(Number(p.turns) || 0)));
      li.append(n, t);
      ui.liveList.append(li);
    });
  }

  // Positions go out about 3 times a second; other pages fill the gaps by extrapolating.
  function sendPresence() {
    if (!mp.chan || !mp.ready || !segs) return;
    const changed = state !== lastState;
    if (!changed && (state !== 'play' || (lastPresence >= 0 && time - lastPresence < 0.33))) return;
    lastPresence = time; lastState = state;
    mp.chan.send({ type: 'broadcast', event: 'pos', payload: {
      k: MY_KEY, name: myName(), state, track: TRACK, n: segs[segIdx].n, s: Math.round(s), lat: Math.round(lat),
      v: Math.round(state === 'play' ? speed : 0), ride: ride.id, turns } }).catch(() => {});
  }

  function postScore() {
    if (turns <= 0) return;
    const name = myName();
    if (!name) { mp.note = 'Type a name on the start screen to post your scores.'; renderBoards(); return; }
    if (!mp.sb) return;
    const key = 'posted.' + name.toLowerCase();
    if (turns <= store.get(key, 0)) return;
    mp.sb.from('scores').insert({ name, turns, ride: ride.id }).then(({ error }) => {
      if (error) mp.note = 'Your score could not be posted. Check your connection and try another run.';
      else { mp.note = ''; store.set(key, turns); }
      loadBoard();
    });
  }

  function ghostItems() {
    for (const q of livePeers()) {
      if (typeof q.n !== 'number' || q.track !== TRACK) continue;
      const g = segs.find(x => x.n === q.n);
      if (!g) continue;
      const ahead = (Number(q.v) || 0) * Math.min(0.6, Math.max(0, (Date.now() - q.at) / 1000));
      const sEst = Math.min(g.len + W - 24, (Number(q.s) || 0) + ahead);
      const latv = Math.max(-W / 2 + 10, Math.min(W / 2 - 10, Number(q.lat) || 0));
      const P = posOf(g, sEst, latv);
      const p = proj(P.x, P.y, 0);
      if (!inView(p, 80)) continue;
      const id = RIDES.some(r => r.id === q.ride) ? q.ride : 'roadster';
      const fly = BIOMES[g.biome].fly ? 1 : 0;
      const label = (cleanName(q.name) || 'Driver') + ' · ' + Math.max(0, Math.floor(Number(q.turns) || 0));
      add(p.z, () => {
        renderVehicle(ctx, id, fly, time, false, h => place(ctx, P.x, P.y, h, g.h * Math.PI / 2), fly * 55, stepFor(p.k) * 1.2);
        const t = proj(P.x, P.y, fly * 55 + 46);
        ctx.font = '700 12px Overpass, system-ui, sans-serif';
        const w = ctx.measureText(label).width + 14;
        ctx.fillStyle = 'rgba(15,20,30,0.75)'; rr(ctx, t.sx - w / 2, t.sy - 19, w, 19, 9.5); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.fillText(label, t.sx, t.sy - 5); ctx.textAlign = 'start';
      }, 0.55);
    }
  }

