/* Her day: when one day ends and the next begins.
 *
 * Four ways, picked per phone in Settings → Her day:
 *   midnight   the default — calendar days
 *   fixed      a time of your choosing, such as 6:00am
 *   sunrise    worked out each day for where you are
 *   subuh      dawn (Fajr), by a chosen calculation method
 *
 * Whichever it is, an entry counts on the day it started — a sleep in full
 * — so a 10pm–3am sleep is one sleep on one day, never split in two.
 *
 * Sunrise and Subuh are worked out on the phone from a location given once,
 * rounded to about a kilometre and kept on this phone only. Until it has
 * one, or on a day the sun doesn't get that low (polar summer), the day
 * starts at the set time instead.
 *
 * Everything that adds up "a day" goes through here: the Today tiles and
 * 7-day charts on Home, Today on Now, and the day groups in History.
 */
const Day = (() => {
  const RAD = Math.PI / 180;
  const DAY_MS = 86400000;

  /* ── the sun ─────────────────────────────────────────────── */
  /* The NOAA-derived formulas used by SunCalc (Vladimir Agafonkin, BSD),
   * good to about a minute — far finer than a day boundary needs. */

  /* Subuh begins when the sun is this far below the horizon before dawn.
   * Authorities differ; these are the common ones. */
  const SUBUH = {
    jakim:  { angle: 20,   label: 'Malaysia, Singapore (20°)' },
    mwl:    { angle: 18,   label: 'Muslim World League (18°)' },
    makkah: { angle: 18.5, label: 'Umm al-Qura, Makkah (18.5°)' },
    egypt:  { angle: 19.5, label: 'Egypt (19.5°)' },
    isna:   { angle: 15,   label: 'North America, ISNA (15°)' },
  };
  const J1970 = 2440588, J2000 = 2451545, J0 = 0.0009;
  const OBLIQUITY = RAD * 23.4397;
  const toDays = ms => ms / DAY_MS - 0.5 + J1970 - J2000;
  const fromJulian = j => (j + 0.5 - J1970) * DAY_MS;

  /** When the sun reaches `altitude` degrees (rising) on the local calendar
   *  day containing `ms` — sunrise at -0.833°, Subuh at -20° or so — or null
   *  when it doesn't get there that day. */
  function sunAt(ms, lat, lon, altitude) {
    const noon = new Date(ms); noon.setHours(12, 0, 0, 0);
    const lw = RAD * -lon, phi = RAD * lat;
    const n = Math.round(toDays(noon.getTime()) - J0 - lw / (2 * Math.PI));
    const ds = J0 + lw / (2 * Math.PI) + n;
    const M = RAD * (357.5291 + 0.98560028 * ds);
    const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + RAD * 102.9372 + Math.PI;
    const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
    const transit = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const cosW = (Math.sin(RAD * altitude) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    if (!(cosW >= -1 && cosW <= 1)) return null;
    return Math.round(fromJulian(transit - Math.acos(cosW) / (2 * Math.PI)));
  }

  const sunrise = (ms, lat, lon) => sunAt(ms, lat, lon, -0.833);
  const subuh = (ms, lat, lon, method = 'jakim') => sunAt(ms, lat, lon, -(SUBUH[method] || SUBUH.jakim).angle);

  /* ── where each day starts ───────────────────────────────── */
  let cache = new Map(), cacheFor = '';

  const MODES = ['midnight', 'fixed', 'sunrise', 'subuh'];

  function setup() {
    const s = Store.settings();
    const mode = MODES.includes(s.dayStartMode) ? s.dayStartMode : 'midnight';
    const [h, m] = String(s.dayStartTime || '06:00').split(':').map(Number);
    const sun = mode === 'sunrise' || mode === 'subuh';
    return {
      mode,
      place: sun && validPlace(s.place) ? s.place : null,
      method: mode === 'subuh' && SUBUH[s.subuhMethod] ? s.subuhMethod : 'jakim',
      hour: mode === 'midnight' ? 0 : Number.isFinite(h) ? h : 6,
      minute: mode === 'midnight' ? 0 : Number.isFinite(m) ? m : 0,
    };
  }

  function validPlace(p) {
    return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
      Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
  }

  /** When the day starts on the local calendar date containing `ms`, and
   *  what that is: 'midnight', 'fixed', 'sunrise' or 'subuh'. */
  function boundary(ms) {
    const cfg = setup();
    const sig = JSON.stringify(cfg);
    if (sig !== cacheFor) { cache = new Map(); cacheFor = sig; }
    const d = new Date(ms);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!cache.has(key)) {
      const sun = !cfg.place ? null : cfg.mode === 'subuh'
        ? subuh(ms, cfg.place.lat, cfg.place.lon, cfg.method)
        : sunrise(ms, cfg.place.lat, cfg.place.lon);
      const fixed = new Date(ms); fixed.setHours(cfg.hour, cfg.minute, 0, 0);
      cache.set(key, sun != null ? { at: sun, kind: cfg.mode }
        : { at: fixed.getTime(), kind: cfg.mode === 'midnight' ? 'midnight' : 'fixed' });
    }
    return cache.get(key);
  }

  const shift = (ms, days) => { const d = new Date(ms); d.setDate(d.getDate() + days); return d.getTime(); };

  /** The start of the day `ms` falls in. */
  function startOf(ms) {
    const b = boundary(ms).at;
    return ms >= b ? b : boundary(shift(ms, -1)).at;
  }

  /** The start of the day after the one starting at `start`. */
  const next = start => boundary(shift(start, 1)).at;

  /** The start of the current day (k = 0), or of the day k days before it. */
  const start = (k = 0) => boundary(shift(startOf(Date.now()), -k)).at;

  /** One key per day, for grouping. */
  function key(ms) {
    const d = new Date(startOf(ms));
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  /** "Today", "Yesterday", "Thursday", "Mon, Oct 20" — counted in her days,
   *  so at 3am the night so far is still Today. */
  function label(ms) {
    const day = new Date(startOf(ms)); day.setHours(0, 0, 0, 0);
    const today = new Date(start(0)); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - day) / DAY_MS);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return day.toLocaleDateString([], { weekday: 'long' });
    return day.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  /** How today began: when, and what at — 'midnight', 'fixed', 'sunrise'
   *  or 'subuh'. */
  function today() {
    const at = start(0);
    return { at, kind: boundary(at).kind };
  }

  /* ── adding a day up ─────────────────────────────────────── */
  /** Each tracker's totals for entries that started in [from, to). A sleep
   *  is counted whole on the day it started; `cut` stops it short at a time
   *  of day, so a past day can be compared with today so far. */
  function totals(from, to, cut = Infinity) {
    const out = {};
    for (const r of Store.all()) {
      if (r.at < from || r.at >= to) continue;
      Features.get(r.type)?.tally?.(r, out, { cut });
    }
    return out;
  }

  /* ── where you are ────────────────────────────────────────── */
  const canLocate = () => 'geolocation' in navigator;

  /** Ask the phone where it is, once, and keep it — rounded to about a
   *  kilometre, which moves sunrise by seconds — on this phone only.
   *  Resolves with the place, or rejects with something to say. */
  function locate() {
    return new Promise((resolve, reject) => {
      if (!canLocate()) { reject(new Error("This phone can't share its location — pick a set time instead.")); return; }
      navigator.geolocation.getCurrentPosition(pos => {
        const round = v => Math.round(v * 100) / 100;
        const place = { lat: round(pos.coords.latitude), lon: round(pos.coords.longitude) };
        Store.saveSettings({ place });
        resolve(place);
      }, err => reject(new Error(err.code === 1
        ? 'Location is off for this app. Allow it in your phone settings, or pick a set time.'
        : "Couldn't find where you are just now. Try again, or pick a set time.")),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 6 * 3600000 });
    });
  }

  return { SUBUH, sunrise, subuh, startOf, start, next, key, label, today, totals, validPlace, canLocate, locate };
})();
