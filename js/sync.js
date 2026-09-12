/* Sync.
 *
 * localStorage stays the source of truth. This pushes whatever changed
 * locally, pulls whatever changed elsewhere, and merges — so the app keeps
 * working with no network, and a phone that was offline all afternoon
 * catches up on its own when it reconnects.
 *
 * "Everything dirty since the last successful push" IS the outbound queue;
 * there is nothing else to retry.
 *
 * The server assigns every row a rev from one sequence, so ordering never
 * depends on any device's clock. Merge is last-write-wins per record, which
 * is enough here: two people almost never edit the same entry, and the
 * failure mode is one edit of one record losing to another — never a lost log.
 *
 * Talks to two Postgres functions over PostgREST. The table itself is not
 * reachable: the pairing code is the only way in. See supabase/migrations/.
 */
const Sync = (() => {
  const POLL_MS = 60000;
  const DEBOUNCE_MS = 2000;
  const PAGE = 2000;               // matches the LIMIT in nayla_sync_pull

  /* Postgres hands out a sequence number before the transaction holding it
   * commits, so a pull can see rev 12 while rev 11 is still in flight. Taking
   * the highest rev seen as the next cursor would then step over rev 11 for
   * good. Re-reading a window of recent revs on every pull closes that gap;
   * merge ignores anything it already has, so the repeat costs nothing but a
   * few KB. */
  const PULL_OVERLAP = 200;

  /* And a periodic pull from zero, so that even a gap wider than the overlap
   * — or anything else we haven't thought of — heals on its own. */
  const FULL_RESYNC_MS = 12 * 3600 * 1000;

  const state = { enabled: false, busy: false, lastSyncedAt: 0, error: null };
  const listeners = new Set();
  let debounce = null;

  function config() {
    const s = Store.settings();
    return {
      url: (s.syncUrl || Config.url || '').replace(/\/+$/, ''),
      key: s.syncKey || Config.anonKey || '',
      code: s.syncCode || '',
    };
  }

  /* A key is only needed where something in front of PostgREST demands one —
   * Supabase's gateway does, a plain PostgREST using db-anon-role does not.
   * The key was never the secret here; the pairing code is. */
  function enabled() {
    const c = config();
    return Boolean(c.url && c.code);
  }

  function announce() { listeners.forEach(fn => fn(status())); }

  function status() {
    return { ...state, enabled: enabled() };
  }

  async function rpc(name, body) {
    const c = config();
    const res = await fetch(`${c.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(c.key ? { apikey: c.key, Authorization: `Bearer ${c.key}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`${name} → ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`);
    }
    return res.json();
  }

  /* The wire shape. rev and updatedAt are server-owned, so are not sent up. */
  function toRow(r) {
    return {
      id: r.id, type: r.type, at: r.at, end: r.end ?? null,
      note: r.note || '', data: r.data || {}, deleted: Boolean(r.deleted),
    };
  }

  function fromRow(row) {
    return {
      id: row.id, type: row.type, at: Number(row.at),
      end: row.end == null ? null : Number(row.end),
      note: row.note || '', data: row.data || {},
      deleted: Boolean(row.deleted),
      rev: Number(row.rev),
      updatedAt: Number(row.updated_at),
    };
  }

  async function run({ silent = false } = {}) {
    if (!enabled() || state.busy) return status();
    if (navigator.onLine === false) {
      state.error = silent ? state.error : 'Offline — will sync when back online.';
      announce();
      return status();
    }

    state.busy = true;
    state.error = null;
    announce();

    const code = config().code;
    try {
      const pending = Store.pending();
      if (pending.length) {
        await rpc('nayla_sync_push', { p_code: code, p_rows: pending.map(toRow) });
        Store.markPushed(pending.map(r => r.id));
      }

      // Pulling straight after pushing is deliberate: it brings our own rows
      // back carrying the revs the server assigned them.
      const mark = Store.settings().lastPulledAt || 0;
      const lastFull = Store.settings().lastFullPullAt || 0;
      const full = Date.now() - lastFull > FULL_RESYNC_MS;
      const since = full ? 0 : Math.max(0, mark - PULL_OVERLAP);

      const rows = await pullFrom(code, since);
      Store.merge(rows.map(fromRow));

      // Never let the mark slide backwards: the overlap is a re-read, not a
      // rewind.
      const next = rows.reduce((max, r) => Math.max(max, Number(r.rev)), mark);
      Store.saveSettings({
        lastPulledAt: next,
        ...(full ? { lastFullPullAt: Date.now() } : {}),
      });

      state.lastSyncedAt = Date.now();
    } catch (err) {
      console.warn('Sync failed', err);
      state.error = friendly(err);
    } finally {
      state.busy = false;
      announce();
    }
    return status();
  }

  /** Page through everything above `since`, so a long backlog can't be cut
   *  off by the server's row limit. */
  async function pullFrom(code, since) {
    let cursor = since, all = [], pages = 0;
    for (;;) {
      const rows = await rpc('nayla_sync_pull', { p_code: code, p_since: cursor });
      all = all.concat(rows);
      if (rows.length < PAGE || ++pages > 50) break;
      cursor = rows.reduce((max, r) => Math.max(max, Number(r.rev)), cursor);
    }
    return all;
  }

  function friendly(err) {
    const msg = String(err.message || err);
    if (msg.includes('Failed to fetch')) return "Can't reach the server.";
    if (msg.includes('401') || msg.includes('403')) return 'Server rejected the key.';
    if (msg.includes('pairing code')) return 'That pairing code was rejected.';
    return msg;
  }

  /** Push soon after a local change, without a request per keystroke. */
  function schedule() {
    if (!enabled() || !Store.pending().length) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => run({ silent: true }), DEBOUNCE_MS);
  }

  function newPairingCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function start() {
    Store.onChange(schedule);
    window.addEventListener('online', () => run({ silent: true }));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) run({ silent: true });
    });
    setInterval(() => { if (!document.hidden) run({ silent: true }); }, POLL_MS);
    run({ silent: true });
  }

  return {
    start, run, status, enabled, newPairingCode,
    /** What sync is actually using, after config.js fallbacks. */
    effective: config,
    onChange(fn) { listeners.add(fn); },
  };
})();
