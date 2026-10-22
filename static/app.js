const $ = s => document.querySelector(s);
const SVGNS = 'http://www.w3.org/2000/svg';

const state = {
  date: localDate(new Date()),
  day: null,        // /api/day response
  hours: [],        // every hour slot offered that day, ascending
  sel: null,        // [anchorIdx, endIdx] into state.hours
  selected: null,   // room id shown in the detail panel
  sub: null,        // Set of hours picked on the detail strip; null = whole window
  subAnchor: null,  // last hour clicked on the strip, for Shift+click
  picked: new Set(),// keys of "My reservations" rows ticked for cancelling
  maxDate: null,    // last bookable date (from the server)
  calMonth: null,   // first day of the month shown in the date picker
  user: null,       // { id, name } of the logged-in library account
  dragging: false,  // a clock or strip drag is in progress (pauses the rolling refresh)
};

function localDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Hours of a day run 2..25: the library's 00:00–02:00 slots count as the end of the evening
// before, as hours 24 and 25 (booked on the next library date).
const pad = h => String(h % 24).padStart(2, '0');
const ymd = iso => iso.replaceAll('-', '');
const DAY_HOURS = Array.from({ length: 24 }, (_, i) => i + 2);
const clockHour = p => (p < 2 ? p + 24 : p);  // clock position 0..23 -> hour of the day

function fmtRanges(hs) {
  const parts = [];
  for (let i = 0; i < hs.length; i++) {
    let j = i;
    while (j + 1 < hs.length && hs[j + 1] === hs[j] + 1) j++;
    parts.push(`${pad(hs[i])}:00 – ${pad(hs[j] + 1)}:00`);
    i = j;
  }
  return parts.join(', ');
}

const roomLabel = id => `Room ${id}`;

// ---- status helpers --------------------------------------------------------

// An hour slot is past once it has started (the official site's rule). Hours 24–25 fall on the next date.
function isPast(h) {
  const [y, m, d] = state.date.split('-').map(Number);
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return new Date(y, m - 1, d, h) <= now;
}

// Hours that don't fit the daily quotas (hours 24–25 count against the next date) or the monthly one.
function quotaProblem(hs) {
  const { dayLeft, dayLeftNext, monthLeft } = state.day;
  const next = hs.filter(h => h >= 24).length;
  if (hs.length - next > dayLeft) return `Only ${dayLeft}h left on this day`;
  if (next > dayLeftNext) return `Only ${dayLeftNext}h left after midnight`;
  if (hs.length > monthLeft) return `Only ${monthLeft}h left this month`;
  return null;
}

function hourStatus(room, h) {
  if (!(h in room.hours)) return 'off';
  if (isPast(h)) return 'past';
  return room.hours[h];
}

function selectedHours() {
  if (!state.sel) return [];
  const [a, b] = state.sel;
  return state.hours.slice(Math.min(a, b), Math.max(a, b) + 1);
}

function windowState(room) {
  if (!room.bookable) return 'locked';
  const st = selectedHours().map(h => hourStatus(room, h));
  if (!st.length) return 'busy';
  if (st.every(s => s === 'free')) return 'free';
  if (st.includes('mine')) return 'mine';
  if (st.includes('free')) return 'partial';
  return 'busy';
}

const bookableRooms = () => Object.values(state.day.rooms).filter(r => r.bookable);

// Nested selection inside the clock window, made on the detail strip (defaults to the whole window).
function subHours() {
  const win = selectedHours();
  return state.sub ? win.filter(h => state.sub.has(h)) : defaultSub();
}

// Earliest run of consecutive free hours in the window, cut to what the daily/monthly quota allows.
// For a fully free (green) room that is the start of the window; for a yellow room, its first free stretch.
function defaultSub() {
  const room = state.day && state.day.rooms[state.selected];
  const win = selectedHours();
  if (!room || !room.bookable) return win;
  const run = [];
  for (const h of win) {
    if (hourStatus(room, h) === 'free' && (!run.length || h === run[run.length - 1] + 1)) run.push(h);
    else if (run.length) break;
  }
  let n = 0;
  while (n < run.length && !quotaProblem(run.slice(0, n + 1))) n++;
  return run.slice(0, n);
}

// 24 cells, 02:00 to 02:00; the selected window is underlined, the big strip also outlines the nested selection.
function stripHtml(room, big) {
  const win = new Set(selectedHours());
  const sub = new Set(big ? subHours() : []);
  const cells = DAY_HOURS.map(h => {
    const s = hourStatus(room, h);
    const cls = [s, win.has(h) ? 'inwin' : '', sub.has(h) ? 'sub' : ''].join(' ');
    const label = h % 6 === 0 ? ` data-h="${pad(h)}"` : '';
    const title = `${pad(h)}:00 ${room.tips[h] || s}`;
    return `<span class="${cls}" data-hour="${h}"${label} title="${title}"></span>`;
  }).join('');
  // One frame around each run of consecutive picked hours, instead of a border per cell.
  let frames = '';
  for (let i = 0; i < DAY_HOURS.length; i++) {
    if (!sub.has(DAY_HOURS[i])) continue;
    let n = 1;
    while (sub.has(DAY_HOURS[i + n])) n++;
    frames += `<i class="sub-run" style="--i:${i};--n:${n}"></i>`;
    i += n - 1;
  }
  return `<div class="strip${big ? ' big' : ''}">${cells}${frames}</div>`;
}

// ---- map rendering ---------------------------------------------------------

function el(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

function drawMap() {
  const svg = $('#map');
  svg.setAttribute('viewBox', MAP.viewBox);
  const p = el('pattern', { id: `hatch-locked`, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, el('defs', {}, svg));
  el('rect', { width: 5, height: 5, style: 'fill:var(--locked)' }, p);
  el('line', { x1: 0, y1: 0, x2: 0, y2: 5, style: 'stroke:var(--hatch);stroke-width:1.2' }, p);
  el('path', { d: MAP.exterior, class: 'exterior' }, svg);
  for (const [x, y, w, h] of MAP.panels) {
    el('rect', { x, y, width: w, height: h, rx: 8, class: 'panel' }, svg);
  }
  for (const [x, y, text, cls = ''] of MAP.labels) {
    el('text', { x, y, class: `label ${cls}` }, svg).textContent = text;
  }
  for (const r of MAP.rooms) {
    const g = el('g', { class: 'room', 'data-id': r.id }, svg);
    el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 2 }, g);
    el('text', { x: r.x + r.w / 2, y: r.y + r.h / 2 }, g).textContent = r.id;
    g.addEventListener('click', () => onRoomClick(r.id));
    g.addEventListener('pointerenter', e => showTip(r.id, e));
    g.addEventListener('pointermove', moveTip);
    g.addEventListener('pointerleave', hideTip);
  }
}

function paintRooms() {
  document.querySelectorAll('svg .room').forEach(g => {
    const id = g.dataset.id;
    const room = state.day && state.day.rooms[id];
    let cls = 'room';
    if (room) cls += ' ' + windowState(room);
    if (String(state.selected) === id) cls += ' selected';
    g.setAttribute('class', cls);
  });
}

// ---- tooltip & detail ------------------------------------------------------

function showTip(id, e) {
  const room = state.day && state.day.rooms[id];
  if (!room) return;
  const tip = $('#tooltip');
  tip.innerHTML = `${stripHtml(room)}`;
  tip.hidden = false;
  moveTip(e);
}

const hideTip = () => { $('#tooltip').hidden = true; };

// Backstop for missed pointerleave events (overlays appearing under a still mouse, pointer capture, …).
function setupTip() {
  document.addEventListener('pointermove', e => { if (!e.target.closest('svg .room')) hideTip(); });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('svg .room')) hideTip(); });
  document.documentElement.addEventListener('mouseleave', hideTip);
  window.addEventListener('blur', hideTip);
}

function moveTip(e) {
  const tip = $('#tooltip');
  tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px';
  tip.style.top = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8) + 'px';
}

function renderDetail() {
  const box = $('#detail');
  const room = state.day && state.selected && state.day.rooms[state.selected];
  if (!room) { box.hidden = true; return; }
  const hs = subHours();
  const problem = bookProblem(room, hs);
  const reading = problem ?? `${fmtRanges(hs)} · ${hs.length}h`;
  $('#detail-body').innerHTML = `
    <div class="detail-head">
      <strong>${roomLabel(state.selected)}</strong>
      <span class="detail-actions">
        <span class="${problem === null ? '' : 'muted'}">${reading}</span>
        <button type="button" id="detail-close" aria-label="Close">×</button>
      </span>
    </div>
    ${stripHtml(room, true)}`;
  box.hidden = false;
  $('#reserve').classList.toggle('show', problem === null);
}

// Click/drag picks a range, Shift+click extends from the last click, Ctrl/⌘ adds or removes hours.
function setupDetail() {
  const box = $('#detail');
  let drag = null;  // { anchor, base, add }
  const hourAt = e => {
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const cell = t && t.closest('#detail .strip span');
    const h = cell ? Number(cell.dataset.hour) : null;
    return h !== null && state.hours.includes(h) ? h : null;
  };
  const apply = h => {
    const [a, b] = [Math.min(drag.anchor, h), Math.max(drag.anchor, h)];
    const sub = new Set(drag.base);
    for (const x of state.hours) if (x >= a && x <= b) drag.add ? sub.add(x) : sub.delete(x);
    state.sub = sub;
    // Picking outside the clock window widens the window to cover the pick.
    const win = selectedHours();
    const lo = Math.min(win[0], ...sub), hi = Math.max(win[win.length - 1], ...sub);
    if (lo < win[0] || hi > win[win.length - 1]) {
      state.sel = [state.hours.indexOf(lo), state.hours.indexOf(hi)];
      render();
    } else {
      renderDetail();
    }
  };
  box.addEventListener('pointerdown', e => {
    const h = hourAt(e);
    if (h === null) return;
    e.preventDefault();  // no text selection while dragging
    const current = new Set(subHours());
    if (e.shiftKey && state.subAnchor !== null) {
      drag = { anchor: state.subAnchor, base: new Set(), add: true };
    } else if (e.ctrlKey || e.metaKey) {
      drag = { anchor: h, base: current, add: !current.has(h) };
      state.subAnchor = h;
    } else {
      drag = { anchor: h, base: new Set(), add: true };
      state.subAnchor = h;
    }
    state.dragging = true;
    box.setPointerCapture(e.pointerId);
    apply(h);
  });
  box.addEventListener('pointermove', e => {
    if (!drag) return;
    const h = hourAt(e);
    if (h !== null) apply(h);
  });
  const end = () => { drag = null; state.dragging = false; };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('click', e => {
    if (e.target.closest('#detail-close')) { state.selected = null; render(); }
  });
  $('#reserve').addEventListener('click', () => reserve(state.selected, subHours()));
}

// ---- 24h clock picker ------------------------------------------------------

const R_OUT = 118, R_IN = 78;

function polar(r, h) {
  const a = (h * 15 - 90) * Math.PI / 180;
  return `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
}

function sector(h, r0, r1) {
  return `M${polar(r1, h)} A${r1} ${r1} 0 0 1 ${polar(r1, h + 1)} L${polar(r0, h + 1)} A${r0} ${r0} 0 0 0 ${polar(r0, h)} Z`;
}

function renderClock() {
  const rooms = bookableRooms();
  const win = new Set(selectedHours());
  let html = '';
  for (let p = 0; p < 24; p++) {  // clock position; 0 and 1 are the hours after midnight (24, 25)
    const h = clockHour(p);
    const [lx, ly] = polar((R_IN + R_OUT) / 2, p + 0.5).split(' ');
    const major = p % 6 === 0 ? ' major' : '';
    if (!state.hours.includes(h)) {
      html += `<path class="seg off" d="${sector(p, R_IN, R_OUT)}"/>`;
      html += `<text class="tick${major}" x="${lx}" y="${ly}">${p}</text>`;
      continue;
    }
    const n = rooms.filter(r => hourStatus(r, h) === 'free').length;
    const sel = win.has(h) ? ' sel' : '';
    const past = isPast(h) ? ' past' : '';
    html += `<path class="seg${sel}${past}" d="${sector(p, R_IN, R_OUT)}"><title>${pad(h)}:00 · ${n} rooms free</title></path>`;
    html += `<text class="num${major}${sel ? ' light' : ''}" x="${lx}" y="${ly}">${p}</text>`;
    if (n) {
      const opacity = (0.15 + 0.85 * n / Math.max(rooms.length, 1)).toFixed(2);
      html += `<path class="avail${past}" d="${sector(p, R_IN - 11, R_IN - 4)}" style="opacity:${opacity}"/>`;
    }
  }
  const hs = selectedHours();
  if (hs.length) {
    const nFree = rooms.filter(r => windowState(r) === 'free').length;
    html += `<text class="c1" x="0" y="-4">${pad(hs[0])}:00–${pad(hs[hs.length - 1] + 1)}:00</text>`;
    html += `<text class="c2" x="0" y="14">${hs.length}h · ${nFree} rooms free</text>`;
  }
  $('#clock').innerHTML = html;
}

function setupClock() {
  const svg = $('#clock');
  let anchor = null;
  const at = e => {
    const rect = svg.getBoundingClientRect();
    const k = 270 / rect.width;
    const dx = (e.clientX - rect.left - rect.width / 2) * k;
    const dy = (e.clientY - rect.top - rect.height / 2) * k;
    const deg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    return { idx: state.hours.indexOf(clockHour(Math.floor(deg / 15))), dist: Math.hypot(dx, dy) };
  };
  svg.addEventListener('pointerdown', e => {
    const { idx, dist } = at(e);
    if (!state.day || idx < 0 || dist < R_IN - 25) return;
    anchor = idx;
    state.dragging = true;
    state.sel = [idx, idx];
    state.sub = state.subAnchor = null;
    svg.setPointerCapture(e.pointerId);
    render();
  });
  svg.addEventListener('pointermove', e => {
    if (anchor === null) return;
    const { idx } = at(e);
    if (idx >= 0 && idx !== state.sel[1]) { state.sel = [anchor, idx]; state.sub = state.subAnchor = null; render(); }
  });
  const end = () => { anchor = null; state.dragging = false; };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}

function defaultSelection(prevHours) {
  const keep = prevHours.map(h => state.hours.indexOf(h)).filter(i => i >= 0);
  if (keep.length) return [keep[0], keep[keep.length - 1]];
  let i = state.hours.findIndex(h => !isPast(h) && h >= 8);
  if (i < 0) i = state.hours.length - 1;
  return [i, Math.min(i + 1, state.hours.length - 1)];
}

// ---- booking ---------------------------------------------------------------

function onRoomClick(id) {
  state.selected = id;
  state.sub = state.subAnchor = null;
  render();
}

// Why `hs` can't be booked in `room`, or null if it can.
function bookProblem(room, hs) {
  if (!room.bookable) return 'Not bookable for your account';
  if (!hs.length) {
    if (state.day.monthLeft <= 0) return 'No hours left this month';
    if (state.day.dayLeft <= 0 && state.day.dayLeftNext <= 0) return 'No hours left on this day';
    return 'Drag on the strip to pick free hours';
  }
  if (!hs.every(h => hourStatus(room, h) === 'free')) return 'Drag on the strip to pick free hours';
  const quota = quotaProblem(hs);
  if (quota) return quota;
  // The library forbids leaving exactly one hour between two of your bookings in a room.
  const mine = new Set([...hs, ...state.hours.filter(h => room.hours[h] === 'mine')]);
  for (const h of mine) {
    if (mine.has(h + 2) && !mine.has(h + 1)) return `A 1-hour gap at ${pad(h + 1)}:00 is not allowed`;
  }
  return null;
}

// The library token expired (it lasts about 13 h): drop it and ask for a fresh login.
function handleExpired(err) {
  if (!(err instanceof Library.SessionExpired)) return false;
  Library.logout();
  setUser(null);
  $('#login-error').textContent = 'Session expired. Please log in again.';
  return true;
}

// A single blocking spinner overlay; nested requests keep it up until the last one finishes.
let busyCount = 0;
function busy(on) {
  busyCount += on ? 1 : -1;
  $('#busy').hidden = busyCount === 0;
  if (on) hideTip();
}

async function reserve(id, hs) {
  busy(true);
  try {
    const res = await Library.reserve(id, ymd(state.date), hs);
    if (res.message) {
      const ok = res.booked.length ? `Booked ${fmtRanges(res.booked)}.` : 'Nothing booked.';
      alert(`${ok} Stopped: ${res.message}.`);
    }
  } catch (err) {
    if (handleExpired(err)) return busy(false);
    alert('Reservation failed: ' + err.message);
  }
  await load();
  busy(false);
}

// ---- loading ---------------------------------------------------------------

function setStatus(text, isError) {
  const s = $('#status');
  s.textContent = text;
  s.className = 'status' + (isError ? ' error' : '');
}

let loadSeq = 0;
let failures = 0;  // consecutive failed loads, for backing off the rolling refresh

// `silent` is the rolling refresh: no blocking overlay, and the room / window / strip selections are kept.
// `fresh` skips the library client's 30 s per-date cache.
async function load({ silent = false, fresh = false } = {}) {
  const seq = ++loadSeq;  // only the latest request may update the page
  const prev = state.day ? selectedHours() : [];
  if (!silent) setStatus('Loading availability…');
  silent ? $('#refresh').classList.add('spinning') : busy(true);
  try {
    const day = await Library.getDay(ymd(state.date), { fresh });
    if (seq !== loadSeq) return;
    failures = 0;
    state.day = day;
    if (!silent) hideTip();  // its contents describe the old data
    state.hours = [...new Set(Object.values(day.rooms).flatMap(r => Object.keys(r.hours).map(Number)))].sort((a, b) => a - b);
    state.sel = defaultSelection(prev);
    if (!silent) state.sub = state.subAnchor = null;
    state.maxDate = day.dateEnd;
    $('#quota').textContent = `Left: ${day.dayLeft}h on this day · ${day.monthLeft}h this month`;
    setStatus(`Updated ${new Date().toLocaleTimeString()}`);
    render();
  } catch (err) {
    if (!handleExpired(err)) {
      failures++;
      setStatus('Could not load availability: ' + err.message, true);
    }
  } finally {
    silent ? $('#refresh').classList.remove('spinning') : busy(false);
  }
}

// ---- rolling refresh, throttled to go easy on the library's server ---------
// Every 60 s while the tab is visible and in use; backs off (up to 5 min) after failures,
// pauses after 10 min without input, and never runs during a drag or another request.
const REFRESH_MS = 60000;
const MAX_BACKOFF_MS = 5 * 60000;
const IDLE_MS = 10 * 60000;
const MANUAL_GAP_MS = 5000;  // minimum time between manual refreshes
let refreshTimer = null;
let lastInput = Date.now();
let idlePaused = false;

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(autoRefresh, Math.min(REFRESH_MS * 2 ** failures, MAX_BACKOFF_MS));
}

async function autoRefresh() {
  if (Date.now() - lastInput > IDLE_MS) {
    idlePaused = true;
    setStatus('Auto-refresh paused while idle');
    return;  // resumes on the next input
  }
  if (state.user && !document.hidden && busyCount === 0 && !state.dragging) await load({ silent: true, fresh: true });
  scheduleRefresh();
}

function setupRefresh() {
  const markInput = () => {
    lastInput = Date.now();
    if (idlePaused) { idlePaused = false; autoRefresh(); }
  };
  ['pointerdown', 'keydown', 'wheel', 'pointermove'].forEach(t => document.addEventListener(t, markInput, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user) autoRefresh(); });
  $('#refresh').addEventListener('click', () => {
    const btn = $('#refresh');
    btn.disabled = true;
    setTimeout(() => { btn.disabled = false; }, MANUAL_GAP_MS);
    load({ fresh: true }).then(scheduleRefresh);
  });
  scheduleRefresh();
}

// ---- login -----------------------------------------------------------------

function setUser(user) {
  state.user = user;
  const auth = $('#auth');
  if (user) {
    auth.innerHTML = `<span class="who"><strong>${user.name}</strong> <span class="muted">${user.id}</span></span>
      <button type="button" id="logout">Log out</button>`;
    $('#login-form').reset();
    $('#login-error').textContent = '';
  } else {
    auth.innerHTML = '';
    $('#quota').textContent = '';
    setStatus('');
    // Drop the previous account's data so nothing of it shows behind the blur.
    state.day = null;
    state.selected = null;
    state.picked.clear();
    paintRooms();
    $('#detail').hidden = true;
    $('#clock').innerHTML = '';
    $('#mine').innerHTML = '';
    $('#cancel-picked').hidden = true;
  }
  $('.layout').classList.toggle('blurred', !user);
  $('#gate').hidden = !!user;
  $('#refresh').hidden = !user;
  if (!user) $('#login-form [name=id]').focus();
}

function setupAuth() {
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.target);
    busy(true);
    try {
      setUser(await Library.login(form.get('id'), form.get('password')));
      await load();
    } catch (err) {
      $('#login-error').textContent = err.message;
    } finally {
      busy(false);
    }
  });
  $('#auth').addEventListener('click', async e => {
    if (!e.target.closest('#logout')) return;
    Library.logout();
    setUser(null);
  });
}

// ---- my reservations -------------------------------------------------------

// Contiguous hours in the same room on the same day become one row. Bookings at 00:00–02:00 are shown
// on the evening before as hours 24–25; the items keep the library's own date/hour for cancelling.
function mineRows() {
  const view = state.day.reservations.map(r => {
    if (r.hour >= 2) return { ...r, vdate: r.date, vhour: r.hour };
    const d = new Date(+r.date.slice(0, 4), +r.date.slice(4, 6) - 1, +r.date.slice(6) - 1);
    return { ...r, vdate: ymd(localDate(d)), vhour: r.hour + 24 };
  }).sort((a, b) => a.vdate.localeCompare(b.vdate) || a.room - b.room || a.vhour - b.vhour);
  const rows = [];
  for (const r of view) {
    const last = rows[rows.length - 1];
    if (last && last.date === r.vdate && last.room === r.room && last.items[last.items.length - 1].vhour === r.vhour - 1) {
      last.items.push(r);
    } else {
      rows.push({ key: `${r.date}|${r.room}|${r.hour}`, date: r.vdate, room: r.room, items: [r] });
    }
  }
  // Hours that have started or passed can't be cancelled (same rule as the official site).
  const now = new Date();
  const today = ymd(localDate(now));
  for (const row of rows) {
    row.hours = row.items.map(i => i.vhour);
    row.cancellable = row.items.filter(i => i.date > today || (i.date === today && i.hour > now.getHours()));
    row.today = row.date === today;
  }
  return rows;
}

function renderMine() {
  const rows = mineRows();
  const keys = new Set(rows.filter(r => r.cancellable.length).map(r => r.key));
  state.picked = new Set([...state.picked].filter(k => keys.has(k)));
  $('#cancel-picked').hidden = !state.picked.size;
  if (!rows.length) {
    $('#mine').innerHTML = '<p class="muted empty">No reservations this month.</p>';
    return;
  }
  const body = rows.map(r => {
    const can = keys.has(r.key);
    const picked = state.picked.has(r.key);
    const cls = [can ? 'can' : 'past', r.today ? 'today' : '', picked ? 'picked' : ''].join(' ');
    const date = `${r.date.slice(4, 6)}/${r.date.slice(6)}`;
    const box = `<input type="checkbox" ${picked ? 'checked' : ''} ${can ? '' : 'disabled'} tabindex="-1">`;
    return `<tr class="${cls}" data-key="${r.key}" title="${roomLabel(r.room)}">
      <td>${box}</td><td>${date}</td><td>${r.room}</td><td>${fmtRanges(r.hours)}</td></tr>`;
  }).join('');
  $('#mine').innerHTML = `
    <table><thead><tr><th></th><th>Date</th><th>Room</th><th>Time</th></tr></thead><tbody>${body}</tbody></table>`;
}

function setupMine() {
  $('#cancel-picked').addEventListener('click', cancelPicked);
  $('#mine').addEventListener('click', e => {
    const tr = e.target.closest('tr.can');
    if (!tr) return;
    const key = tr.dataset.key;
    state.picked.has(key) ? state.picked.delete(key) : state.picked.add(key);
    renderMine();
  });
}

async function cancelPicked() {
  const rows = mineRows().filter(r => state.picked.has(r.key));
  const lines = rows.map(r => `${r.date.slice(4, 6)}/${r.date.slice(6)}  Room ${r.room}  ${fmtRanges(r.cancellable.map(i => i.vhour))}`);
  if (!confirm(`Cancel ${rows.length} reservation${rows.length > 1 ? 's' : ''}?\n\n${lines.join('\n')}`)) return;
  busy(true);
  try {
    const items = rows.flatMap(r => r.cancellable).map(({ date, room, hour, resId }) => ({ date, room, hour, resId }));
    const res = await Library.cancel(items);
    if (res.failed.length) {
      alert('Could not cancel: ' + res.failed.map(i => `Room ${i.room} ${pad(i.hour)}:00 on ${i.date}`).join(', '));
    }
  } catch (err) {
    if (handleExpired(err)) return busy(false);
    alert('Cancellation failed: ' + err.message);
  }
  state.picked.clear();
  await load();
  busy(false);
}

// ---- date picker (Sunday-first calendar) -----------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parseISO = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };

// Before 02:00 the previous evening is still bookable (its hours 24–25), so allow picking it.
function minDate() {
  const now = new Date();
  if (now.getHours() < 2) now.setDate(now.getDate() - 1);
  return localDate(now);
}

function renderDateButton() {
  $('#date-btn').textContent = `${state.date} (${WEEKDAYS[parseISO(state.date).getDay()]})`;
}

function renderCal() {
  const first = state.calMonth;
  const y = first.getFullYear(), m = first.getMonth();
  const min = minDate();
  const max = state.maxDate || min;
  const prevOk = localDate(new Date(y, m, 0)) >= min;
  const nextOk = localDate(new Date(y, m + 1, 1)) <= max;
  let cells = WEEKDAYS.map(w => `<span class="wd">${w.slice(0, 2)}</span>`).join('');
  cells += '<span></span>'.repeat(first.getDay());
  const days = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const iso = localDate(new Date(y, m, d));
    const cls = [iso === state.date ? 'sel' : '', iso === localDate(new Date()) ? 'today' : '', `dow${new Date(y, m, d).getDay()}`].join(' ');
    const off = iso < min || iso > max ? 'disabled' : '';
    cells += `<button type="button" class="${cls}" data-iso="${iso}" ${off}>${d}</button>`;
  }
  $('#cal').innerHTML = `
    <div class="cal-head">
      <button type="button" data-nav="-1" ${prevOk ? '' : 'disabled'} aria-label="Previous month">‹</button>
      <strong>${first.toLocaleString('en', { month: 'long' })} ${y}</strong>
      <button type="button" data-nav="1" ${nextOk ? '' : 'disabled'} aria-label="Next month">›</button>
    </div>
    <div class="cal-grid">${cells}</div>`;
}

function setupDatePicker() {
  const cal = $('#cal');
  $('#date-btn').addEventListener('click', () => {
    if (!cal.hidden) { cal.hidden = true; return; }
    const d = parseISO(state.date);
    state.calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    renderCal();
    cal.hidden = false;
  });
  cal.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + Number(nav.dataset.nav), 1);
      return renderCal();
    }
    const day = e.target.closest('[data-iso]');
    if (!day) return;
    cal.hidden = true;
    if (day.dataset.iso === state.date) return;
    state.date = day.dataset.iso;
    renderDateButton();
    load();
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.datepick')) cal.hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cal.hidden = true; });
}

function render() {
  if (!state.day) return;
  renderClock();
  paintRooms();
  renderDetail();
  renderMine();
}

drawMap();
setupClock();
setupDetail();
setupMine();
setupDatePicker();
setupAuth();
setupTip();
setupRefresh();
renderDateButton();
setUser(Library.user());
if (state.user) load();
