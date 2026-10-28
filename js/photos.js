/* Milestone photos.
 *
 * A photo is far too big to live in a record: records sit in localStorage
 * (a few MB for everything) and travel in every sync. So a milestone holds
 * only a photo id, and the image itself lives here:
 *
 *   on this phone   IndexedDB, which has room for hundreds of photos
 *   between phones  its own table on the server (supabase/migrations/0003),
 *                   uploaded once, and fetched by the other phone the first
 *                   time it needs to show it
 *
 * Photos are shrunk before they are stored — 1280px on the long side is
 * plenty for a phone screen, and keeps each one around 150–300 KB.
 *
 * If the server has not had the photo migration applied, nothing breaks:
 * photos stay on the phone that took them, and upload once it has.
 */
const Photos = (() => {
  const DB_NAME = 'nayla-photos';
  const STORE = 'photos';
  const MAX_EDGE = 1280;
  const QUALITY = 0.82;

  const memory = new Map();       // id -> data URL, so re-renders never flicker
  const fetching = new Map();     // id -> Promise, so ten <img>s make one request
  let dbPromise = null;
  let syncing = false;
  let serverMissing = false;      // the photo functions aren't on the server yet

  /* ── IndexedDB, as promises ──────────────────────────────── */
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function run(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  const read = id => run('readonly', s => s.get(id));
  const write = row => run('readwrite', s => s.put(row));
  const drop = id => run('readwrite', s => s.delete(id));
  const everything = () => run('readonly', s => s.getAll());

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

  /** Keep a new photo; returns the id a record should point at. Synchronous
   *  for the caller — the write and the upload finish in the background. */
  function add(dataUrl) {
    const id = newId();
    memory.set(id, dataUrl);
    write({ id, data: dataUrl })
      .then(() => sync())
      .catch(err => console.warn('Could not keep photo', err));
    return id;
  }

  /** Forget a photo here and, on the next sync, on the server. */
  function remove(id) {
    if (!id) return;
    memory.delete(id);
    write({ id, data: null, deleted: true })
      .then(() => sync())
      .catch(err => console.warn('Could not remove photo', err));
  }

  /* ── showing one ─────────────────────────────────────────── */

  async function get(id) {
    if (memory.has(id)) return memory.get(id);
    const row = await read(id).catch(() => null);
    if (row?.data) { memory.set(id, row.data); return row.data; }
    if (row?.deleted) return null;
    return fetchRemote(id);
  }

  function fetchRemote(id) {
    if (serverMissing || !Sync.enabled()) return Promise.resolve(null);
    if (!fetching.has(id)) {
      fetching.set(id, (async () => {
        try {
          const data = await Sync.call('nayla_photo_get', { p_code: Sync.effective().code, p_id: id });
          if (typeof data === 'string' && data.startsWith('data:image/')) {
            memory.set(id, data);
            await write({ id, data, pushedTo: Sync.effective().code }).catch(() => {});
            return data;
          }
        } catch (err) {
          if (/→ 404/.test(String(err.message))) serverMissing = true;
          else console.warn('Could not fetch photo', err);
        } finally {
          fetching.delete(id);
        }
        return null;
      })());
    }
    return fetching.get(id);
  }

  /** Point an <img> at a photo — straight away if it's in memory. */
  function show(img, id) {
    if (!id) return;
    const known = memory.get(id);
    if (known) { if (img.src !== known) img.src = known; img.hidden = false; return; }
    img.closest('[data-photo-wrap]')?.classList.add('is-loading');
    get(id).then(url => {
      img.closest('[data-photo-wrap]')?.classList.remove('is-loading');
      if (url) { img.src = url; img.hidden = false; }
      else img.closest('[data-photo-wrap]')?.classList.add('is-missing');
    });
  }

  /* ── to and from the server ──────────────────────────────── */

  async function sync() {
    if (syncing || serverMissing || !Sync.enabled() || navigator.onLine === false) return;
    syncing = true;
    try {
      // "Uploaded" means uploaded under the current pairing code: a new code
      // moves the whole log to a new household, and the photos follow it.
      const code = Sync.effective().code;
      const pending = (await everything()).filter(r => r.deleted || r.pushedTo !== code);
      for (const row of pending) {
        await Sync.call('nayla_photo_put', {
          p_code: code, p_id: row.id, p_data: row.deleted ? null : row.data,
        });
        if (row.deleted) await drop(row.id);
        else await write({ ...row, pushedTo: code });
      }
    } catch (err) {
      // Not having the migration yet is a setup step, not a fault: the photos
      // wait on this phone, and go up once the server has somewhere to put them.
      if (/→ 404/.test(String(err.message))) serverMissing = true;
      else console.warn('Photo sync failed', err);
    } finally {
      syncing = false;
    }
  }

  function start() {
    // Ride along with the log's own sync rather than keeping a timer.
    Sync.onChange(st => { if (st.enabled && !st.busy && !st.error) sync(); });
  }

  return { fromFile, add, remove, get, show, sync, start };
})();
