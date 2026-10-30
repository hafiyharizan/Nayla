/* Pairing, without typing 32 characters into a phone.
 *
 * Everything else is already baked into config.js, so two secrets are all
 * that has to travel between phones: the pairing code, which unlocks the log
 * on the server, and the photo key, which encrypts shared photos and which
 * the server must never see. They travel in a link — shown as a QR to scan
 * in person, or shared if they're apart.
 *
 * Both ride in the URL fragment (#pair=…&k=…) on purpose: fragments are never
 * sent to the server, so the secrets stay between the phones even though the
 * page itself is served over the public internet.
 */
const Pair = (() => {

  function link(code, key = Store.settings().photoKey) {
    const base = location.href.split('#')[0];
    return `${base}#pair=${encodeURIComponent(code)}${key ? `&k=${key}` : ''}`;
  }

  /** Read the code — and photo key, if any — out of the URL, if this page was
   *  opened from a pairing link. Returns { code, key } or null. */
  function claimFromUrl() {
    const match = /[#&]pair=([^&]+)/.exec(location.hash);
    if (!match) return null;
    const code = decodeURIComponent(match[1]).trim();
    const key = (/[#&]k=([^&]+)/.exec(location.hash) || [])[1] || null;
    // Strip it from the address bar immediately: no reason to leave a working
    // secret sitting in history or in a screenshot of the browser chrome.
    history.replaceState(null, '', location.href.split('#')[0]);
    if (!/^[0-9a-f]{24,}$/i.test(code)) return null;
    return { code, key: Photos.validKey(key) ? key : null };
  }

  function open() {
    const code = Store.settings().syncCode;
    if (!code) { return { error: 'Tap "New code" first.' }; }
    // Phones paired before shared photos existed have no key yet: the first
    // one to show its code makes one, and the next scan hands it over.
    if (!Photos.validKey(Store.settings().photoKey)) Store.saveSettings({ photoKey: Photos.newKey() });

    const url = link(code);
    document.getElementById('pairQr').innerHTML =
      QR.svg(url, { size: 240, dark: '#241d16', light: '#ffffff' });
    document.getElementById('pairCode').textContent = code;
    document.getElementById('pairSheet').hidden = false;
    document.body.style.overflow = 'hidden';
    return {};
  }

  function close() {
    document.getElementById('pairSheet').hidden = true;
    document.body.style.overflow = '';
  }

  async function share() {
    const url = link(Store.settings().syncCode);
    if (navigator.share) {
      try { await navigator.share({ title: 'Nayla', url }); return 'shared'; }
      catch { return 'cancelled'; }
    }
    try { await navigator.clipboard.writeText(url); return 'copied'; }
    catch { return 'failed'; }
  }

  return { link, claimFromUrl, open, close, share };
})();
