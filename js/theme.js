/* Light or Night.
 *
 * The choice lives in localStorage as 'light', 'dark' or nothing ("match
 * the phone"), and shows up as <html data-theme>. index.html sets it before
 * the first paint; this file keeps it in step afterwards — the switches in
 * the headers, the picker in Settings, the phone changing its own mode, and
 * the browser bar colour.
 */
const Theme = (() => {
  const KEY = 'nayla.theme';
  const BAR = { light: '#F4F1F9', dark: '#13101A' };
  const phone = window.matchMedia?.('(prefers-color-scheme: dark)');

  function pref() {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'auto';
    } catch { return 'auto'; }
  }

  function current() {
    const p = pref();
    return p === 'auto' ? (phone?.matches ? 'dark' : 'light') : p;
  }

  function paint() {
    const t = current();
    document.documentElement.dataset.theme = t;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[t]);
    document.querySelectorAll('[data-theme-toggle]').forEach(b => {
      b.setAttribute('aria-checked', String(t === 'dark'));
    });
    const p = pref();
    document.querySelectorAll('[data-theme-pick]').forEach(b => {
      const on = b.dataset.themePick === p;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
  }

  /** Save a choice and repaint — with a circle of the new theme growing out
   *  of whatever was tapped, where the browser can do that. */
  function set(choice, from) {
    try {
      if (choice === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch { /* private mode: still changes for now */ }

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || still) { paint(); return; }
    if (from) {
      const r = from.getBoundingClientRect();
      const root = document.documentElement.style;
      root.setProperty('--tx', `${r.left + r.width / 2}px`);
      root.setProperty('--ty', `${r.top + r.height / 2}px`);
    }
    document.startViewTransition(paint);
  }

  function wire() {
    document.addEventListener('click', e => {
      const flip = e.target.closest('[data-theme-toggle]');
      if (flip) { set(current() === 'dark' ? 'light' : 'dark', flip); return; }
      const pick = e.target.closest('[data-theme-pick]');
      if (pick) set(pick.dataset.themePick, pick);
    });
    phone?.addEventListener?.('change', () => { if (pref() === 'auto') paint(); });
    paint();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();

  return { pref, current, set };
})();
