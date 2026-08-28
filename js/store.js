/* Data layer. Everything lives in localStorage on this device.
 *
 * An entry is:
 *   { id, type: 'feed'|'diaper'|'sleep', start: ms, end: ms|null, note, ...extras }
 *
 * feed extras:   method 'bottle'|'left'|'right'|'solids', amount (number|null, in ml)
 * diaper extras: kind 'wet'|'dirty'|'both'
 * sleep extras:  none — an entry with end === null is still in progress
 */
const Store = (() => {
  const KEY = 'nayla.entries.v1';
  const SETTINGS_KEY = 'nayla.settings.v1';

  const DEFAULT_SETTINGS = { name: 'Nayla', dob: '', units: 'ml' };

  let entries = [];
  let settings = { ...DEFAULT_SETTINGS };
  const listeners = new Set();

  function load() {
    entries = readJson(KEY, []).filter(isEntry);
    settings = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_KEY, {}) };
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

  function isEntry(e) {
    return e && typeof e === 'object' &&
      ['feed', 'diaper', 'sleep'].includes(e.type) &&
      Number.isFinite(e.start);
  }

  /** Newest first. */
  function sort() {
    entries.sort((a, b) => b.start - a.start);
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
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

    all() { return entries; },

    byType(type) {
      return type === 'all' ? entries : entries.filter(e => e.type === type);
    },

    get(id) { return entries.find(e => e.id === id) || null; },

    /** Most recent entry of a type, optionally only completed ones. */
    latest(type, { completedOnly = false } = {}) {
      return entries.find(e =>
        e.type === type && (!completedOnly || e.end != null)
      ) || null;
    },

    /** The sleep currently in progress, if any. */
    activeSleep() {
      return entries.find(e => e.type === 'sleep' && e.end == null) || null;
    },

    add(entry) {
      const saved = { id: newId(), end: null, note: '', ...entry };
      entries.push(saved);
      sort();
      persist();
      return saved;
    },

    update(id, patch) {
      const entry = entries.find(e => e.id === id);
      if (!entry) return null;
      Object.assign(entry, patch);
      sort();
      persist();
      return entry;
    },

    remove(id) {
      const i = entries.findIndex(e => e.id === id);
      if (i === -1) return false;
      entries.splice(i, 1);
      persist();
      return true;
    },

    /** Entries that overlap the given local day (a Date at any time that day). */
    forDay(day) {
      const from = new Date(day); from.setHours(0, 0, 0, 0);
      const to = new Date(from); to.setDate(to.getDate() + 1);
      const a = from.getTime(), b = to.getTime();
      return entries.filter(e => {
        const end = e.end ?? e.start;
        return e.start < b && end >= a;
      });
    },

    settings() { return settings; },

    saveSettings(patch) {
      settings = { ...settings, ...patch };
      persist();
    },

    replaceAll(nextEntries, nextSettings) {
      entries = nextEntries.filter(isEntry);
      if (nextSettings) settings = { ...DEFAULT_SETTINGS, ...nextSettings };
      sort();
      persist();
    },

    clear() {
      entries = [];
      persist();
    },

    exportData() {
      return { version: 1, exportedAt: new Date().toISOString(), settings, entries };
    },
  };
})();
