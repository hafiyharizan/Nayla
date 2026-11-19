/* Log's Right now row: the alerts (alerts.js) and Next up (next.js) as one
 * line of cards you swipe sideways, rather than two lists to scroll past.
 *
 * It drifts on to the next card every few seconds and wraps back to the
 * first. It holds still while you touch it, for a little while after, while
 * a sheet is open or the tab is hidden, and always under reduced motion.
 *
 * The cards stay in their own lists (#logAlerts, #logNext); those lists are
 * display: contents, and CSS `order` interleaves them by urgency — so the
 * order on screen, which is what this follows, comes from the cards'
 * positions rather than from the DOM.
 */
const Carousel = (() => {
  const EVERY = 5000;          // between drifts
  const HOLD = 9000;           // still, after you last touched it
  let track, dots;
  let heldUntil = 0;
  let timer = null;

  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function cards() {
    return [...track.querySelectorAll(':scope > ul:not([hidden]) > li')]
      .sort((a, b) => a.offsetLeft - b.offsetLeft);
  }

  const pad = () => parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;

  /** The card snapped at the start, by position. */
  function currentIndex(list) {
    const x = track.scrollLeft + pad();
    let best = 0, bestD = Infinity;
    list.forEach((c, i) => {
      const d = Math.abs(c.offsetLeft - x);
      if (d < bestD) { best = i; bestD = d; }
    });
    // Scrolled to the very end, the last card may never reach the start.
    if (track.scrollLeft >= track.scrollWidth - track.clientWidth - 2) best = list.length - 1;
    return best;
  }

  function go(i, list = cards(), smooth = true) {
    const card = list[i];
    if (!card) return;
    track.scrollTo({ left: Math.max(0, card.offsetLeft - pad()), behavior: smooth ? 'smooth' : 'auto' });
  }

  function paintDots() {
    const list = cards();
    track.classList.toggle('is-single', list.length < 2);
    if (list.length < 2) { dots.hidden = true; dots.innerHTML = ''; return; }
    dots.hidden = false;
    if (dots.children.length !== list.length) dots.innerHTML = '<i></i>'.repeat(list.length);
    const at = currentIndex(list);
    [...dots.children].forEach((d, i) => d.classList.toggle('is-on', i === at));
  }

  function tick() {
    if (Date.now() < heldUntil || document.hidden || reducedMotion()) return;
    if (!track.offsetParent || (window.Sheet && Sheet.isOpen())) return;   // Log not showing
    const list = cards();
    if (list.length < 2) return;
    const at = currentIndex(list);
    go(at + 1 < list.length ? at + 1 : 0, list);
  }

  const hold = () => { heldUntil = Date.now() + HOLD; };

  function init() {
    track = document.getElementById('logCarousel');
    dots = document.getElementById('logDots');
    if (!track) return;
    for (const ev of ['pointerdown', 'touchstart', 'wheel', 'focusin', 'keydown']) {
      track.addEventListener(ev, hold, { passive: true });
    }
    let raf = 0;
    track.addEventListener('scroll', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(paintDots);
    }, { passive: true });
    timer = setInterval(tick, EVERY);
  }

  /** After Log redraws its cards. */
  function refresh() { if (track) paintDots(); }

  /** Opening Log starts from the first, most urgent card. */
  function restart() {
    if (!track) return;
    track.scrollLeft = 0;
    heldUntil = Date.now();   // and the full wait before the first drift
    clearInterval(timer);
    timer = setInterval(tick, EVERY);
  }

  init();
  return { refresh, restart };
})();
