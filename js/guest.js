/* Guests: a babysitter who sees the log for a while, then doesn't.
 *
 * Two sides of one feature.
 *
 * On a family phone, Settings → Babysitter makes a guest link: a token of
 * its own, stored on the server against this household with a name, an
 * end time and whether they may log. The pairing code never leaves the
 * family. "Remove" revokes the token on the server.
 *
 * On the babysitter's phone, opening that link turns the app into a guest
 * view of the family's log — no Settings, no pairing, a strip across the
 * top saying whose log it is and until when. Every sync asks the server
 * whether the token still works; the moment it doesn't (removed, or its
 * time is up) the phone wipes everything it holds and says so.
 *
 * The server is what enforces all of it (supabase/migrations/0005); this
 * side only has to be honest about what it shows.
 */
const Guest = (() => {
  const ENDED_KEY = 'nayla.guestEnded.v1';
  const CACHE_KEY = 'nayla.guests.v1';

  /* ── the babysitter's phone ──────────────────────────────── */

  const on = () => Boolean(Store.settings().guestToken);
  const canLog = () => on() && Store.settings().guestCanLog !== false;

  /** An entry this guest may change: one it added. Unsynced ones are its own
   *  by definition — everything pulled from the family has a rev. */
  function mine(record) {
    if (!on()) return true;
    return !record.rev || record.data?.by === Store.settings().guestLabel;
  }

  function link(token) {
    return `${location.href.split('#')[0]}#guest=${token}`;
  }

  /** The guest token from a link, or null. Stripped from the address bar
   *  straight away, like a pairing link. */
  function claimFromUrl() {
    const match = /[#&]guest=([0-9a-f]+)/i.exec(location.hash);
    if (!match) return null;
    history.replaceState(null, '', location.href.split('#')[0]);
    return match[1].length >= 24 ? match[1] : null;
  }

  const ended = err => /guest access ended/.test(String(err?.message || err));

  /** Take on a guest link. Refuses on a phone that already has a log of its
   *  own — a family phone, or a babysitter tracking her own baby — rather
   *  than mixing two families' entries. */
  async function join(token) {
    const s = Store.settings();
    if (s.guestToken === token) return { ok: true };
    if (s.syncCode) {
      return { error: 'This phone is already one of the family phones, so it sees everything anyway.' };
    }
    if (s.guestToken || Store.all().length) {
      return { error: 'This phone already has a log in this app. Open the link in another browser or a private tab instead.' };
    }
    let info;
    try {
      info = await Sync.call('nayla_guest_info', { p_token: token });
    } catch (err) {
      return { error: ended(err)
        ? 'That link has been turned off by the family.'
        : "Couldn't reach the server — open the link again once there's signal." };
    }
    Store.saveSettings({ guestToken: token, lastPulledAt: 0, lastFullPullAt: 0 });
    apply(info);
    return { ok: true, label: info.label };
  }

  /** What the server says about this guest: name, until when, and the baby
   *  (the guest phone has no settings of its own). Saved only when changed,
   *  so a sync doesn't redraw the screen for nothing. */
  function apply(info) {
    if (!info) return;
    const baby = info.baby || {};
    const next = {
      guestLabel: info.label || 'Guest',
      guestCanLog: info.can_log !== false,
      guestUntil: info.expires_at == null ? null : Number(info.expires_at),
      name: baby.name || 'Baby',
      dob: baby.dob || '',
      sex: baby.sex || 'girl',
    };
    const s = Store.settings();
    if (Object.keys(next).some(k => s[k] !== next[k])) Store.saveSettings(next);
  }

  /** Forget the family's log on this phone. Everything in this app's
   *  storage on this phone was theirs — join() refuses otherwise — so it
   *  all goes. `byFamily` leaves a note to explain the empty screen. */
  function wipe(byFamily) {
    try {
      localStorage.clear();
      sessionStorage.clear();
      if (byFamily) localStorage.setItem(ENDED_KEY, String(Date.now()));
    } catch { /* nothing more we can do */ }
    location.reload();
  }

  function wasEnded() {
    try { return Boolean(localStorage.getItem(ENDED_KEY)); } catch { return false; }
  }
  function clearEnded() {
    try { localStorage.removeItem(ENDED_KEY); } catch { /* fine */ }
  }

  /** "until 11:59 PM", "until tomorrow 9:00 AM", "until the family turns it off". */
  function untilWords(at, open = 'until the family turns it off') {
    if (at == null) return open;
    const today = Fmt.dayKey(at) === Fmt.dayKey(Date.now());
    return `until ${today ? '' : `${Fmt.dayLabel(at).toLowerCase()} `}${Fmt.clock(at)}`;
  }

  /* ── the family's phones ─────────────────────────────────── */

  function cached() {
    try {
      const list = JSON.parse(localStorage.getItem(CACHE_KEY)) || [];
      return list.filter(g => g.expires_at == null || g.expires_at > Date.now());
    } catch { return []; }
  }

  function remember(list) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch { /* fine */ }
  }

  /** Guests who can still get in, from the server. Kept on the phone too,
   *  so Home can remind you without a request. */
  async function refresh() {
    const code = Store.settings().syncCode;
    if (!code || !Sync.effective().url) { remember([]); return []; }
    const rows = await Sync.call('nayla_guest_list', { p_code: code });
    if (!Array.isArray(rows)) throw new Error('nayla_guest_list: unexpected reply');
    const list = rows.map(g => ({ token: g.token, label: g.label, can_log: g.can_log,
      created_at: Number(g.created_at), expires_at: g.expires_at == null ? null : Number(g.expires_at) }));
    remember(list);
    return list;
  }

  /** Make a guest link. `until` is a time in ms, or null for "until removed". */
  async function create({ label, canLog: log, until }) {
    if (!Sync.effective().url) throw new Error('Babysitter access needs the sync server — see Settings → Sync.');
    // A phone that has never shared needs a household first.
    if (!Store.settings().syncCode) Store.saveSettings({ syncCode: Sync.newPairingCode(), lastPulledAt: 0 });
    const s = Store.settings();
    const token = Sync.newPairingCode();
    await Sync.call('nayla_guest_create', {
      p_code: s.syncCode, p_token: token, p_label: label,
      p_baby: { name: s.name || 'Baby', dob: s.dob || '', sex: s.sex || 'girl' },
      p_can_log: log, p_expires_at: until,
    });
    // Her entries go up first, so the babysitter sees today, not an empty log.
    Sync.run({ silent: true });
    await refresh().catch(() => {});
    return link(token);
  }

  async function revoke(token) {
    await Sync.call('nayla_guest_revoke', { p_code: Store.settings().syncCode, p_token: token });
    remember(cached().filter(g => g.token !== token));
    await refresh().catch(() => {});
  }

  return {
    on, canLog, mine, link, claimFromUrl, join, apply, ended, wipe, wasEnded, clearEnded, untilWords,
    cached, refresh, create, revoke,
  };
})();
