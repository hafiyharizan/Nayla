/* "Add to Home Screen", for someone who should not have to know what a PWA is.
 *
 * The two platforms need completely different things:
 *
 *   Android/Chrome  fires beforeinstallprompt, so one tap can do the whole
 *                   job. We catch the event and drive it from our own button.
 *   iOS/Safari      has no such API — the only way in is the Share menu. So
 *                   we show illustrated steps pointing at the real buttons,
 *                   with the actual iOS icons drawn inline so they can be
 *                   matched by shape rather than by name.
 *
 * Other iOS browsers (Chrome, Firefox) cannot add to the home screen at all,
 * so those get told to reopen the page in Safari — otherwise they follow the
 * steps, find no such menu item, and give up.
 */
const Install = (() => {
  const DISMISSED = 'nayla.install.dismissed';

  let deferredPrompt = null;   // Android's beforeinstallprompt, saved for later

  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Every iOS browser is WebKit, so sniff for the wrappers that are not Safari.
  const isIOSOtherBrowser = isIOS && /crios|fxios|edgios|opios/i.test(ua);
  const isAndroid = /android/i.test(ua);

  function isInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  function dismissed() {
    try { return localStorage.getItem(DISMISSED) === '1'; } catch { return false; }
  }

  function remember() {
    try { localStorage.setItem(DISMISSED, '1'); } catch { /* private mode */ }
  }

  /* ── the iOS share glyph, drawn so it can be matched by shape ── */
  const SHARE_ICON = `<svg viewBox="0 0 24 24" class="ios-glyph" aria-hidden="true">
    <path d="M12 3.2v10.4" stroke-linecap="round"/>
    <path d="M8.6 6.6 12 3.2l3.4 3.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8 10H6a2 2 0 0 0-2 2v6.2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V12a2 2 0 0 0-2-2h-2"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  const ADD_ICON = `<svg viewBox="0 0 24 24" class="ios-glyph" aria-hidden="true">
    <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" fill="none"/>
    <path d="M12 8.5v7M8.5 12h7" fill="none" stroke-linecap="round"/>
  </svg>`;

  function steps() {
    if (isIOSOtherBrowser) {
      return `<p class="install-lead">This browser can't add apps to the Home Screen —
                only Safari can on iPhone.</p>
              <ol class="install-steps">
                <li><span class="step-n">1</span>
                  <span>Copy this page's link, open <b>Safari</b>, and paste it there.</span></li>
                <li><span class="step-n">2</span>
                  <span>Then follow the <b>Share → Add to Home Screen</b> steps.</span></li>
              </ol>`;
    }
    if (isIOS) {
      return `<p class="install-lead">Three taps, and Nayla sits on your Home Screen
                like any other app.</p>
              <ol class="install-steps">
                <li><span class="step-n">1</span>
                  <span>Tap the <b>Share</b> button ${SHARE_ICON} at the bottom of the screen.</span></li>
                <li><span class="step-n">2</span>
                  <span>Scroll down the list and tap <b>Add to Home Screen</b> ${ADD_ICON}</span></li>
                <li><span class="step-n">3</span>
                  <span>Tap <b>Add</b> in the top corner. Done.</span></li>
              </ol>
              <p class="install-foot">If you don't see the Share button, scroll the page down a little
                — Safari hides its toolbar as you scroll up.</p>`;
    }
    if (isAndroid) {
      return `<p class="install-lead">Nayla can sit on your Home Screen like any other app.</p>
              <ol class="install-steps">
                <li><span class="step-n">1</span>
                  <span>Tap the <b>⋮</b> menu at the top right of Chrome.</span></li>
                <li><span class="step-n">2</span>
                  <span>Tap <b>Add to Home screen</b>, then <b>Install</b>.</span></li>
              </ol>`;
    }
    return `<p class="install-lead">Open this page on your phone to add it to the Home Screen.
              In a desktop browser, look for an install icon in the address bar.</p>`;
  }

  /* ── the guide sheet ── */
  function openGuide() {
    document.getElementById('installSteps').innerHTML = steps();
    const sheet = document.getElementById('installGuide');
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeGuide() {
    document.getElementById('installGuide').hidden = true;
    document.body.style.overflow = '';
  }

  /* ── the banner ── */
  function showBanner() {
    document.getElementById('installBanner').hidden = false;
  }

  function hideBanner() {
    document.getElementById('installBanner').hidden = true;
  }

  /** The one action the banner's main button performs, per platform. */
  async function install() {
    if (deferredPrompt) {
      hideBanner();
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === 'accepted') remember();
      else showBanner();          // changed their mind; leave the offer up
      return;
    }
    openGuide();                  // iOS, and Android before the event arrives
  }

  function start() {
    // Chrome fires this when the app qualifies to be installed. Holding onto
    // it lets us offer installation in our own words, at our own moment.
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredPrompt = e;
      if (!isInstalled() && !dismissed()) showBanner();
    });

    window.addEventListener('appinstalled', () => {
      remember();
      hideBanner();
      deferredPrompt = null;
    });

    document.getElementById('installAdd').addEventListener('click', install);
    document.getElementById('installLater').addEventListener('click', () => {
      remember();
      hideBanner();
    });
    document.getElementById('installGuideClose').addEventListener('click', closeGuide);
    document.getElementById('installGuide').addEventListener('click', e => {
      if (e.target.id === 'installGuide') closeGuide();
    });

    // Settings always offers it, even after the banner has been dismissed.
    const fromSettings = document.getElementById('installHelp');
    if (fromSettings) fromSettings.addEventListener('click', install);

    // iOS never fires beforeinstallprompt, so offer the guide unprompted —
    // but only once the app has actually rendered, so it isn't the first
    // thing a new user sees.
    if (!isInstalled() && !dismissed() && (isIOS || !deferredPrompt)) {
      setTimeout(() => {
        if (!isInstalled() && !dismissed()) showBanner();
      }, 2500);
    }

    if (isInstalled()) {
      const row = document.getElementById('installRow');
      if (row) row.hidden = true;      // nothing left to install
    }
  }

  return { start, openGuide, isInstalled };
})();
