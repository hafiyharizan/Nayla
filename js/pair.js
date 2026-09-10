/* Pairing, without typing 32 characters into a phone.
 *
 * Everything except the pairing code is already baked into config.js, so the
 * code is the only thing that has to travel between two phones. It travels in
 * a link — shown as a QR to scan in person, or shared if they're apart.
 *
 * The code rides in the URL fragment (#pair=…) on purpose: fragments are never
 * sent to the server, so the secret stays between the two phones even though
 * the page itself is served over the public internet.
 */
const Pair = (() => {

  function link(code) {
    const base = location.href.split('#')[0];
    return `${base}#pair=${encodeURIComponent(code)}`;
  }

  /** Read a code out of the URL, if this page was opened from a pairing link. */
  function claimFromUrl() {
    const match = /[#&]pair=([^&]+)/.exec(location.hash);
    if (!match) return null;
    const code = decodeURIComponent(match[1]).trim();
    // Strip it from the address bar immediately: no reason to leave a working
    // secret sitting in history or in a screenshot of the browser chrome.
    history.replaceState(null, '', location.href.split('#')[0]);
    return /^[0-9a-f]{24,}$/i.test(code) ? code : null;
  }

  function open() {
    const code = Store.settings().syncCode;
    if (!code) { return { error: 'Tap "New code" first.' }; }

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
