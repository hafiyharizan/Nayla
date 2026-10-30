/* Milestone photos.
 *
 * A photo stays on the phone that took it. Only when a milestone is marked
 * "Share photo with the other phone" does it leave — and then only
 * encrypted, so the server holds bytes it cannot read.
 *
 *   on this phone   IndexedDB, which has room for hundreds of photos
 *   when shared     encrypted here with AES-GCM, uploaded to its own table
 *                   (supabase/migrations/0003 + 0004), and decrypted by the
 *                   other phone the first time it shows it
 *
 * The key is not the pairing code. The pairing code is sent to the server on
 * every sync, so a key derived from it would be a key the server has. The
 * photo key is a separate random secret that travels only inside the pairing
 * QR code (in the URL fragment, which browsers never send anywhere). Whoever
 * runs the server — us included — sees only scrambled data.
 *
 * Which photos should be on the server is read from the milestones
 * themselves, every time this syncs: shared and present goes up, anything
 * unshared, replaced or deleted comes down. That one rule covers unsharing,
 * replacing a photo, deleting a milestone, "Delete all", and a new pairing
 * code, without each needing its own bookkeeping.
 *
 * Photos are shrunk before they are stored — 1280px on the long side is
 * plenty for a phone screen, and keeps each one around 150–300 KB.
 */
const Photos = (() => {
  const DB_NAME = 'nayla-photos';
  const MAX_EDGE = 1280;
  const QUALITY = 0.82;
  const PREFIX = 'enc1:';
  const RETRY_MS = 60000;          // a shared photo not there yet: ask again later
  const FRESH_MS = 2 * 60000;      // a photo saved this recently is never swept

  /* Two stores, so a sync can look over every photo without loading them:
   *   images  { id, data }                          the photo itself
   *   meta    { id, own, createdAt, pushedTo }      a few bytes each
   *     own       true if this phone took it; false for a copy of a shared one
   *     pushedTo  "<pairing code>:<key fingerprint>" it was uploaded under */
  const memory = new Map();        // id -> { data, own }, so re-renders never flicker
  const fetching = new Map();      // id -> Promise, so ten <img>s make one request
  const lastMiss = new Map();      // id -> when the server last didn't have it
  let dbPromise = null;
  let syncing = false;
  let again = false;
  let serverMissing = false;       // the photo functions aren't on the server yet
  let debounce = null;

  /* ── IndexedDB, as promises ──────────────────────────────── */
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = () => {
          for (const name of ['images', 'meta']) {
            if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function run(stores, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(stores, mode);
      const req = fn(name => tx.objectStore(name));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  const readMeta = id => run('meta', 'readonly', st => st('meta').get(id));
  const readImage = id => run('images', 'readonly', st => st('images').get(id)).then(r => r?.data || null);
  const writeMeta = meta => run('meta', 'readwrite', st => st('meta').put(meta));
  const allMeta = () => run('meta', 'readonly', st => st('meta').getAll());
  const keep = (meta, data) => run(['images', 'meta'], 'readwrite', st => {
    st('images').put({ id: meta.id, data });
    return st('meta').put(meta);
  });
  const drop = id => {
    memory.delete(id);
    return run(['images', 'meta'], 'readwrite', st => { st('images').delete(id); return st('meta').delete(id); });
  };

  /* ── bytes and keys ──────────────────────────────────────── */
  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  function fromB64(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  /* The key goes in a URL, so it uses the URL-safe alphabet. */
  const keyToText = bytes => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const keyFromText = text => fromB64(text.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - text.length % 4) % 4));

  /** A fresh 256-bit photo key, as text for settings and the pairing link. */
  function newKey() {
    return keyToText(crypto.getRandomValues(new Uint8Array(32)));
  }

  function validKey(text) {
    return typeof text === 'string' && /^[A-Za-z0-9_-]{43}$/.test(text);
  }

  const keys = new Map();
  function cryptoKey(text) {
    if (!keys.has(text)) {
      keys.set(text, crypto.subtle.importKey('raw', keyFromText(text), 'AES-GCM', false, ['encrypt', 'decrypt']));
    }
    return keys.get(text);
  }

  const enc = new TextEncoder();

  /* The photo id is bound in as associated data, so an encrypted photo can't
   * be swapped in under another milestone's id. */
  async function seal(dataUrl, id, keyText) {
    const bytes = fromB64(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(id) }, await cryptoKey(keyText), bytes);
    return `${PREFIX}${toB64(iv)}:${toB64(new Uint8Array(ct))}`;
  }

  async function unseal(payload, id, keyText) {
    if (typeof payload !== 'string' || !payload.startsWith(PREFIX)) return null;
    const [iv, ct] = payload.slice(PREFIX.length).split(':');
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(iv), additionalData: enc.encode(id) }, await cryptoKey(keyText), fromB64(ct));
    return `data:image/jpeg;base64,${toB64(new Uint8Array(pt))}`;
  }

  /** What this phone can share under right now, or null if it can't. */
  function target() {
    const key = Store.settings().photoKey;
    if (!Sync.enabled() || !validKey(key)) return null;
    return `${Sync.effective().code}:${key.slice(0, 8)}`;
  }

  /** Can this phone share photos yet? Drives the switch on the milestone form. */
  function canShare() {
    if (!Sync.enabled()) return 'unpaired';
    if (!validKey(Store.settings().photoKey)) return 'no-key';
    return 'yes';
  }

  /* ── making a photo ──────────────────────────────────────── */

  /** A picked file -> a shrunk JPEG data URL. An <img> honours the camera's
   *  rotation flag, which drawing a raw bitmap would not on older Safari. */
  async function fromFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('not an image'));
        el.src = url;
      });
      const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', QUALITY);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function newId() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return 'p' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /** Keep a new photo on this phone; returns the id a record should point at.
   *  Synchronous for the caller — the write finishes in the background. */
  function add(dataUrl) {
    const id = newId();
    memory.set(id, { data: dataUrl, own: true });
    keep({ id, own: true, createdAt: Date.now() }, dataUrl)
      .then(() => schedule())
      .catch(err => console.warn('Could not keep photo', err));
    return id;
  }

  /* ── showing one ─────────────────────────────────────────── */

  /** A photo's data URL, or null. `shared` is what the milestone says: a copy
   *  of someone else's photo is only shown while they're still sharing it. */
  async function get(id, shared) {
    const known = memory.get(id);
    if (known && (known.own || shared)) return known.data;
    const meta = await readMeta(id).catch(() => null);
    if (meta && (meta.own || shared)) {
      const data = await readImage(id).catch(() => null);
      if (data) { memory.set(id, { data, own: Boolean(meta.own) }); return data; }
    }
    if (!shared) return null;
    return fetchRemote(id);
  }

  function fetchRemote(id) {
    const key = Store.settings().photoKey;
    if (serverMissing || !Sync.enabled() || !validKey(key)) return Promise.resolve(null);
    if (Date.now() - (lastMiss.get(id) || 0) < RETRY_MS) return Promise.resolve(null);
    if (!fetching.has(id)) {
      fetching.set(id, (async () => {
        try {
          const payload = await Sync.call('nayla_photo_get', { p_code: Sync.effective().code, p_id: id });
          const data = payload ? await unseal(payload, id, key) : null;
          if (data) {
            memory.set(id, { data, own: false });
            await keep({ id, own: false, createdAt: Date.now() }, data).catch(() => {});
            return data;
          }
        } catch (err) {
          // A wrong key fails to decrypt: most likely the other phone hasn't
          // scanned the newest pairing code. Not an error worth shouting about.
          if (/→ 404/.test(String(err.message))) serverMissing = true;
          else if (err.name !== 'OperationError') console.warn('Could not fetch photo', err);
        } finally {
          fetching.delete(id);
        }
        lastMiss.set(id, Date.now());
        return null;
      })());
    }
    return fetching.get(id);
  }

  /** Point an <img> at a photo. Where it can't be shown here, the wrapper gets
   *  .is-missing, and says the photo is on the other phone. */
  function show(img, id, { shared = false } = {}) {
    if (!id) return;
    const wrap = img.closest('[data-photo-wrap]');
    const known = memory.get(id);
    if (known && (known.own || shared)) {
      if (img.src !== known.data) img.src = known.data;
      img.hidden = false;
      wrap?.classList.remove('is-missing');
      return;
    }
    wrap?.classList.add('is-loading');
    get(id, shared).then(url => {
      wrap?.classList.remove('is-loading');
      if (url) { img.src = url; img.hidden = false; wrap?.classList.remove('is-missing'); }
      else { img.hidden = true; wrap?.classList.add('is-missing'); }
    });
  }

  /* ── keeping the server in line with the milestones ──────── */

  /** photo id -> shared?, for every milestone that still has a photo. */
  function wanted() {
    const map = new Map();
    for (const r of Store.byType('milestone')) {
      if (r.data.photo) map.set(r.data.photo, r.data.photoShared === true);
    }
    return map;
  }

  async function put(code, id, data) {
    await Sync.call('nayla_photo_put', { p_code: code, p_id: id, p_data: data });
  }

  async function sync() {
    if (syncing) { again = true; return; }
    syncing = true;
    try {
      // Rows first, then the milestones: anything written before this read
      // already has its milestone saved, so nothing new gets swept by mistake.
      const rows = await allMeta();
      const want = wanted();
      const goal = target();
      const reachable = Sync.enabled() && !serverMissing && navigator.onLine !== false;

      for (const row of rows) {
        const referenced = want.has(row.id);
        const shared = want.get(row.id) === true;

        // A copy of the other phone's photo: kept only while they share it.
        if (!row.own) {
          if (!shared) await drop(row.id);
          continue;
        }

        // Up under the wrong code or key, or no longer wanted up there at all:
        // take it down first. Until that works, the row stays put.
        if (row.pushedTo && (!shared || row.pushedTo !== goal)) {
          if (!reachable) continue;
          await put(row.pushedTo.split(':')[0], row.id, null);
          row.pushedTo = null;
          await writeMeta(row);
        }

        if (!referenced) {
          if (Date.now() - (row.createdAt || 0) > FRESH_MS) await drop(row.id);
          continue;
        }

        if (shared && goal && reachable && row.pushedTo !== goal) {
          const data = await readImage(row.id);
          if (!data) continue;
          await put(goal.split(':')[0], row.id, await seal(data, row.id, Store.settings().photoKey));
          row.pushedTo = goal;
          await writeMeta(row);
        }
      }
    } catch (err) {
      // Not having the migration yet is a setup step, not a fault: shared
      // photos wait on this phone, and go up once it's there.
      if (/→ 404/.test(String(err.message))) serverMissing = true;
      else console.warn('Photo sync failed', err);
    } finally {
      syncing = false;
      if (again) { again = false; schedule(); }
    }
  }

  function schedule() {
    clearTimeout(debounce);
    debounce = setTimeout(sync, 800);
  }

  /* ── sending one the ordinary way ────────────────────────── */

  function sendable() {
    try {
      return Boolean(navigator.canShare?.({
        files: [new File([new Uint8Array(1)], 'photo.jpg', { type: 'image/jpeg' })],
      }));
    } catch { return false; }
  }

  /** Hand a photo to the phone's own share sheet — WhatsApp, AirDrop, … —
   *  without it touching our server at all. */
  async function send(dataUrl, title) {
    const file = new File([fromB64(dataUrl.slice(dataUrl.indexOf(',') + 1))],
      `${(title || 'milestone').replace(/[^\w -]+/g, '').trim() || 'milestone'}.jpg`, { type: 'image/jpeg' });
    try { await navigator.share({ files: [file], title }); return true; }
    catch { return false; }
  }

  function start() {
    // Ride along with the log's own sync, and with any change to the log —
    // a milestone shared, unshared or deleted.
    Sync.onChange(st => { if (st.enabled && !st.busy && !st.error) schedule(); });
    Store.onChange(schedule);
    schedule();
  }

  return {
    fromFile, add, get, show, sync, start,
    newKey, validKey, canShare, sendable, send,
  };
})();
