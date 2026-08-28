/* Data layer.
 *
 * A record is the one shape everything in the app is stored as:
 *
 *   { id, type, at, end, note, data, updatedAt, dirty, deleted }
 *
 *   type      which feature it belongs to ('feed', 'sleep', 'growth', …)
 *   at        when it happened (ms)
 *   end       when it finished, or null for point-in-time records
 *   data      the feature's own payload — nothing outside that feature reads it
 *   updatedAt last change, wall clock (ms) — for display and tombstone expiry
 *   rev       the server's sequence number for this record; 0 until it syncs.
 *             Ordering by rev rather than by clock is what keeps sync correct
 *             when a phone's time is wrong.
 *   dirty     changed locally and not yet pushed
 *   deleted   a tombstone, so a delete on one phone reaches the other
 *
 * Deletes are tombstones rather than removals: without them, a record deleted
 * here would simply be re-sent by the other device on its next sync.
 */
const Store = (() => {
  const KEY = 'nayla.records.v2';
  const LEGACY_KEY = 'nayla.entries.v1';
  const SETTINGS_KEY = 'nayla.settings.v1';

  const DEFAULT_SETTINGS = {
    name: 'Nayla',
    dob: '2026-06-04',
    units: 'ml',
    syncUrl: '',
    syncKey: '',
    syncCode: '',
    lastPulledAt: 0,
  };

  /** Tombstones older than this are dropped; long past any device catching up. */
  const TOMBSTONE_TTL = 90 * 86400000;

  let records = [];
  let settings = { ...DEFAULT_SETTINGS };
  const listeners = new Set();

  function load() {
    settings = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_KEY, {}) };
    const stored = readJson(KEY, null);
    if (stored) {
      records = stored.filter(isRecord);
    } else {
      records = migrateLegacy(readJson(LEGACY_KEY, []));
      if (records.length) persist();       // the v1 key is left untouched
    }
    sort();
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  /** v1 entries were { type, start, end, note, method|amount|kind } — flatten into data. */
  function migrateLegacy(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.filter(e => e && Features.has(e.type) && Number.isFinite(e.start)).map(e => {
      const data = {};
      if (e.type === 'feed') {
        data.method = e.method ?? 'bottle';
        data.amount = e.amount ?? null;
      } else if (e.type === 'diaper') {
        data.kind = e.kind ?? 'wet';
      }
      return {
        id: e.id || newId(),
        type: e.type,
        at: e.start,
        end: e.end ?? null,
        note: e.note || '',
        data,
        updatedAt: e.start,
        rev: 0,
        dirty: true,
        deleted: false,
      };
    });
  }

  function isRecord(r) {
    return r && typeof r === 'object' && typeof r.id === 'string' &&
      Features.has(r.type) && Number.isFinite(r.at);
  }

  /** Newest first, tombstones excluded — this is what the UI iterates. */
  function sort() {
    records.sort((a, b) => b.at - a.at);
  }

  function live() {
    return records.filter(r => !r.deleted);
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(records));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      console.warn('Could not save — storage may be full or blocked.', err);
    }
    listeners.forEach(fn => fn());
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  return {
    init: load,
    onChange(fn) { listeners.add(fn); },
    notify() { listeners.forEach(fn => fn()); },

    all() { return live(); },

    byType(type) {
      return type === 'all' ? live() : live().filter(r => r.type === type);
    },

    get(id) {
      const r = records.find(x => x.id === id);
      return r && !r.deleted ? r : null;
    },

    latest(type, { completedOnly = false } = {}) {
      return live().find(r => r.type === type && (!completedOnly || r.end != null)) || null;
    },

    /** The sleep currently in progress, if any. */
    activeSleep() {
      return live().find(r => r.type === 'sleep' && r.end == null) || null;
    },

    add(fields) {
      const record = {
        id: newId(), end: null, note: '', data: {},
        rev: 0,
        ...fields,
        updatedAt: Date.now(), dirty: true, deleted: false,
      };
      records.push(record);
      sort();
      persist();
      return record;
    },

    update(id, patch) {
      const record = records.find(r => r.id === id);
      if (!record) return null;
      Object.assign(record, patch, { updatedAt: Date.now(), dirty: true });
      sort();
      persist();
      return record;
    },

    remove(id) {
      const record = records.find(r => r.id === id);
      if (!record) return false;
      Object.assign(record, { deleted: true, updatedAt: Date.now(), dirty: true });
      persist();
      return true;
    },

    /** Records overlapping a local day, for the daily summaries. */
    forDay(day) {
      const from = new Date(day); from.setHours(0, 0, 0, 0);
      const to = new Date(from); to.setDate(to.getDate() + 1);
      const a = from.getTime(), b = to.getTime();
      return live().filter(r => {
        const end = r.end ?? r.at;
        return r.at < b && end >= a;
      });
    },

    /* ── sync surface ──────────────────────────────────────── */

    /** Everything changed locally and not yet accepted by the server. */
    pending() { return records.filter(r => r.dirty); },

    /** Called once a push is accepted. The authoritative rev arrives on the
     *  next pull, which is why this only has to clear the dirty flag. */
    markPushed(ids) {
      const set = new Set(ids);
      for (const r of records) if (set.has(r.id)) r.dirty = false;
      persist();
    },

    /** Merge rows from the server: higher rev wins, unpushed local edits win.
     *  A dirty record is never overwritten — it hasn't had its turn yet. */
    merge(rows) {
      let changed = 0;
      for (const row of rows) {
        if (!isRecord(row)) continue;
        const local = records.find(r => r.id === row.id);
        if (!local) {
          records.push({ ...row, dirty: false });
          changed++;
        } else if (!local.dirty && (row.rev ?? 0) > (local.rev ?? 0)) {
          Object.assign(local, row, { dirty: false });
          changed++;
        }
      }
      if (changed) { sweepTombstones(); sort(); persist(); }
      return changed;
    },

    settings() { return settings; },

    saveSettings(patch) {
      settings = { ...settings, ...patch };
      persist();
    },

    replaceAll(nextRecords, nextSettings) {
      records = nextRecords.filter(isRecord).map(r => ({ ...r, rev: 0, dirty: true }));
      if (nextSettings) settings = { ...DEFAULT_SETTINGS, ...settings, ...nextSettings };
      sort();
      persist();
    },

    clear() {
      // Tombstone rather than drop, so the delete propagates to the other phone.
      const now = Date.now();
      for (const r of records) Object.assign(r, { deleted: true, updatedAt: now, dirty: true });
      persist();
    },

    exportData() {
      return {
        version: 2,
        exportedAt: new Date().toISOString(),
        settings: publicSettings(),
        records: live(),
      };
    },
  };

  /** Settings minus the sync credentials — backups shouldn't carry the secret. */
  function publicSettings() {
    const { syncUrl, syncKey, syncCode, lastPulledAt, ...rest } = settings;
    return rest;
  }

  function sweepTombstones() {
    const cutoff = Date.now() - TOMBSTONE_TTL;
    records = records.filter(r => !(r.deleted && !r.dirty && r.updatedAt < cutoff));
  }
})();
