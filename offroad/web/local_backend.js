'use strict';
/* โหมดไฟล์เดียว: แทนที่เซิร์ฟเวอร์ Python ด้วย "แบ็กเอนด์ในเบราว์เซอร์"
 * ข้อมูลทั้งหมดเก็บเป็น JSON ก้อนเดียวใน localStorage (ตรรกะพอร์ตมาจาก offroad/calc.py, services.py, server.py)
 * ข้อมูลตั้งต้น window.OFFROAD_SEED ถูกสร้างจาก offroad/seed.py ตอน build (scripts/build_single_html.py) */
(() => {
  window.OFFROAD_LOCAL = true;
  document.body.classList.add('local');
  const KEY = 'offroad.v1';
  let db, persistOK = true;

  // ───────────── storage ─────────────
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); persistOK = true; } catch { persistOK = false; }
    status();
  }
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) { db = JSON.parse(raw); return; } } catch { persistOK = false; }
    db = JSON.parse(JSON.stringify(window.OFFROAD_SEED));
    persist();
  }
  load();
  window.addEventListener('storage', e => { if (e.key === KEY && e.newValue) db = JSON.parse(e.newValue); });  // แท็บอื่นแก้ไข

  const nid = t => (db.next[t] = (db.next[t] || 0) + 1);
  const nowIso = () => new Date().toISOString();
  const err = (code) => { const e = new Error(code); throw e; };
  const clone = o => JSON.parse(JSON.stringify(o));
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isoMin = d => d ? `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}` : null;
  const setting = (k, def) => (db.settings[k] ?? def);

  // ───────────── validation (เทียบเท่า CHECK ใน schema.sql) ─────────────
  const ENUM = {
    category: ['water', 'food', 'gas', 'fuel'], kind_dev: ['phone', 'tablet', 'laptop', 'pc'],
    power_state: ['on', 'off', 'charging', 'standby'], actual_state: ['on', 'off'], carrier: ['AIS', 'True'],
    condition: ['sunny', 'partly', 'cloudy', 'rain', 'storm'], kind_sched: ['sim_power', 'hotspot'],
    kind_ev: ['water_gate', 'water_indoor', 'breaker', 'solar', 'power', 'supply', 'health', 'comms', 'note'],
  };
  const RANGE = { soc_pct: [0, 100], reserve_pct: [0, 100], inverter_eff: [0.3, 1], solar_derate: [0, 1], battery_pct: [0, 100],
    battery_health_pct: [0, 100], hours_per_day: [0, 24], qty_initial: [0, 1e12], qty_remaining: [0, 1e12], daily_use: [0, 1e12],
    watts: [0, 1e12], solar_peak_w: [0, 1e12], peak_sun_hours: [0, 24], capacity_wh: [1e-9, 1e12] };
  const TIME = /^[0-2]\d:[0-5]\d$/, DAYS = /^[01]{7}$/;

  // spec: field -> 'str' | 'str?' | 'float' | 'int?' | 'bool' | ['enum', รายการค่าที่ยอมรับ]
  function P(body, spec) {
    const out = {};
    for (const [k, t] of Object.entries(spec)) {
      if (!(k in body)) continue;
      let v = body[k];
      if (t === 'str') v = String(v ?? '').trim();
      else if (t === 'str?') v = (v === null || v === '') ? null : String(v).trim();
      else if (t === 'bool') v = (v === true || v === 1 || v === '1' || v === 'true') ? 1 : 0;
      else if (t === 'float' || t === 'int?') {
        if (t === 'int?' && (v === null || v === '')) v = null;
        else { v = Number(v); if (!Number.isFinite(v)) err('bad_number'); if (t === 'int?') v = Math.trunc(v); }
      } else if (Array.isArray(t) && !t[1].includes(v)) err('constraint_failed');
      if (RANGE[k] && v !== null && (v < RANGE[k][0] || v > RANGE[k][1])) err('constraint_failed');
      if ((k === 'start_hhmm' || k === 'end_hhmm') && !TIME.test(v)) err('constraint_failed');
      if (k === 'days' && !DAYS.test(v)) err('constraint_failed');
      out[k] = v;
    }
    return out;
  }
  const SPEC = {
    supply: { category: ['enum', ENUM.category], name: 'str', unit: 'str', qty_initial: 'float', qty_remaining: 'float', daily_use: 'float', note: 'str?' },
    station: { name: 'str', capacity_wh: 'float', soc_pct: 'float', reserve_pct: 'float', inverter_eff: 'float', solar_peak_w: 'float', solar_derate: 'float', peak_sun_hours: 'float' },
    load: { name: 'str', watts: 'float', hours_per_day: 'float', enabled: 'bool', note: 'str?' },
    device: { name: 'str', kind: ['enum', ENUM.kind_dev], model: 'str?', role: 'str?', battery_pct: 'int?', battery_health_pct: 'int?', power_state: ['enum', ENUM.power_state], note: 'str?' },
    sim: { carrier: ['enum', ENUM.carrier], label: 'str', msisdn: 'str?', device_id: 'int?', actual_state: ['enum', ENUM.actual_state], expires_on: 'str?', note: 'str?' },
    sched: { kind: ['enum', ENUM.kind_sched], sim_id: 'int?', device_id: 'int?', start_hhmm: 'str', end_hhmm: 'str', days: 'str', enabled: 'bool' },
  };
  const findIn = (arr, id) => arr.find(x => x.id === id) || err('not_found');
  const del = (arr, id) => { const i = arr.findIndex(x => x.id === id); if (i < 0) err('not_found'); arr.splice(i, 1); return { ok: true }; };
  function mustRows(vals, req) { for (const k of req) if (vals[k] == null || vals[k] === '') err(`missing_${k}`); }

  // ───────────── calc (พอร์ตจาก calc.py) ─────────────
  const FACTOR = { sunny: 1.0, partly: 0.6, cloudy: 0.3, rain: 0.15, storm: 0.05 };

  function summarizeSupplies(rows, warn, crit) {
    const cats = {};
    for (const r of rows) {
      const c = cats[r.category] || (cats[r.category] = { category: r.category, items: [], days: null });
      const it = { ...r, days: r.daily_use > 0 ? r.qty_remaining / r.daily_use : null,
        pct: r.qty_initial > 0 ? Math.min(100, 100 * r.qty_remaining / r.qty_initial) : null };
      c.items.push(it);
      if (it.days != null) c.days = (c.days || 0) + it.days;
    }
    return Object.values(cats).map(c => ({ ...c, status: c.days == null ? 'unknown' : c.days < crit ? 'crit' : c.days < warn ? 'warn' : 'ok' }));
  }
  const solarWh = (st, cond) => st.solar_peak_w * st.solar_derate * st.peak_sun_hours * (FACTOR[cond] ?? FACTOR.cloudy);
  const dailyLoad = loads => loads.reduce((a, l) => a + (l.enabled ? l.watts * l.hours_per_day : 0), 0);

  function simulatePower(st, loads, forecast, today, def, horizon = 14) {
    const cap = st.capacity_wh, reserve = cap * st.reserve_pct / 100, stored = cap * st.soc_pct / 100;
    const load = dailyLoad(loads), burn = load / st.inverter_eff;
    let energy = stored, remaining = null; const days = [];
    for (let i = 0; i < horizon; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i), day = ymd(d);
      const cond = forecast[day] || def, sol = solarWh(st, cond), start = energy;
      energy = Math.min(cap, energy + sol - burn);
      days.push({ day, condition: cond, solar_wh: Math.round(sol), burn_wh: Math.round(burn), end_wh: Math.round(Math.max(energy, 0)),
        end_pct: Math.round(Math.max(energy, 0) / cap * 1000) / 10 });
      if (remaining === null && energy <= reserve) {
        const net = sol - burn, frac = (net < 0 && start > reserve) ? (start - reserve) / -net : 0;
        remaining = i + Math.max(0, Math.min(1, frac));
        energy = Math.max(energy, 0);
      }
    }
    return { stored_wh: Math.round(stored), reserve_wh: Math.round(reserve), load_wh_day: Math.round(load), burn_wh_day: Math.round(burn),
      days, days_remaining: remaining, sustainable: remaining === null };
  }

  const mins = s => { const [h, m] = s.split(':'); return +h * 60 + +m; };
  function windowState(windows, now = new Date()) {
    const ws = windows.filter(w => w.enabled), spans = [];
    for (let off = -1; off < 8; off++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off), wd = (day.getDay() + 6) % 7;   // จันทร์ = 0
      for (const w of ws) {
        if (w.days[wd] !== '1') continue;
        const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, mins(w.start_hhmm));
        let e = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, mins(w.end_hhmm));
        if (e <= s) e = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1, e.getHours(), e.getMinutes());
        spans.push([s, e]);
      }
    }
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [s, e] of spans) {
      if (merged.length && s <= merged[merged.length - 1][1]) { const m = merged[merged.length - 1]; if (e > m[1]) m[1] = e; }
      else merged.push([s, e]);
    }
    for (const [s, e] of merged) if (s <= now && now < e) return { active: true, next_change: e, has_schedule: true };
    const future = merged.map(m => m[0]).filter(s => s > now);
    return { active: false, next_change: future.length ? future[0] : null, has_schedule: ws.length > 0 };
  }

  // ───────────── services (พอร์ตจาก services.py) ─────────────
  const CAT_ORDER = { water: 0, food: 1, gas: 2, fuel: 3 };
  function suppliesOverview() {
    const rows = clone(db.supplies).sort((a, b) => CAT_ORDER[a.category] - CAT_ORDER[b.category] || a.id - b.id);
    return summarizeSupplies(rows, +setting('warn_days', 7), +setting('crit_days', 3));
  }
  function powerOverview(horizon = 14) {
    const today = new Date(), todayS = ymd(today);
    const forecast = {};
    for (const [d, c] of Object.entries(db.forecast)) if (d >= todayS) forecast[d] = c;
    const def = setting('solar_default_condition', 'partly');
    const out = simulatePower(db.station, db.loads, forecast, today, def, horizon);
    return { ...out, station: clone(db.station), loads: clone(db.loads), default_condition: def, forecast_days: forecast };
  }
  function fleetOverview() {
    const devices = clone(db.devices).sort((a, b) => a.id - b.id);
    for (const d of devices) d.sims = db.sims.filter(s => s.device_id === d.id).map(s => s.label);
    const by = {}; for (const d of devices) by[d.kind] = (by[d.kind] || 0) + 1;
    return { devices, total: devices.length, by_kind: by,
      low_battery: devices.filter(d => d.battery_pct != null && d.battery_pct < 30 && d.power_state !== 'charging'),
      powered_on: devices.filter(d => d.power_state === 'on' || d.power_state === 'charging').length };
  }
  function simsOverview(now = new Date()) {
    const sims = clone(db.sims).sort((a, b) => a.id - b.id);
    const scheds = clone(db.schedules).sort((a, b) => a.start_hhmm.localeCompare(b.start_hhmm) || a.id - b.id);
    for (const s of sims) {
      const ws = scheds.filter(w => w.kind === 'sim_power' && w.sim_id === s.id), st = windowState(ws, now);
      s.device_name = db.devices.find(d => d.id === s.device_id)?.name ?? null;
      Object.assign(s, { schedule_count: ws.length, scheduled_on: st.active, next_change: isoMin(st.next_change), has_schedule: st.has_schedule,
        mismatch: st.has_schedule && st.active !== (s.actual_state === 'on') });
    }
    const hotspots = [];
    for (const dev of db.devices) {
      const ws = scheds.filter(w => w.kind === 'hotspot' && w.device_id === dev.id);
      if (ws.length) { const st = windowState(ws, now); hotspots.push({ device_id: dev.id, device_name: dev.name, active: st.active, next_change: isoMin(st.next_change) }); }
    }
    return { sims, hotspots, schedules: scheds };
  }
  function checklistsOverview() {
    const phases = clone(db.phases).sort((a, b) => a.level - b.level);
    for (const p of phases) {
      p.items = db.items.filter(i => i.level === p.level).sort((a, b) => a.seq - b.seq || a.id - b.id).map(clone);
      p.done = p.items.filter(i => i.done).length; p.total = p.items.length;
    }
    return { active: +setting('active_phase', 1), phases };
  }
  const sortedEvents = () => [...db.events].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : b.id - a.id));
  const latestEvent = kind => { const e = sortedEvents().find(x => x.kind === kind && x.value != null); return e ? { ts: e.ts, value: e.value, unit: e.unit, text: e.text } : null; };

  function dashboard() {
    const chk = checklistsOverview(), active = chk.phases.find(p => p.level === chk.active), power = powerOverview(7);
    const fleet = fleetOverview(), so = simsOverview();
    const nexts = so.sims.map(s => s.next_change).filter(Boolean).sort();
    return {
      now: new Date().toISOString(),
      phase: { level: active.level, name: active.name, flag: active.flag, summary: active.summary, done: active.done, total: active.total },
      supplies: suppliesOverview(),
      power: { stored_wh: power.stored_wh, load_wh_day: power.load_wh_day, burn_wh_day: power.burn_wh_day, days: power.days,
        days_remaining: power.days_remaining, sustainable: power.sustainable, soc_pct: power.station.soc_pct, capacity_wh: power.station.capacity_wh },
      fleet: { total: fleet.total, by_kind: fleet.by_kind, low_battery: fleet.low_battery, powered_on: fleet.powered_on },
      sims: { on_now: so.sims.filter(s => s.scheduled_on).map(s => s.label), actual_on: so.sims.filter(s => s.actual_state === 'on').map(s => s.label),
        mismatch: so.sims.filter(s => s.mismatch).map(s => s.label), next_change: nexts[0] || null, hotspots: so.hotspots },
      water: { gate: latestEvent('water_gate'), indoor: latestEvent('water_indoor') },
      events: sortedEvents().slice(0, 8).map(clone),
    };
  }

  // ───────────── knowledge base ─────────────
  const MO = '\x02', MC = '\x03';
  const kbMeta = d => ({ id: d.id, path: d.path, title: d.title, kind: d.kind, category: d.category, size: (d.content || '').length });
  function kbTitle(content, path) { const m = /^#\s+(.+)$/m.exec(content); return m ? m[1].trim() : path.split('/').pop().replace(/\.[^.]+$/, '').replace(/_/g, ' '); }
  function kbList() { return db.kb.map(kbMeta).sort((a, b) => a.category.localeCompare(b.category, 'th') || a.title.localeCompare(b.title, 'th')); }
  function kbSearch(q) {
    const terms = q.trim().split(/\s+/).filter(Boolean).map(t => t.toLowerCase());
    if (!terms.length) return [];
    const out = [];
    for (const d of db.kb) {
      const text = d.kind === 'html' ? d.content.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ') : d.content;
      const hay = (d.title + '\n' + text).toLowerCase();
      if (!terms.every(t => hay.includes(t))) continue;
      const lower = text.toLowerCase(), pos = Math.min(...terms.map(t => lower.indexOf(t)).filter(p => p >= 0), Infinity);
      let snip = '';
      if (Number.isFinite(pos)) {
        snip = text.slice(Math.max(0, pos - 60), pos + 120).replace(/\s+/g, ' ');
        for (const t of terms) snip = snip.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => MO + m + MC);
        snip = (pos > 60 ? '…' : '') + snip + '…';
      }
      out.push({ ...kbMeta(d), snip });
      if (out.length >= 30) break;
    }
    return out;
  }

  // ───────────── router (พอร์ตจาก server.py) ─────────────
  const R = [];
  const route = (m, p, fn) => R.push([m, new RegExp('^' + p + '$'), fn]);
  const ID = m => +m[1];

  route('GET', '/api/meta', () => ({ now: new Date().toISOString(), fts_tokenizer: 'js', lan_urls: [],
    note: 'โหมดไฟล์เดียว: ข้อมูลถูกเก็บไว้ในเบราว์เซอร์เครื่องนี้ (localStorage) ไม่ส่งออกไปไหน — ใช้ปุ่ม “สำรองข้อมูล” ที่เมนูซ้ายเป็นระยะ เพราะการล้างข้อมูลเบราว์เซอร์จะลบข้อมูลนี้' }));
  route('GET', '/api/dashboard', () => dashboard());

  route('GET', '/api/supplies', () => suppliesOverview());
  route('POST', '/api/supplies', (m, q, b) => {
    b = { ...b }; if (!('qty_remaining' in b)) b.qty_remaining = b.qty_initial ?? 0;
    const v = P(b, SPEC.supply); mustRows(v, ['name', 'category', 'unit']);
    const row = { id: nid('supplies'), qty_initial: 0, qty_remaining: 0, daily_use: 0, note: null, ...v, updated_at: nowIso() };
    db.supplies.push(row); return { id: row.id };
  });
  route('PUT', '/api/supplies/(\\d+)', (m, q, b) => { const v = P(b, SPEC.supply); if (!Object.keys(v).length) err('no_fields'); Object.assign(findIn(db.supplies, ID(m)), v, { updated_at: nowIso() }); return { ok: true }; });
  route('DELETE', '/api/supplies/(\\d+)', m => del(db.supplies, ID(m)));
  route('POST', '/api/supplies/(\\d+)/adjust', (m, q, b) => {
    const s = findIn(db.supplies, ID(m)), delta = Number(b.delta);
    if (!Number.isFinite(delta)) err('bad_number');
    const nv = Math.max(0, s.qty_remaining + delta);
    db.supply_log.push({ id: nid('supply_log'), supply_id: s.id, ts: nowIso(), delta: nv - s.qty_remaining, note: String(b.note || '').slice(0, 200) });
    s.qty_remaining = nv; s.updated_at = nowIso(); return { qty_remaining: nv };
  });

  route('GET', '/api/power', () => powerOverview());
  route('PUT', '/api/power/station', (m, q, b) => {
    const v = P(b, SPEC.station);
    if ('default_condition' in b) { if (!ENUM.condition.includes(b.default_condition)) err('bad_condition'); db.settings.solar_default_condition = b.default_condition; }
    if (Object.keys(v).length) {
      Object.assign(db.station, v, { updated_at: nowIso() });
      if ('soc_pct' in v) db.power_log.push({ id: nid('power_log'), ts: nowIso(), soc_pct: v.soc_pct, note: String(b.note || '').slice(0, 200) });
    }
    return { ok: true };
  });
  route('POST', '/api/power/loads', (m, q, b) => { const v = P(b, SPEC.load); mustRows(v, ['name']); const row = { id: nid('loads'), enabled: 1, note: null, ...v }; db.loads.push(row); return { id: row.id }; });
  route('PUT', '/api/power/loads/(\\d+)', (m, q, b) => { const v = P(b, SPEC.load); if (!Object.keys(v).length) err('no_fields'); Object.assign(findIn(db.loads, ID(m)), v); return { ok: true }; });
  route('DELETE', '/api/power/loads/(\\d+)', m => del(db.loads, ID(m)));
  route('PUT', '/api/power/forecast', (m, q, b) => {
    const day = String(b.day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) err('bad_day');
    if (b.condition == null || b.condition === '' || b.condition === 'default') delete db.forecast[day];
    else { if (!ENUM.condition.includes(b.condition)) err('constraint_failed'); db.forecast[day] = b.condition; }
    return { ok: true };
  });

  route('GET', '/api/devices', () => fleetOverview());
  route('POST', '/api/devices', (m, q, b) => { const v = P(b, SPEC.device); mustRows(v, ['name', 'kind']); const row = { id: nid('devices'), power_state: 'off', battery_pct: null, battery_health_pct: null, ...v, updated_at: nowIso() }; db.devices.push(row); return { id: row.id }; });
  route('PUT', '/api/devices/(\\d+)', (m, q, b) => { const v = P(b, SPEC.device); if (!Object.keys(v).length) err('no_fields'); Object.assign(findIn(db.devices, ID(m)), v, { updated_at: nowIso() }); return { ok: true }; });
  route('DELETE', '/api/devices/(\\d+)', m => {
    const id = ID(m); del(db.devices, id);
    db.sims.forEach(s => { if (s.device_id === id) s.device_id = null; });          // ON DELETE SET NULL
    db.schedules = db.schedules.filter(w => w.device_id !== id);                      // ON DELETE CASCADE
    return { ok: true };
  });
  route('GET', '/api/sims', () => simsOverview());
  route('POST', '/api/sims', (m, q, b) => { const v = P(b, SPEC.sim); mustRows(v, ['label', 'carrier']); const row = { id: nid('sims'), actual_state: 'off', device_id: null, ...v }; db.sims.push(row); return { id: row.id }; });
  route('PUT', '/api/sims/(\\d+)', (m, q, b) => { const v = P(b, SPEC.sim); if (!Object.keys(v).length) err('no_fields'); Object.assign(findIn(db.sims, ID(m)), v); return { ok: true }; });
  route('DELETE', '/api/sims/(\\d+)', m => { const id = ID(m); del(db.sims, id); db.schedules = db.schedules.filter(w => w.sim_id !== id); return { ok: true }; });
  const checkSched = r => { if (!((r.kind === 'sim_power' && r.sim_id != null) || (r.kind === 'hotspot' && r.device_id != null))) err('constraint_failed'); };
  route('POST', '/api/schedules', (m, q, b) => {
    const v = P(b, SPEC.sched); mustRows(v, ['kind', 'start_hhmm', 'end_hhmm']);
    const row = { id: nid('schedules'), sim_id: null, device_id: null, days: '1111111', enabled: 1, ...v }; checkSched(row);
    db.schedules.push(row); return { id: row.id };
  });
  route('PUT', '/api/schedules/(\\d+)', (m, q, b) => { const v = P(b, SPEC.sched); if (!Object.keys(v).length) err('no_fields'); const r = findIn(db.schedules, ID(m)); const next = { ...r, ...v }; checkSched(next); Object.assign(r, v); return { ok: true }; });
  route('DELETE', '/api/schedules/(\\d+)', m => del(db.schedules, ID(m)));

  route('GET', '/api/kb', () => kbList());
  route('GET', '/api/kb/search', (m, q) => kbSearch(q.q || ''));
  route('POST', '/api/kb/reindex', () => ({ added: 0, updated: 0, removed: 0, total: db.kb.length }));
  route('GET', '/api/kb/doc', (m, q) => {
    const d = db.kb.find(x => x.path === q.path) || err('not_found');
    const out = { path: d.path, kind: d.kind, title: d.title };
    if (d.kind === 'html') out.srcdoc = d.content; else out.content = d.content;
    return out;
  });

  route('GET', '/api/events', (m, q) => {
    const limit = Math.min(+q.limit || 100, 1000);
    return sortedEvents().filter(e => !q.kind || e.kind === q.kind).slice(0, limit).map(clone);
  });
  route('POST', '/api/events', (m, q, b) => {
    const kind = String(b.kind || 'note'); if (!ENUM.kind_ev.includes(kind)) err('constraint_failed');
    const row = { id: nid('events'), ts: String(b.ts || nowIso()), kind, value: null, unit: null, text: null, author: null };
    if (b.value !== undefined && b.value !== '' && b.value !== null) { row.value = Number(b.value); if (!Number.isFinite(row.value)) err('bad_number'); }
    for (const k of ['unit', 'text', 'author']) if (b[k]) row[k] = String(b[k]).slice(0, 500);
    db.events.push(row); return { id: row.id };
  });
  route('DELETE', '/api/events/(\\d+)', m => del(db.events, ID(m)));

  route('GET', '/api/checklists', () => checklistsOverview());
  route('PUT', '/api/phase', (m, q, b) => {
    const p = db.phases.find(x => x.level === Number(b.level)) || err('bad_level');
    db.settings.active_phase = String(p.level);
    db.events.push({ id: nid('events'), ts: nowIso(), kind: 'note', value: null, unit: null, text: `เปลี่ยนเฟสเป็น ${p.name}`, author: 'system' });
    return { ok: true };
  });
  route('POST', '/api/checklists/items/(\\d+)/toggle', m => { const i = findIn(db.items, ID(m)); i.done = i.done ? 0 : 1; i.done_at = i.done ? nowIso() : null; return { done: i.done }; });
  route('POST', '/api/checklists/items', (m, q, b) => {
    const level = Number(b.level), text = String(b.text || '').trim();
    if (!text) err('missing_text'); if (!db.phases.some(p => p.level === level)) err('bad_level');
    const seq = Math.max(0, ...db.items.filter(i => i.level === level).map(i => i.seq)) + 1;
    const row = { id: nid('items'), level, seq, text, done: 0, done_at: null }; db.items.push(row); return { id: row.id };
  });
  route('DELETE', '/api/checklists/items/(\\d+)', m => del(db.items, ID(m)));
  route('POST', '/api/checklists/(\\d)/reset', m => { db.items.forEach(i => { if (i.level === ID(m)) { i.done = 0; i.done_at = null; } }); return { ok: true }; });

  window.OFFROAD_API = async (path, method = 'GET', body) => {
    const url = new URL(path, 'http://x'), q = Object.fromEntries(url.searchParams);
    for (const [m, rx, fn] of R) {
      if (m !== method) continue;
      const match = rx.exec(url.pathname);
      if (!match) continue;
      const snapshot = method === 'GET' ? null : JSON.stringify(db);
      try {
        const out = fn(match, q, body || {});
        if (method !== 'GET') persist();
        return clone(out);
      } catch (e) {
        if (snapshot) db = JSON.parse(snapshot);                     // rollback เหมือน transaction ของ SQLite
        throw e;
      }
    }
    err('not_found');
  };

  // ───────────── เครื่องมือเสริมของโหมดไฟล์เดียว: คลังความรู้ + สำรอง/นำเข้า ─────────────
  const KB_EXT = { md: 'md', markdown: 'md', txt: 'txt', html: 'html', htm: 'html' };
  window.OFFROAD_KB_TOOLS = `<div class="kbtools"><button class="sm" data-local="kb-new">＋ สร้างเอกสาร</button>
    <button class="sm" data-local="kb-import">📥 นำเข้าไฟล์ (.md .txt .html)</button></div>`;
  window.OFFROAD_DOC_TOOLS = (path, kind) => `<div class="kbtools" style="margin:0 0 10px">
    ${kind === 'html' ? '' : `<button class="sm" data-local="kb-edit" data-path="${path.replace(/"/g, '&quot;')}">✎ แก้ไข</button>`}
    <button class="sm danger" data-local="kb-del" data-path="${path.replace(/"/g, '&quot;')}">🗑 ลบ</button></div>`;

  const toastMsg = (m, e) => (typeof toast === 'function' ? toast(m, e) : alert(m));
  const download = (name, text, type = 'application/json') => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const pickFiles = (accept, multiple, cb) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple;
    i.onchange = () => cb([...i.files]); i.click();
  };
  const refreshKb = async () => { await refreshDocList(); };   // ฟังก์ชันจาก app.js
  function saveDoc(path, title, content, kind) {
    const ex = db.kb.find(d => d.path === path);
    const category = path.includes('/') ? path.split('/')[0] : '';
    if (ex) Object.assign(ex, { title, content, kind }); else db.kb.push({ id: nid('kb'), path, title, kind, category, content });
    persist();
  }

  document.addEventListener('click', async ev => {
    const el = ev.target.closest('[data-local]'); if (!el) return;
    const a = el.dataset.local, path = el.dataset.path;
    try {
      if (a === 'kb-new') {
        const title = ((await askText('ชื่อเอกสารใหม่')) || '').trim(); if (!title) return;
        const p = 'my_notes/' + title.replace(/[\\/:*?"<>|]/g, '_') + '.md';
        if (db.kb.some(d => d.path === p)) return toastMsg('มีเอกสารชื่อนี้แล้ว', true);
        saveDoc(p, title, `# ${title}\n\n`, 'md'); await refreshKb(); await openDoc(p); startEdit(p);
      } else if (a === 'kb-import') {
        pickFiles('.md,.markdown,.txt,.html,.htm', true, async files => {
          let n = 0;
          for (const f of files) {
            const kind = KB_EXT[f.name.split('.').pop().toLowerCase()];
            if (!kind) { toastMsg(`ข้ามไฟล์ ${f.name} (รองรับเฉพาะ .md .txt .html)`, true); continue; }
            const content = await f.text(), p = 'imported/' + f.name;
            saveDoc(p, kind === 'md' ? kbTitle(content, p) : (/<title>([^<]+)/i.exec(content)?.[1] || f.name.replace(/\.[^.]+$/, '')), content, kind); n++;
          }
          if (n) { toastMsg(`นำเข้า ${n} ไฟล์แล้ว`); await refreshKb(); }
        });
      } else if (a === 'kb-edit') startEdit(path);
      else if (a === 'kb-del') {
        if (!(await ask('ลบเอกสารนี้?', 'ลบ'))) return;
        db.kb = db.kb.filter(d => d.path !== path); persist(); kb.path = null;
        $('#kb-view').innerHTML = '<p class="muted">เลือกเอกสารทางซ้าย</p>'; await refreshKb();
      } else if (a === 'backup') showBackup();
      else if (a === 'restore') showRestore();
      else if (a === 'reset') {
        if (await ask('ล้างข้อมูลทั้งหมดและเริ่มใหม่ด้วยข้อมูลตัวอย่าง? (แนะนำให้สำรองข้อมูลก่อน)', 'ล้างข้อมูล')) {
          try { localStorage.removeItem(KEY); } catch { /* ignore */ }
          db = JSON.parse(JSON.stringify(window.OFFROAD_SEED)); persist(); location.reload();
        }
      }
    } catch (e) { toastMsg('ผิดพลาด: ' + e.message, true); }
  });

  // สำรอง = คัดลอก JSON (ใช้ได้ทุกที่) หรือดาวน์โหลดไฟล์ (บางมุมมองบล็อกการดาวน์โหลด)
  function showBackup() {
    const text = JSON.stringify(db), d = new Date();
    const m = modal(`<form method="dialog"><p><b>สำรองข้อมูล</b><br><span class="small muted">คัดลอกข้อความนี้ไปเก็บในไฟล์ข้อความ/โน้ต หรือกดดาวน์โหลดเป็นไฟล์ .json
      (ถ้าปุ่มดาวน์โหลดไม่ทำงานในมุมมองนี้ ให้ใช้ปุ่มคัดลอก)</span></p>
      <textarea id="bk-text" readonly>${esc(text)}</textarea><div class="row gap end mt">
      <button type="button" id="bk-copy">คัดลอก</button><button type="button" id="bk-dl">ดาวน์โหลด .json</button>
      <button class="primary" value="close">ปิด</button></div></form>`);
    $('#bk-copy', m).onclick = async () => {
      try { await navigator.clipboard.writeText(text); toastMsg('คัดลอกแล้ว'); }
      catch { const t = $('#bk-text', m); t.select(); toastMsg('เลือกข้อความแล้ว กด Ctrl+C เพื่อคัดลอก'); }
    };
    $('#bk-dl', m).onclick = () => download(`offroad-backup-${ymd(d)}-${pad(d.getHours())}${pad(d.getMinutes())}.json`, text);
  }
  function showRestore() {
    const m = modal(`<form method="dialog"><p><b>นำเข้าข้อมูลสำรอง</b><br><span class="small muted">เลือกไฟล์ .json หรือวางข้อความที่สำรองไว้ แล้วกดนำเข้า (ข้อมูลปัจจุบันจะถูกแทนที่)</span></p>
      <input type="file" id="rs-file" accept=".json,application/json"><textarea id="rs-text" class="mt" placeholder="หรือวางข้อความ JSON ที่นี่"></textarea>
      <div class="row gap end mt"><button value="no">ยกเลิก</button><button type="button" class="primary" id="rs-go">นำเข้า</button></div></form>`);
    $('#rs-go', m).onclick = async () => {
      try {
        const f = $('#rs-file', m).files[0], data = JSON.parse(f ? await f.text() : $('#rs-text', m).value);
        if (!data || !Array.isArray(data.supplies) || !data.station || !Array.isArray(data.kb)) throw new Error('bad');
        m.close();
        if (!(await ask('แทนที่ข้อมูลปัจจุบันทั้งหมดด้วยข้อมูลสำรองนี้?', 'นำเข้า'))) return;
        db = data; persist(); location.reload();
      } catch { toastMsg('ข้อมูลสำรองไม่ถูกต้อง', true); }
    };
  }

  function startEdit(path) {
    const d = db.kb.find(x => x.path === path); if (!d) return;
    const el = $('#kb-view');
    el.innerHTML = `<div class="small muted">แก้ไข: ${esc(d.path)}</div>
      <textarea id="kb-edit" style="min-height:55vh;margin:8px 0;font-family:ui-monospace,Consolas,monospace">${esc(d.content)}</textarea>
      <div class="row gap"><button class="primary" id="kb-save">บันทึก</button><button id="kb-cancel">ยกเลิก</button></div>`;
    $('#kb-save').onclick = async () => {
      const content = $('#kb-edit').value; saveDoc(path, d.kind === 'md' ? kbTitle(content, path) : d.title, content, d.kind);
      toastMsg('บันทึกเอกสารแล้ว'); await refreshKb(); await openDoc(path);
    };
    $('#kb-cancel').onclick = () => openDoc(path);
  }

  // เมนูสำรอง/นำเข้า + สถานะการบันทึก
  function status() {
    const s = document.getElementById('persist-status'); if (!s) return;
    s.textContent = persistOK ? '💾 บันทึกในเบราว์เซอร์นี้' : '⚠ บันทึกถาวรไม่ได้ — ใช้ “สำรองข้อมูล”';
    s.style.color = persistOK ? '' : 'var(--warn)';
  }
  document.addEventListener('DOMContentLoaded', () => {
    const nav = document.getElementById('nav'); if (!nav) return;
    nav.insertAdjacentHTML('beforeend', `<div class="navtools"><div class="status" id="persist-status"></div>
      <button data-local="backup">⬇ สำรองข้อมูล (.json)</button><button data-local="restore">⬆ นำเข้าข้อมูล</button>
      <button data-local="reset" class="danger">⟲ รีเซ็ตเป็นข้อมูลตัวอย่าง</button></div>`);
    status();
  });
})();
