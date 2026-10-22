// Browser client for the GIST library API (https://library.gist.ac.kr:8443).
// The page talks to the library directly (the API allows cross-origin calls), so it can be hosted
// statically, e.g. on GitHub Pages. When served by server.py on localhost it goes through that
// server's /lib pass-through instead, which keeps working even if the library ever restricts origins.

const Library = (() => {
  const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const BASE = LOCAL ? '/lib' : 'https://library.gist.ac.kr:8443';
  const FLOORS = [2, 3];
  const EARLY = 2;          // the library's 00:00–02:00 slots; shown as hours 24–25 of the evening before
  const MAX_PARALLEL = 6;   // at most this many library requests in flight
  const CACHE_MS = 30000;   // reuse a date's data this long when switching back to it

  class SessionExpired extends Error {}

  // The library's login token lives in sessionStorage: it survives reloads but ends with the tab.
  const store = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  async function call(path, body, token = store.get('libToken')) {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(body),
    });
    // The library answers an expired or invalid token with HTTP 500.
    if (!res.ok) throw token ? new SessionExpired('Session expired') : new Error(`Library error ${res.status}`);
    return (await res.json()).data;
  }

  // Run `fn` over `items` with at most MAX_PARALLEL calls at a time.
  async function pool(items, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, items.length) }, worker));
    return out;
  }

  const fmt = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const parse = s => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6));
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
  const addMonth = d => new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());

  async function login(id, password) {
    const data = await call('/hello/login', { userId: id, userPwd: password }, null);
    if (!data || !data.success) throw new Error('Wrong ID or password');
    const account = (await call('/hello/getAccount', {}, data.accessToken)).result;
    const user = { id, name: account.USER_NM || id, adminYn: account.LIBRARIAN_YN2 || 'N' };
    store.set('libToken', data.accessToken);
    store.set('libUser', user);
    cache.clear();
    return user;
  }

  function logout() {
    store.set('libToken', null);
    store.set('libUser', null);
    cache.clear();
  }

  const user = () => (store.get('libToken') ? store.get('libUser') : null);

  // Per-hour status for one room on one library date, mirroring the official site's logic.
  function roomHours(room, data) {
    const hours = {}, tips = {};
    for (const rng of [...(data.canAvailableRoomDates || []), ...(data.normalRoomGroupDates || [])]) {
      for (let h = rng.FROM_TIME; h <= rng.TO_TIME; h++) hours[h] = 'free';
    }
    const other = new Set((data.roomOther || []).map(x => x.RES_HOUR));
    const mine = new Set((data.room || []).map(x => x.RES_HOUR));
    for (const h of Object.keys(hours).map(Number)) {
      if (mine.has(h)) hours[h] = 'mine';
      else if (other.has(h)) hours[h] = 'taken';
      else {
        const na = (data.notAvailableRoomDates || []).find(n => n.FROM_TIME <= h && h < (n.TO_TIME || 24));
        if (na) { hours[h] = 'blocked'; if (na.REMARK) tips[h] = na.REMARK; }
        else if (room.ROOM_GROUP < 0) hours[h] = 'blocked';
      }
    }
    return { hours, tips };
  }

  const cache = new Map();  // resDate -> { at, day }

  // Availability for the evening-anchored day `resDate` (YYYYMMDD): its hours 08–23, plus 00–01 of the
  // next library date as hours 24–25.
  async function getDay(resDate, { fresh = false } = {}) {
    const hit = cache.get(resDate);
    if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.day;

    const today = new Date();
    const span = { START_DT_YYYYMMDD: fmt(today), END_DT_YYYYMMDD: fmt(addMonth(today)) };
    const info = await call('/work/getFacilityInfo', { ...span, RES_YYYYMMDD: resDate });
    const i = info.info;
    const lastDate = i.DATE_END.replaceAll('-', '');
    const rooms = info.facility.filter(f => FLOORS.includes(f.FLOOR));
    const next = addDays(resDate, 1);
    const dates = next <= lastDate ? [resDate, next] : [resDate];

    const jobs = dates.flatMap(d => rooms.map(room => ({ room, d })));
    const results = await pool(jobs, ({ room, d }) =>
      call('/work/getRoom', { ...span, ROOM_ID: room.ROOM_ID, RES_YYYYMMDD: d }).then(data => ({ room, d, data })));

    const out = {};
    for (const room of rooms) out[room.ROOM_ID] = { name: room.FAC_NM, bookable: room.ROOM_GROUP >= 0, hours: {}, tips: {} };
    const used = Object.fromEntries(dates.map(d => [d, 0]));
    let monthUsed = 0;
    for (const { room, d, data } of results) {
      const { hours, tips } = roomHours(room, data);
      const shift = d === resDate ? 0 : 24;
      for (const [hs, s] of Object.entries(hours)) {
        const h = +hs;
        if ((h >= EARLY) !== (d === resDate)) continue;  // same-day hours from resDate, early hours from the next date
        out[room.ROOM_ID].hours[h + shift] = s;
        if (tips[h]) out[room.ROOM_ID].tips[h + shift] = tips[h];
      }
      used[d] = data.infoCountDay || used[d];
      if (d === resDate) monthUsed = data.infoCount || monthUsed;
    }

    const mine = (await call('/work/getMyReservation', {
      START_DT: fmt(new Date(today.getFullYear(), today.getMonth(), 1)),
      END_DT: lastDate,
    })) || [];

    const day = {
      reservations: mine.filter(m => m.CANCEL_YN !== 'Y')
        .map(m => ({ date: m.RES_YYYYMMDD, room: m.ROOM_ID, hour: m.RES_HOUR, resId: m.RES_ID })),
      date: resDate,
      dateStart: i.DATE_START,
      dateEnd: i.DATE_END,
      dayLeft: Math.max(i.FAC_DUR4 - used[resDate], 0),
      dayLeftNext: next in used ? Math.max(i.FAC_DUR4 - used[next], 0) : 0,  // quota for hours 24–25
      monthLeft: Math.max(i.FAC_DUR5 - monthUsed, 0),
      rooms: out,
    };
    cache.set(resDate, { at: Date.now(), day });
    return day;
  }

  // Book hours of an evening-anchored day; hours 24–25 are the next library date's 00:00–02:00.
  async function reserve(roomId, resDate, hours) {
    cache.clear();
    const u = user();
    const booked = [];
    for (const h of [...hours].sort((a, b) => a - b)) {
      const [d, lh] = h >= 24 ? [addDays(resDate, 1), h - 24] : [resDate, h];
      const rs = await call('/work/makeFacilityreservation', {
        ROOM_ID: roomId, CREATE_ID: u.id, REMARK: '', RES_YYYYMMDD: d, RES_HOUR: lh, ADMIN_YN: u.adminYn,
      });
      if (!rs) return { booked, failed: h, message: `${String(lh).padStart(2, '0')}:00 is already reserved` };
      booked.push(h);
    }
    return { booked };
  }

  // Latest hour first, so no cancellation ever leaves a 1-hour gap inside a run of bookings.
  async function cancel(items) {
    cache.clear();
    const cancelled = [], failed = [];
    const order = [...items].sort((a, b) => b.room - a.room || b.date.localeCompare(a.date) || b.hour - a.hour);
    for (const it of order) {
      const rs = await call('/work/cancelFacilityreservation', {
        ROOM_ID: it.room, RES_YYYYMMDD: it.date, RES_HOUR: it.hour, RES_ID: it.resId,
      });
      (rs ? cancelled : failed).push(it);
    }
    return { cancelled, failed };
  }

  return { login, logout, user, getDay, reserve, cancel, SessionExpired };
})();
