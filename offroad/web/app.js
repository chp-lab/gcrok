'use strict';
/* Off Road web UI — vanilla JS, no external requests (works fully offline). */

// ───────────── helpers ─────────────
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const CAT = { water: '💧 น้ำ', food: '🍱 อาหาร', gas: '🔥 แก๊ส', fuel: '⛽ เชื้อเพลิง' };
const COND = { sunny: '☀️ แดดจัด', partly: '⛅ มีเมฆบ้าง', cloudy: '☁️ เมฆมาก', rain: '🌧️ ฝน', storm: '⛈️ พายุ' };
const COND_ICON = { sunny: '☀️', partly: '⛅', cloudy: '☁️', rain: '🌧️', storm: '⛈️' };
const KIND = { phone: '📱 สมาร์ทโฟน', tablet: '📲 แท็บเล็ต', laptop: '💻 แล็ปท็อป', pc: '🖥️ PC' };
const PSTATE = { on: 'เปิด', off: 'ปิด', charging: 'กำลังชาร์จ', standby: 'สแตนด์บาย' };
const EVKIND = { water_gate: '🌊 น้ำหน้าบ้าน', water_indoor: '🏠 น้ำในบ้าน', breaker: '⚡ เบรกเกอร์', solar: '☀️ โซลาร์', power: '🔋 พลังงาน',
  supply: '📦 เสบียง', health: '🩹 สุขภาพ', comms: '📡 สื่อสาร', note: '📝 บันทึก' };
const EVUNIT = { water_gate: 'cm', water_indoor: 'cm', solar: 'Wh' };
const STATUS_CLS = { ok: 'ok', warn: 'warn', crit: 'crit', unknown: 'info' };

const num = (n, d = 0) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('th-TH', { maximumFractionDigits: d });
const fmtDays = d => d == null ? '∞' : d >= 10 ? String(Math.round(d)) : d.toFixed(1);
const hhmm = d => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
function when(iso) {            // เวลาสั้น ๆ; ถ้าไม่ใช่วันนี้ใส่วันที่ด้วย
  if (!iso) return '—';
  const d = new Date(iso), now = new Date();
  return d.toDateString() === now.toDateString() ? hhmm(d)
    : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) + ' ' + hhmm(d);
}
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? 'เมื่อสักครู่' : m < 60 ? `${m} นาทีที่แล้ว` : m < 1440 ? `${Math.floor(m / 60)} ชม.ที่แล้ว` : `${Math.floor(m / 1440)} วันที่แล้ว`;
}
const opts = (map, sel) => Object.entries(map).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
const dayName = iso => new Date(iso + 'T00:00').toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric' });

let toastTimer;
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = '', 2200);
}

async function api(path, method = 'GET', body, retried = false) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const pin = store.get('offroad_pin');
  if (pin) headers['X-Offroad-Pin'] = pin;
  const r = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 403 && !retried) {   // เครื่องอื่นใน LAN: ต้องใช้ PIN เพื่อแก้ไข
    const e = await r.json().catch(() => ({}));
    if (e.error === 'pin_required') {
      const p = prompt('ใส่ PIN เพื่อแก้ไขข้อมูล (ดูได้ที่หน้าจอโปรแกรมบนเครื่องหลัก)');
      if (p) { store.set('offroad_pin', p.trim()); return api(path, method, body, true); }
    }
    throw new Error(e.error || 'forbidden');
  }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || String(r.status));
  return r.json();
}

// ───────────── minimal Markdown renderer (escape-first, no raw HTML) ─────────────
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function md(src) {
  const L = src.replace(/\r/g, '').split('\n'), out = [];
  let list = null, i = 0;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  while (i < L.length) {
    const l = L[i]; let m;
    if (/^```/.test(l)) {
      close(); const buf = []; i++;
      while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]);
      out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
    } else if ((m = l.match(/^(#{1,3})\s+(.*)/))) {
      close(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if (/^\s*([-*_])\1{2,}\s*$/.test(l)) { close(); out.push('<hr>');
    } else if (/^>\s?/.test(l)) { close(); out.push('<blockquote>' + inline(l.replace(/^>\s?/, '')) + '</blockquote>');
    } else if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(L[i + 1] || '')) {
      close(); const head = cells(l); i += 2; const rows = [];
      while (i < L.length && /^\s*\|/.test(L[i])) rows.push(cells(L[i++]));
      i--;
      out.push('<div class="tablewrap"><table><tr>' + head.map(h => `<th>${inline(h)}</th>`).join('') + '</tr>'
        + rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</table></div>');
    } else if ((m = l.match(/^\s*[-*]\s+(?:\[([ xX])\]\s+)?(.*)/))) {
      if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; }
      out.push(m[1] === undefined ? `<li>${inline(m[2])}</li>` : `<li class="task">${/x/i.test(m[1]) ? '☑' : '☐'} ${inline(m[2])}</li>`);
    } else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if (!l.trim()) { close();
    } else { close(); out.push('<p>' + inline(l) + '</p>'); }
    i++;
  }
  close();
  return out.join('\n');
}

// ───────────── view: dashboard ─────────────
const bar = (pct, cls = '') => `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;

function phaseCard(d) {
  const p = d.phase;
  return `<section class="card span2">
    <h2>สถานการณ์ปัจจุบัน</h2>
    <div class="row wrap between">
      <div class="row wrap">
        <span class="flag ${p.flag}">⚑ ${esc(p.name)}</span>
        <span class="muted">${esc(p.summary)}</span>
      </div>
      <div class="row gap">${[1, 2, 3].map(n => `<button class="seg ${n === p.level ? 'on' : ''}" data-flag="${['yellow', 'orange', 'red'][n - 1]}"
        data-act="phase" data-level="${n}">ระดับ ${n}</button>`).join('')}</div>
    </div>
    <div class="row mt gap"><div style="flex:1">${bar(p.total ? 100 * p.done / p.total : 0, 'info')}</div>
      <a href="#log" class="small">Checklist ${p.done}/${p.total}</a></div>
  </section>`;
}

function powerCard(d) {
  const p = d.power, pct = p.soc_pct, cls = pct < 20 ? 'crit' : pct < 40 ? 'warn' : '';
  const dr = p.days_remaining;
  const drCls = p.sustainable ? 'ok' : dr < 1 ? 'crit' : dr < 3 ? 'warn' : 'ok';
  const net = p.days[0] ? p.days[0].solar_wh - p.burn_wh_day : 0;
  return `<section class="card"><h2>🔋 พลังงาน <a href="#power" class="small">จัดการ</a></h2>
    <div class="row gap">
      <div class="ring ${cls}"><svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="54" fill="none" stroke-width="10"/>
        <circle class="val" cx="60" cy="60" r="54" fill="none" stroke-width="10" stroke-dasharray="${(pct * 3.3929).toFixed(1)} 339.3"/></svg>
        <div class="label"><b>${num(pct)}%</b><span class="small muted">${num(p.stored_wh)} Wh</span></div></div>
      <div>
        <div class="big ${drCls}">${p.sustainable ? '✅ พอใช้' : '~' + fmtDays(dr)}</div>
        <div class="muted">${p.sustainable ? 'โซลาร์พอเลี้ยงโหลดตามพยากรณ์' : 'วันที่แบตจะถึงเกณฑ์สำรอง'}</div>
        <div class="small mt">ใช้ ${num(p.burn_wh_day)} Wh/วัน · โซลาร์วันนี้ ${num(p.days[0]?.solar_wh)} Wh
          <span class="${net < 0 ? 'warn' : 'ok'}">(สุทธิ ${net >= 0 ? '+' : ''}${num(net)})</span></div>
      </div></div>
    <div class="spark mt" title="แบตคงเหลือ (%) คาดการณ์ 7 วัน">${p.days.map(x => `<div><span class="${x.end_pct < 20 ? 'low' : ''}"
      style="height:${Math.max(2, x.end_pct * 0.5)}px"></span>${COND_ICON[x.condition] || ''}</div>`).join('')}</div>
  </section>`;
}

function supplyCard(d) {
  return `<section class="card"><h2>📦 เสบียง <a href="#supplies" class="small">จัดการ</a></h2>
    ${d.supplies.map(c => `<div class="mt" style="margin-top:8px"><div class="row between"><span>${CAT[c.category] || esc(c.category)}</span>
      <b class="${STATUS_CLS[c.status]}">${c.days == null ? '—' : fmtDays(c.days) + ' วัน'}</b></div>
      ${bar(c.days == null ? 0 : c.days / 14 * 100, c.status === 'ok' ? '' : STATUS_CLS[c.status])}
      <div class="small muted">${c.items.map(i => `${esc(i.name)} ${num(i.qty_remaining, 1)} ${esc(i.unit)}`).join(' · ')}</div></div>`).join('')}
  </section>`;
}

function waterCard(d) {
  const one = (label, e) => `<div><div class="muted small">${label}</div>
    <div class="big">${e ? num(e.value, 1) : '—'}<span class="small muted"> cm</span></div>
    <div class="small muted">${e ? ago(e.ts) : 'ยังไม่มีข้อมูล'}</div></div>`;
  return `<section class="card"><h2>🌊 ระดับน้ำ</h2>
    <div class="row between wrap">${one('หน้าบ้าน (ถนน)', d.water.gate)}${one('ในบ้าน ชั้น 1', d.water.indoor)}</div>
    <form class="inline mt" data-post="/api/events" data-toast="บันทึกระดับน้ำแล้ว">
      <select name="kind"><option value="water_gate">หน้าบ้าน</option><option value="water_indoor">ในบ้าน</option></select>
      <input type="number" name="value" step="0.5" min="0" placeholder="cm" required><input type="hidden" name="unit" value="cm">
      <button class="primary">บันทึก</button></form>
  </section>`;
}

function commsCard(d) {
  const s = d.sims;
  const chips = (arr, cls) => arr.length ? arr.map(x => `<span class="chip ${cls}">${esc(x)}</span>`).join(' ') : '<span class="muted">—</span>';
  return `<section class="card"><h2>📡 การสื่อสาร <a href="#fleet" class="small">จัดการ</a></h2>
    <div class="small muted">ตามตารางควรเปิดซิมตอนนี้</div><div class="row wrap gap">${chips(s.on_now, 'ok')}</div>
    <div class="small muted mt">ซิมที่เปิดอยู่จริง</div><div class="row wrap gap">${chips(s.actual_on, 'info')}</div>
    ${s.mismatch.length ? `<div class="warn small mt">⚠ ไม่ตรงตาราง: ${s.mismatch.map(esc).join(', ')}</div>` : ''}
    <div class="small mt">เปลี่ยนสถานะครั้งถัดไป: <b>${when(s.next_change)}</b></div>
    ${s.hotspots.map(h => `<div class="small">📶 Hotspot ${esc(h.device_name)}: <b class="${h.active ? 'ok' : 'muted'}">${h.active ? 'ควรเปิดตอนนี้' : 'ปิด'}</b>
      · ถัดไป ${when(h.next_change)}</div>`).join('')}
  </section>`;
}

function fleetCard(d) {
  const f = d.fleet;
  return `<section class="card"><h2>📱 อุปกรณ์ ${f.total} ชิ้น <a href="#fleet" class="small">จัดการ</a></h2>
    <div class="row wrap gap">${Object.entries(f.by_kind).map(([k, n]) => `<span class="chip">${KIND[k] || esc(k)} × ${n}</span>`).join('')}</div>
    <div class="small mt">เปิด/ชาร์จอยู่ ${f.powered_on} เครื่อง</div>
    ${f.low_battery.length ? `<div class="warn small mt">🔻 แบตต่ำ: ${f.low_battery.map(x => `${esc(x.name)} (${x.battery_pct}%)`).join(', ')}</div>`
      : '<div class="ok small mt">✓ ไม่มีอุปกรณ์แบตต่ำ</div>'}
  </section>`;
}

function timelineCard(d) {
  return `<section class="card"><h2>📝 เหตุการณ์ล่าสุด <a href="#log" class="small">ทั้งหมด</a></h2>
    <ul class="list">${d.events.map(e => `<li><time>${when(e.ts)}</time><span class="grow">${EVKIND[e.kind] || ''}
      ${e.value != null ? `<b>${num(e.value, 1)} ${esc(e.unit || '')}</b>` : ''} ${esc(e.text || '')}</span></li>`).join('')}</ul>
    <form class="inline mt" data-post="/api/events" data-toast="บันทึกแล้ว"><input type="hidden" name="kind" value="note">
      <input class="wide" style="flex:1" name="text" placeholder="บันทึกเหตุการณ์ใหม่…" required><button class="primary">เพิ่ม</button></form>
  </section>`;
}

async function viewDashboard() {
  const [d, meta] = await Promise.all([api('/api/dashboard'), api('/api/meta?port=' + (location.port || 80))]);
  const lan = meta.lan_urls.length ? `<section class="card"><h2>🛜 เปิดจากอุปกรณ์อื่น (Wi-Fi/Hotspot เดียวกัน)</h2>
      <div class="row wrap gap">${meta.lan_urls.map(u => `<code class="chip info">${esc(u)}</code>`).join('')}</div>
      <div class="small muted mt">อ่านได้ทันที · การแก้ไขข้อมูลจากเครื่องอื่นต้องใส่ PIN (แสดงตอนเปิดโปรแกรม)</div></section>` : '';
  return { title: 'แดชบอร์ด', html: `<div class="grid">${phaseCard(d)}${powerCard(d)}${supplyCard(d)}${waterCard(d)}${commsCard(d)}${fleetCard(d)}${timelineCard(d)}${lan}</div>` };
}

// ───────────── view: supplies ─────────────
async function viewSupplies() {
  const cats = await api('/api/supplies');
  const rows = cats.map(c => `<tr class="group"><td colspan="7">${CAT[c.category] || esc(c.category)}
      <span class="chip ${STATUS_CLS[c.status]}">${c.days == null ? 'ไม่ระบุอัตราใช้' : 'เหลือรวม ' + fmtDays(c.days) + ' วัน'}</span></td></tr>`
    + c.items.map(i => `<tr>
      <td><input data-edit="/api/supplies/${i.id}" data-field="name" value="${esc(i.name)}"></td>
      <td class="num"><input type="number" step="any" min="0" data-edit="/api/supplies/${i.id}" data-field="qty_remaining" value="${i.qty_remaining}"></td>
      <td>${esc(i.unit)}</td>
      <td class="num"><input type="number" step="any" min="0" data-edit="/api/supplies/${i.id}" data-field="daily_use" value="${i.daily_use}"></td>
      <td class="num">${i.days == null ? '—' : fmtDays(i.days)}</td>
      <td><div class="row gap"><input type="number" step="any" min="0" id="amt-${i.id}" placeholder="จำนวน" style="width:80px">
        <button class="sm" data-act="adjust" data-id="${i.id}" data-sign="-1">− ใช้</button>
        <button class="sm" data-act="adjust" data-id="${i.id}" data-sign="1">+ เติม</button></div></td>
      <td><button class="sm danger" data-act="del" data-url="/api/supplies/${i.id}" title="ลบ">✕</button></td></tr>`).join('')).join('');
  return { title: 'เสบียง', html: `<section class="card"><div class="tablewrap"><table>
      <tr><th>รายการ</th><th class="num">คงเหลือ</th><th>หน่วย</th><th class="num" title="ปริมาณที่ใช้ต่อวัน ถ้าใช้ชนิดนี้อย่างเดียว">ใช้/วัน</th><th class="num">วัน</th><th>ปรับยอด</th><th></th></tr>
      ${rows}</table></div>
      <p class="small muted">“ใช้/วัน” = ปริมาณที่ใช้ต่อวันหากใช้ชนิดนี้อย่างเดียว · จำนวนวันของหมวด = ผลรวมของวันที่แต่ละรายการให้ได้</p></section>
    <section class="card mt"><h2>เพิ่มรายการ</h2><form class="inline" data-post="/api/supplies" data-toast="เพิ่มรายการแล้ว">
      <select name="category">${opts(CAT)}</select><input name="name" placeholder="ชื่อ" required>
      <input name="unit" placeholder="หน่วย" style="width:90px" required><input type="number" name="qty_initial" step="any" min="0" placeholder="จำนวน" required>
      <input type="number" name="daily_use" step="any" min="0" placeholder="ใช้/วัน" required><button class="primary">เพิ่ม</button></form></section>` };
}

// ───────────── view: power ─────────────
async function viewPower() {
  const p = await api('/api/power'), st = p.station, E = '/api/power/station';
  const field = (label, f, step = 'any', hint = '') => `<label class="small muted">${label}<br>
    <input type="number" step="${step}" data-edit="${E}" data-field="${f}" value="${st[f]}" title="${esc(hint)}"></label>`;
  return { title: 'พลังงาน', html: `<div class="grid wide">
    <section class="card"><h2>Power Station &amp; โซลาร์</h2><div class="row wrap gap">
      ${field('ความจุ (Wh)', 'capacity_wh')}${field('แบตตอนนี้ (SoC %)', 'soc_pct', '1')}${field('สำรองขั้นต่ำ (%)', 'reserve_pct', '1')}
      ${field('ประสิทธิภาพอินเวอร์เตอร์ (0–1)', 'inverter_eff', '0.01')}${field('โซลาร์สูงสุด (W)', 'solar_peak_w')}
      ${field('ค่าลดทอนโซลาร์ (0–1)', 'solar_derate', '0.01', 'ฝุ่น/ความร้อน/มุมแผง')}${field('ชม.แดดจัด/วัน', 'peak_sun_hours', '0.1')}
      <label class="small muted">พยากรณ์ตั้งต้น<br><select data-edit="${E}" data-field="default_condition">${opts(COND, p.default_condition)}</select></label></div>
      <div class="mt big ${p.sustainable ? 'ok' : p.days_remaining < 1 ? 'crit' : p.days_remaining < 3 ? 'warn' : ''}">
        ${p.sustainable ? '✅ โซลาร์พอใช้ตลอด 14 วัน' : 'แบตอยู่ได้ ~' + fmtDays(p.days_remaining) + ' วัน'}</div>
      <div class="small muted">โหลดรวม ${num(p.load_wh_day)} Wh/วัน (แบตจ่ายจริง ${num(p.burn_wh_day)} Wh) · เก็บอยู่ ${num(p.stored_wh)} Wh · สำรอง ${num(p.reserve_wh)} Wh</div>
    </section>
    <section class="card"><h2>พยากรณ์แสงแดด 14 วัน</h2><div class="tablewrap"><table>
      <tr><th>วัน</th><th>สภาพอากาศ</th><th class="num">โซลาร์ Wh</th><th class="num">แบตสิ้นวัน</th></tr>
      ${p.days.map(x => `<tr><td>${dayName(x.day)}</td><td><select data-forecast="${x.day}"><option value="default">ตามค่าตั้งต้น (${COND_ICON[p.default_condition]})</option>
        ${opts(COND, p.forecast_days[x.day])}</select></td><td class="num">${num(x.solar_wh)}</td>
        <td class="num ${x.end_pct < 20 ? 'crit' : ''}">${num(x.end_pct)}%</td></tr>`).join('')}</table></div></section>
    <section class="card span2"><h2>โหลดไฟฟ้า (Wh/วัน)</h2><div class="tablewrap"><table>
      <tr><th>เปิดใช้</th><th>อุปกรณ์</th><th class="num">วัตต์</th><th class="num">ชม./วัน</th><th class="num">Wh/วัน</th><th></th></tr>
      ${p.loads.map(l => `<tr><td><input type="checkbox" data-edit="/api/power/loads/${l.id}" data-field="enabled" ${l.enabled ? 'checked' : ''}></td>
        <td><input data-edit="/api/power/loads/${l.id}" data-field="name" value="${esc(l.name)}"></td>
        <td class="num"><input type="number" step="any" min="0" data-edit="/api/power/loads/${l.id}" data-field="watts" value="${l.watts}"></td>
        <td class="num"><input type="number" step="any" min="0" max="24" data-edit="/api/power/loads/${l.id}" data-field="hours_per_day" value="${l.hours_per_day}"></td>
        <td class="num ${l.enabled ? '' : 'muted'}">${num(l.watts * l.hours_per_day)}</td>
        <td><button class="sm danger" data-act="del" data-url="/api/power/loads/${l.id}">✕</button></td></tr>`).join('')}</table></div>
      <form class="inline mt" data-post="/api/power/loads" data-toast="เพิ่มโหลดแล้ว"><input name="name" placeholder="ชื่ออุปกรณ์" required>
        <input type="number" name="watts" step="any" min="0" placeholder="W" required><input type="number" name="hours_per_day" step="any" min="0" max="24" placeholder="ชม./วัน" required>
        <input type="hidden" name="enabled" value="1"><button class="primary">เพิ่ม</button></form></section></div>` };
}

// ───────────── view: fleet & SIM ─────────────
async function viewFleet() {
  const [f, s] = await Promise.all([api('/api/devices'), api('/api/sims')]);
  const devName = Object.fromEntries(f.devices.map(d => [d.id, d.name]));
  const D = id => `/api/devices/${id}`;
  const days = d => '<span class="muted small">' + [...d].map((c, i) => c === '1' ? ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'][i] : '·').join(' ') + '</span>';
  const schedRow = w => `<tr><td>${w.kind === 'sim_power' ? '🔌 ซิม ' + esc(s.sims.find(x => x.id === w.sim_id)?.label) : '📶 Hotspot ' + esc(devName[w.device_id])}</td>
    <td><input type="time" data-edit="/api/schedules/${w.id}" data-field="start_hhmm" value="${w.start_hhmm}"></td>
    <td><input type="time" data-edit="/api/schedules/${w.id}" data-field="end_hhmm" value="${w.end_hhmm}"></td>
    <td><input data-edit="/api/schedules/${w.id}" data-field="days" value="${w.days}" maxlength="7" pattern="[01]{7}" title="จันทร์→อาทิตย์ 1=ทำงาน" style="width:92px"> ${days(w.days)}</td>
    <td><input type="checkbox" data-edit="/api/schedules/${w.id}" data-field="enabled" ${w.enabled ? 'checked' : ''}></td>
    <td><button class="sm danger" data-act="del" data-url="/api/schedules/${w.id}">✕</button></td></tr>`;
  return { title: 'อุปกรณ์ & SIM', html: `
    <section class="card"><h2>อุปกรณ์ทั้งหมด (${f.total})</h2><div class="tablewrap"><table>
      <tr><th>ชื่อ</th><th>ประเภท</th><th class="num">แบต %</th><th class="num">สุขภาพแบต %</th><th>สถานะ</th><th>ซิม</th><th>หน้าที่/หมายเหตุ</th></tr>
      ${f.devices.map(d => `<tr><td><input data-edit="${D(d.id)}" data-field="name" value="${esc(d.name)}"></td><td>${KIND[d.kind]}</td>
        <td class="num">${d.battery_pct == null ? '<span class="muted">AC</span>' : `<input type="number" min="0" max="100" data-edit="${D(d.id)}" data-field="battery_pct" value="${d.battery_pct}" class="${d.battery_pct < 30 ? 'crit' : ''}">`}</td>
        <td class="num">${d.battery_health_pct == null ? '—' : `<input type="number" min="0" max="100" data-edit="${D(d.id)}" data-field="battery_health_pct" value="${d.battery_health_pct}">`}</td>
        <td><select data-edit="${D(d.id)}" data-field="power_state">${opts(PSTATE, d.power_state)}</select></td>
        <td>${d.sims.map(x => `<span class="chip">${esc(x)}</span>`).join(' ')}</td>
        <td><input data-edit="${D(d.id)}" data-field="role" value="${esc(d.role || '')}" placeholder="เช่น สื่อสารหลัก"></td></tr>`).join('')}</table></div></section>
    <section class="card mt"><h2>ซิม (AIS / True)</h2><div class="tablewrap"><table>
      <tr><th>ซิม</th><th>เครื่อง</th><th>ควรเป็น</th><th>จริง</th><th>เปลี่ยนถัดไป</th><th>หมดอายุ</th></tr>
      ${s.sims.map(m => `<tr><td><b>${esc(m.label)}</b> <span class="chip ${m.carrier === 'AIS' ? 'ok' : 'warn'}">${m.carrier}</span></td><td>${esc(m.device_name || '—')}</td>
        <td><span class="chip ${m.scheduled_on ? 'ok' : ''}">${m.has_schedule ? (m.scheduled_on ? 'เปิด' : 'ปิด') : 'ไม่มีตาราง'}</span></td>
        <td><select data-edit="/api/sims/${m.id}" data-field="actual_state"><option value="on"${m.actual_state === 'on' ? ' selected' : ''}>เปิด</option><option value="off"${m.actual_state === 'off' ? ' selected' : ''}>ปิด</option></select>
          ${m.mismatch ? '<span class="warn" title="ไม่ตรงตาราง">⚠</span>' : ''}</td>
        <td>${when(m.next_change)}</td><td><input type="date" data-edit="/api/sims/${m.id}" data-field="expires_on" value="${esc(m.expires_on || '')}" style="width:150px"></td></tr>`).join('')}</table></div></section>
    <section class="card mt"><h2>ตารางหมุนเวียนเปิด–ปิด (SIM / Hotspot)</h2><div class="tablewrap"><table>
      <tr><th>เป้าหมาย</th><th>เริ่ม</th><th>จบ</th><th>วัน (จ→อา)</th><th>ใช้</th><th></th></tr>${s.schedules.map(schedRow).join('')}</table></div>
      <div class="row wrap gap mt">
        <form class="inline" data-post="/api/schedules" data-toast="เพิ่มเวลาแล้ว"><input type="hidden" name="kind" value="sim_power">
          <select name="sim_id">${s.sims.map(m => `<option value="${m.id}">${esc(m.label)}</option>`).join('')}</select>
          <input type="time" name="start_hhmm" required><input type="time" name="end_hhmm" required><button class="primary">+ เวลาเปิดซิม</button></form>
        <form class="inline" data-post="/api/schedules" data-toast="เพิ่มเวลาแล้ว"><input type="hidden" name="kind" value="hotspot">
          <select name="device_id">${f.devices.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>
          <input type="time" name="start_hhmm" required><input type="time" name="end_hhmm" required><button class="primary">+ เวลา Hotspot</button></form></div></section>` };
}

// ───────────── view: knowledge base ─────────────
const kb = { q: '', path: null };
function docList(items, searching) {
  if (!items.length) return `<p class="muted">${searching ? 'ไม่พบผลลัพธ์' : 'ยังไม่มีเอกสาร — วางไฟล์ใน knowledge/ แล้วกด “สแกนใหม่”'}</p>`;
  let last = null, out = '';
  for (const d of items) {
    if (!searching && d.category !== last) { out += `<div class="small muted" style="margin-top:10px">📁 ${esc(d.category || 'ทั่วไป')}</div>`; last = d.category; }
    const snip = d.snip ? `<span class="snip">${esc(d.snip).replace(/\x02/g, '<mark>').replace(/\x03/g, '</mark>')}</span>` : '';
    out += `<button class="doclink ${d.path === kb.path ? 'active' : ''}" data-act="open-doc" data-path="${esc(d.path)}">
      ${esc(d.title)} <span class="chip">${d.kind}</span>${snip}</button>`;
  }
  return out;
}
async function refreshDocList() {
  const el = $('#kb-list'); if (!el) return;
  const items = kb.q.trim() ? await api('/api/kb/search?q=' + encodeURIComponent(kb.q)) : await api('/api/kb');
  el.innerHTML = docList(items, !!kb.q.trim());
}
async function openDoc(path) {
  kb.path = path;
  const el = $('#kb-view');
  const url = '/kb-files/' + path.split('/').map(encodeURIComponent).join('/');
  const doc = await api('/api/kb/doc?path=' + encodeURIComponent(path));
  if (doc.kind === 'md') el.innerHTML = `<div class="md">${md(doc.content)}</div>`;
  else if (doc.kind === 'txt') el.innerHTML = `<pre style="white-space:pre-wrap">${esc(doc.content)}</pre>`;
  else el.innerHTML = `<iframe class="doc" src="${url}" ${doc.kind === 'html' ? 'sandbox="allow-popups"' : ''} title="${esc(doc.title)}"></iframe>
    <p class="small"><a href="${url}" target="_blank">เปิดในแท็บใหม่</a></p>`;
  refreshDocList();
}
async function viewKnowledge() {
  return { title: 'คลังความรู้', html: `<div class="kbgrid"><section class="card">
      <div class="row gap"><input id="kb-q" class="wide" type="search" placeholder="ค้นหาในเอกสารทั้งหมด…" value="${esc(kb.q)}">
        <button class="sm" data-act="reindex" title="สแกนโฟลเดอร์ knowledge/ ใหม่">⟳</button></div>
      <div id="kb-list" class="mt"></div></section>
      <section class="card" id="kb-view"><p class="muted">เลือกเอกสารทางซ้าย</p></section></div>`,
    after: async () => { await refreshDocList(); if (kb.path) openDoc(kb.path).catch(() => { kb.path = null; }); } };
}

// ───────────── view: log & checklists ─────────────
const logState = { phase: null, filter: '' };
async function viewLog() {
  const [chk, ev] = await Promise.all([api('/api/checklists'), api('/api/events?limit=200' + (logState.filter ? '&kind=' + logState.filter : ''))]);
  const lv = logState.phase || chk.active, ph = chk.phases.find(p => p.level === lv);
  return { title: 'บันทึก & Checklist', html: `<div class="grid wide">
    <section class="card"><h2>Checklist ตามระดับ</h2>
      <div class="row gap wrap">${chk.phases.map(p => `<button class="seg ${p.level === lv ? 'on' : ''}" data-flag="${p.flag}" data-act="log-phase" data-level="${p.level}">
        ${esc(p.name)} (${p.done}/${p.total})</button>`).join('')}</div>
      <div class="row between mt"><span class="muted small">${esc(ph.summary)}${lv === chk.active ? ' · <b>ระดับปัจจุบัน</b>' : ''}</span>
        <span><button class="sm" data-act="reset-checklist" data-level="${lv}">รีเซ็ต</button></span></div>
      <div class="mt">${ph.items.map(i => `<div class="check ${i.done ? 'done' : ''}"><input type="checkbox" ${i.done ? 'checked' : ''} data-act="toggle-item" data-id="${i.id}">
        <span class="t" data-act="toggle-item" data-id="${i.id}">${esc(i.text)}${i.done_at ? ` <span class="small muted">· ${when(i.done_at)}</span>` : ''}</span>
        <button class="sm danger" data-act="del" data-url="/api/checklists/items/${i.id}" data-noconfirm="1">✕</button></div>`).join('')}</div>
      <form class="inline mt" data-post="/api/checklists/items" data-toast="เพิ่มข้อแล้ว"><input type="hidden" name="level" value="${lv}">
        <input name="text" style="flex:1" placeholder="เพิ่มข้อใหม่ในระดับนี้…" required><button class="primary">เพิ่ม</button></form></section>
    <section class="card"><h2>บันทึกเหตุการณ์ (Timeline)</h2>
      <form class="inline" data-post="/api/events" data-toast="บันทึกแล้ว"><select name="kind">${opts(EVKIND, 'note')}</select>
        <input type="number" name="value" step="any" placeholder="ค่า" style="width:80px"><input name="unit" placeholder="หน่วย" style="width:64px">
        <input name="text" placeholder="รายละเอียด" style="flex:1;min-width:140px"><button class="primary">บันทึก</button></form>
      <div class="row gap mt"><span class="small muted">กรอง</span><select data-act="log-filter"><option value="">ทั้งหมด</option>${opts(EVKIND, logState.filter)}</select></div>
      <ul class="list">${ev.map(e => `<li><time>${when(e.ts)}</time><span class="grow">${EVKIND[e.kind] || ''}
        ${e.value != null ? `<b>${num(e.value, 1)} ${esc(e.unit || '')}</b>` : ''} ${esc(e.text || '')}</span>
        <button class="sm danger" data-act="del" data-url="/api/events/${e.id}">✕</button></li>`).join('')}</ul></section></div>` };
}

// ───────────── router / render ─────────────
const VIEWS = { dashboard: viewDashboard, supplies: viewSupplies, power: viewPower, fleet: viewFleet, knowledge: viewKnowledge, log: viewLog };
let current = 'dashboard';

async function render() {
  current = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.v === current));
  const y = scrollY;
  try {
    const v = await VIEWS[current]();
    $('#app').innerHTML = `<header class="top"><h1>${esc(v.title)}</h1><span class="spacer"></span><span class="clock"></span></header>${v.html}`;
    tick(); scrollTo(0, y);
    if (v.after) await v.after();
  } catch (e) {
    $('#app').innerHTML = `<div class="card crit">โหลดข้อมูลไม่สำเร็จ: ${esc(e.message)}</div>`;
  }
}
function tick() {
  const c = $('.clock');
  if (c) c.textContent = new Date().toLocaleString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

async function run(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); await render(); } catch (e) { toast('ผิดพลาด: ' + e.message, true); }
}

// ───────────── events (delegated) ─────────────
const app = $('#app');

app.addEventListener('change', ev => {
  const el = ev.target;
  if (el.dataset.edit) {
    const v = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
    run(() => api(el.dataset.edit, 'PUT', { [el.dataset.field]: v }), 'บันทึกแล้ว');
  } else if (el.dataset.forecast) {
    run(() => api('/api/power/forecast', 'PUT', { day: el.dataset.forecast, condition: el.value }));
  } else if (el.dataset.act === 'log-filter') {
    logState.filter = el.value; render();
  } else if (el.name === 'kind' && el.form?.elements.unit && el.form.dataset.post === '/api/events') {
    el.form.elements.unit.value = EVUNIT[el.value] || '';
  }
});

app.addEventListener('input', ev => {
  if (ev.target.id !== 'kb-q') return;
  kb.q = ev.target.value;
  clearTimeout(kb.timer); kb.timer = setTimeout(refreshDocList, 250);
});


app.addEventListener('submit', ev => {
  const f = ev.target;
  if (!f.dataset.post) return;
  ev.preventDefault();
  const body = Object.fromEntries(new FormData(f));
  run(() => api(f.dataset.post, 'POST', body), f.dataset.toast);
});

app.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT' || (el.type === 'checkbox' && ev.target !== el)) return;
  const d = el.dataset;
  switch (d.act) {
    case 'phase':
      if (confirm('เปลี่ยนระดับสถานการณ์เป็นระดับ ' + d.level + ' ?')) run(() => api('/api/phase', 'PUT', { level: +d.level }), 'เปลี่ยนระดับแล้ว');
      break;
    case 'adjust': {
      const v = parseFloat($('#amt-' + d.id).value);
      if (!(v > 0)) return toast('ใส่จำนวนก่อน', true);
      run(() => api(`/api/supplies/${d.id}/adjust`, 'POST', { delta: v * +d.sign }), 'อัปเดตยอดแล้ว');
      break;
    }
    case 'del':
      if (d.noconfirm || confirm('ลบรายการนี้?')) run(() => api(d.url, 'DELETE'));
      break;
    case 'toggle-item': run(() => api(`/api/checklists/items/${d.id}/toggle`, 'POST', {})); break;
    case 'reset-checklist':
      if (confirm('ล้างเครื่องหมายทั้งหมดในระดับนี้?')) run(() => api(`/api/checklists/${d.level}/reset`, 'POST', {}), 'รีเซ็ตแล้ว');
      break;
    case 'log-phase': logState.phase = +d.level; render(); break;
    case 'open-doc': openDoc(d.path).catch(e => toast(e.message, true)); break;
    case 'reindex':
      api('/api/kb/reindex', 'POST', {}).then(r => { toast(`สแกนแล้ว: ${r.total} ไฟล์ (+${r.added} ~${r.updated} −${r.removed})`); refreshDocList(); })
        .catch(e => toast(e.message, true));
      break;
  }
});

window.addEventListener('hashchange', render);
// รีเฟรชแดชบอร์ดอัตโนมัติทุก 30 วิ เฉพาะเมื่อแท็บมองเห็นอยู่และไม่ได้กำลังพิมพ์ (ประหยัด CPU/แบต)
setInterval(() => {
  if (document.hidden) return;
  tick();
  if (current === 'dashboard' && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) render();
}, 30000);
render();
