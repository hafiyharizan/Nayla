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
  const PUSH_BATCH = 500;          // matches the row cap in nayla_sync_push
  const REQUEST_TIMEOUT_MS = 20000;

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
    // A sleeping or restarting server accepts the connection and then never
    // answers, so without this the request hangs and the UI just says
    // "Syncing…" indefinitely.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${c.url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(c.key ? { apikey: c.key, Authorization: `Bearer ${c.key}` } : {}),
        },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
    } finally {
      clearTimeout(timer);
    }
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
      // Pushed in batches: the server refuses more than 500 rows at once, and
      // a first import or a re-keyed household hands over the entire log.
      const pending = Store.pending();
      for (let i = 0; i < pending.length; i += PUSH_BATCH) {
        const batch = pending.slice(i, i + PUSH_BATCH);
        await rpc('nayla_sync_push', { p_code: code, p_rows: batch.map(toRow) });
        Store.markPushed(batch.map(r => r.id));
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

  /* Turn the failure into something that answers the only two questions that
   * matter at 3am: is it me, and did I lose anything? Nothing is ever lost —
   * a failed sync leaves the entries queued on the phone and they go up on
   * the next attempt — so every message here says so. */
  function friendly(err) {
    const msg = String(err.message || err);

    // Each browser words a dead connection differently.
    if (err.name === 'AbortError' || /Load failed|Failed to fetch|NetworkError|timed out/i.test(msg)) {
      return 'the server did not answer. Entries are safe on this phone and will go up on their own.';
    }
    // 502/503/504 — the gateway is there, the database behind it is not.
    // On the free tier that usually means it went to sleep and is waking up.
    if (/→ 50[234]/.test(msg)) {
      return 'the server is asleep or restarting. Entries are safe on this phone; it will keep trying.';
    }
    if (/→ 40[13]/.test(msg)) return 'the server rejected the key. Check Settings → Advanced.';
    if (msg.includes('pairing code')) return 'that pairing code was rejected.';
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
