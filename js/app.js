/* App wiring: views, live timers, logging, stats, settings, sync UI.
 *
 * This file deliberately knows nothing about what a feed or a diaper is —
 * it renders whatever Features declares. Adding a feature should not need
 * an edit here.
 */
(() => {
  const $ = sel => document.querySelector(sel);
  const RING_CIRCUMFERENCE = 2 * Math.PI * 52;
  const NAP_REFERENCE_MS = 2 * Fmt.HOUR;   // the ring's full sweep while asleep

  Store.init();

  /* ── shell ───────────────────────────────────────────────── */
  /* Opens on Home. The tab is remembered for this browser session only, so
   * a reload — including the one after an app update — keeps you where you
   * were, while opening the app afresh always starts at Home. */
  const VIEW_KEY = 'nayla.view';
  const VIEWS = ['home', 'now', 'growing', 'history', 'settings'];
  let currentView = (() => {
    try { const v = sessionStorage.getItem(VIEW_KEY); return VIEWS.includes(v) ? v : 'home'; }
    catch { return 'home'; }
  })();

  function showView(name) {
    currentView = name;
    try { sessionStorage.setItem(VIEW_KEY, name); } catch { /* fine */ }
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-on', t.dataset.tab === name));
    window.scrollTo(0, 0);
    render();
  }

  document.querySelector('.tabbar').addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab) showView(tab.dataset.tab);
  });

  let toastTimer;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    // Long enough to actually read: a sentence of advice needs more than "Saved".
    toastTimer = setTimeout(() => { el.hidden = true; }, Math.max(2400, message.length * 70));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** The features this phone shows. Hidden ones keep their entries. */
  function enabled() {
    return Features.all().filter(f => Store.trackerOn(f.type));
  }

  /** Entries of the trackers that are on, newest first. */
  function visibleRecords() {
    return Store.all().filter(r => Store.trackerOn(r.type));
  }

  /* ── chrome built from the registry ──────────────────────── */
  /* Rebuilt on every render, since turning a tracker on or off changes it. */
  function buildChrome() {
    const quick = enabled().filter(f => f.quick);
    $('#quickGrid').innerHTML = quick.map(f =>
      `<button class="quick quick-${f.type}" data-log="${f.type}">
         <span class="quick-icon">${f.icon}</span><span>${f.label}</span>
       </button>`).join('');
    $('#quickTitle').hidden = !quick.length;

    if (historyFilter !== 'all' && !Store.trackerOn(historyFilter)) historyFilter = 'all';
    $('#historyFilters').innerHTML =
      `<button class="chip ${historyFilter === 'all' ? 'is-on' : ''}" data-filter="all">All</button>` +
      enabled().map(f =>
        `<button class="chip ${historyFilter === f.type ? 'is-on' : ''}" data-filter="${f.type}">${
          f.type === 'solids' || f.type === 'growth' ? f.label : `${f.label}s`}</button>`).join('');

    const growingTab = document.querySelector('.tab[data-tab="growing"]');
    growingTab.hidden = !Growing.anyOn();
    if (growingTab.hidden && currentView === 'growing') currentView = 'home';
    document.body.dataset.view = currentView;
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== currentView; });
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-on', t.dataset.tab === currentView));
  }

  /* ── NOW view ────────────────────────────────────────────── */
  function renderNow() {
    const settings = Store.settings();
    const records = visibleRecords();
    const sleepOn = Store.trackerOn('sleep');
    $('#wakeCard').hidden = !sleepOn;
    if (!sleepOn) $('#fixSleep').hidden = true;
    renderStatusRow(settings);
    renderToday(settings);
    renderList($('#recentList'), records.slice(0, 8), settings);
    if (!sleepOn) return;

    const st = Wake.state(Store.all(), Fmt.ageMonths(settings.dob));

    const card = $('#wakeCard');
    card.classList.toggle('is-sleeping', st.sleeping);
    card.classList.toggle('is-over', !st.sleeping && st.status === 'over');

    $('#wakeLabel').textContent = st.sleeping ? 'Asleep for' : 'Awake for';
    // A stale reading is a gap in the log, not a real duration — "100h" reads
    // like something is badly wrong with the baby rather than with the log.
    $('#wakeValue').textContent =
      (st.elapsedMs == null || st.stale) ? '—' : Fmt.duration(st.elapsedMs);
    $('#wakeSub').textContent = Wake.hint(st);
    $('#sleepToggle').textContent = st.sleeping ? 'Woke up' : 'Start sleep';

    // A "Start sleep" that never got its "Woke up". Offer to sort it out,
    // rather than silently counting up for days.
    const fix = $('#fixSleep');
    fix.hidden = !st.forgotten;
    if (st.forgotten) {
      fix.dataset.entry = st.forgotten.id;
      fix.textContent =
        `Sleep started ${Fmt.dayLabel(st.forgotten.at).toLowerCase()} at ` +
        `${Fmt.clock(st.forgotten.at)} was never closed — tap to fix`;
    }

    const ratio = st.sleeping
      ? Math.min(1, st.elapsedMs / NAP_REFERENCE_MS)
      : Math.min(1, st.ratio ?? 0);
    $('#ringFill').style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - ratio);
  }

  function renderStatusRow(settings) {
    const shown = enabled().filter(f => f.statusLabel);
    $('#statusRow').hidden = !shown.length;
    $('#statusRow').style.setProperty('--cols', shown.length || 1);
    $('#statusRow').innerHTML = shown.map(f => {
      const record = Store.latest(f.type, { completedOnly: Boolean(f.statusCompletedOnly) });
      return `<button class="stat" data-quick="${f.type}">
        <span class="stat-icon">${f.icon}</span>
        <span class="stat-label">${f.statusLabel}</span>
        <strong class="stat-value">${record ? escapeHtml(f.statusValue(record, settings)) : '—'}</strong>
        <span class="stat-note">${record ? escapeHtml(f.status(record, settings)) : 'nothing logged'}</span>
      </button>`;
    }).join('');
  }

  function renderToday(settings) {
    const totals = dayTotals(new Date());
    const cells = enabled().filter(f => f.todayCell);
    // Up to three across; four sit as a tidy 2×2 rather than three and a straggler.
    $('#todaySummary').style.setProperty('--cols', cells.length === 4 ? 2 : Math.min(3, cells.length) || 1);
    $('#todayTitle').hidden = !cells.length;
    $('#todaySummary').innerHTML = cells.map(f => {
      const cell = f.todayCell(totals, settings);
      if (!cell) return '';
      return `<div class="today-cell">
        <span>${cell.label}</span><b>${escapeHtml(String(cell.value))}</b>
        <em>${cell.note ? escapeHtml(cell.note) : '&nbsp;'}</em></div>`;
    }).join('');
  }

  /** Totals for a local day. Features that span time count their overlap, so
   *  a sleep across midnight is credited to both days. */
  function dayTotals(date) {
    const from = new Date(date); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    const a = from.getTime(), b = to.getTime();
    const window = { from: a, to: Math.min(b, Date.now()) };

    const totals = {};
    for (const record of Store.forDay(from)) {
      const feature = Features.get(record.type);
      if (!feature?.tally) continue;
      if (!feature.spansTime && !(record.at >= a && record.at < b)) continue;
      feature.tally(record, totals, window);
    }
    return totals;
  }

  /* ── record lists ────────────────────────────────────────── */
  function renderList(container, records, settings) {
    if (!records.length) {
      container.innerHTML = `<li class="empty">Nothing logged yet.</li>`;
      return;
    }
    container.innerHTML = records.map(r => {
      const feature = Features.get(r.type);
      const { title, detail } = feature.describe(r, settings);
      const live = r.type === 'sleep' && r.end == null;
      const note = r.note ? ` · ${escapeHtml(r.note)}` : '';
      return `<li><button class="entry ${live ? 'is-live' : ''}" data-entry="${r.id}">
        <span class="entry-dot ${r.type}">${feature.icon}</span>
        <span class="entry-main">
          <span class="entry-title">${escapeHtml(title)}</span>
          <span class="entry-sub">${escapeHtml(detail)}${note}</span>
        </span>
        <span class="entry-time">${live ? Fmt.duration(Date.now() - r.at)
          : feature.dateOnly ? Fmt.shortDate(r.at) : Fmt.clock(r.at)}</span>
      </button></li>`;
    }).join('');
  }

  /* ── HISTORY view ────────────────────────────────────────── */
  let historyFilter = 'all';

  $('#historyFilters').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    historyFilter = chip.dataset.filter;
    document.querySelectorAll('#historyFilters .chip')
      .forEach(c => c.classList.toggle('is-on', c === chip));
    renderHistory();
  });

  function renderHistory() {
    const settings = Store.settings();
    const records = historyFilter === 'all' ? visibleRecords() : Store.byType(historyFilter);
    const target = $('#historyList');
    if (!records.length) {
      target.innerHTML = `<p class="empty">No entries yet.</p>`;
      return;
    }

    const groups = new Map();
    for (const r of records) {
      const key = Fmt.dayKey(r.at);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }

    target.innerHTML = [...groups.values()].map(group => {
      const totals = dayTotals(new Date(group[0].at));
      const summary = enabled()
        .map(f => f.todayCell?.(totals, settings))
        .filter(Boolean)
        .map(c => `${c.value} ${c.label.toLowerCase()}`)
        .join(' · ');
      return `<div class="day-group">
        <div class="day-head"><h3>${Fmt.dayLabel(group[0].at)}</h3><span>${escapeHtml(summary)}</span></div>
        <ul class="entries" data-day="${Fmt.dayKey(group[0].at)}"></ul>
      </div>`;
    }).join('');

    [...groups.entries()].forEach(([key, group]) => {
      renderList(target.querySelector(`[data-day="${key}"]`), group, settings);
    });
  }

  /* ── STATS view ──────────────────────────────────────────── */
  function renderStats() {
    const settings = Store.settings();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({ date: d, ...dayTotals(d) });
    }

    const on = type => Store.trackerOn(type);
    if (!days.some(d => (on('feed') && d.feeds) || (on('diaper') && d.diapers) ||
                        (on('sleep') && d.sleepMs) || (on('solids') && d.meals))) {
      $('#statsBody').innerHTML = `<p class="empty">Log a few days and trends will show up here.</p>`;
      return;
    }

    $('#statsBody').innerHTML = [
      on('sleep') && block('Sleep per day', days, 'sleep', d => d.sleepMs || 0, ms => Fmt.duration(ms)),
      on('feed') && block('Feeds per day', days, 'feed', d => d.feeds || 0, n => `${n}`),
      on('feed') && days.some(d => d.feedMl) &&
        block('Bottle volume per day', days, 'feed', d => d.feedMl || 0,
              ml => Fmt.amount(ml, settings.units)),
      on('diaper') && block('Diapers per day', days, 'diaper', d => d.diapers || 0, n => `${n}`),
      on('solids') && days.some(d => d.meals) &&
        block('Solid meals per day', days, 'solids', d => d.meals || 0, n => `${n}`),
    ].filter(Boolean).join('');
  }

  function block(heading, days, kind, pick, label) {
    const values = days.map(pick);
    const max = Math.max(...values, 1);
    const rows = days.map((d, i) => `
      <div class="bar-row">
        <span class="bar-day">${shortDay(d.date)}</span>
        <div class="bar-track"><div class="bar-fill ${kind} ${values[i] ? '' : 'is-zero'}" style="width:${(values[i] / max) * 100}%"></div></div>
        <span class="bar-val">${values[i] ? label(values[i]) : '—'}</span>
      </div>`).join('');
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return `<div class="stat-block"><h3>${heading}</h3><div class="bars">${rows}</div>
      <p class="avg">7-day average: ${label(Math.round(avg))}</p></div>`;
  }

  function shortDay(date) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(date); d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) return 'Today';
    return d.toLocaleDateString([], { weekday: 'short' });
  }

  /* ── logging actions ─────────────────────────────────────── */
  function openSheet(type, record) {
    Sheet.open({
      type, record,
      onSave(fields, existing) {
        const saved = existing ? Store.update(existing.id, fields) : Store.add(fields);
        const said = Features.get(type).afterSave?.(saved, Store.settings());
        toast(said || (existing ? 'Updated' : 'Saved'));
      },
      onDelete(existing) {
        Features.get(type).onDelete?.(existing);
        Store.remove(existing.id);
        toast('Deleted');
      },
      onError(message) { toast(message); },
    });
  }

  document.addEventListener('click', e => {
    const log = e.target.closest('[data-log]');
    if (log) { openSheet(log.dataset.log); return; }

    const quick = e.target.closest('[data-quick]');
    if (quick) {
      const last = Store.latest(quick.dataset.quick);
      openSheet(quick.dataset.quick, last || undefined);
      return;
    }

    const entryBtn = e.target.closest('[data-entry]');
    if (entryBtn) {
      const record = Store.get(entryBtn.dataset.entry);
      if (record) openSheet(record.type, record);
    }
  });

  function toggleSleep() {
    // Deliberately Wake's view, not Store's: a sleep left running for days is
    // not the one this button should close.
    const active = Wake.state(Store.all(), Fmt.ageMonths(Store.settings().dob)).entry;
    if (active && active.end == null) {
      Store.update(active.id, { end: Date.now() });
      toast(`Slept ${Fmt.duration(Date.now() - active.at)}`);
    } else {
      Store.add({ type: 'sleep', at: Date.now(), end: null, data: {} });
      toast('Sleep started');
    }
  }

  $('#sleepToggle').addEventListener('click', toggleSleep);

  /* ── speaking instead of tapping ─────────────────────────── */
  let pendingVoice = null;

  function showVoice(result) {
    pendingVoice = result;
    $('#voiceHeard').textContent = result.heard;
    $('#voiceSummary').textContent =
      result.kind === 'wake' ? 'Woke up' : result.summary;
    const at = result.kind === 'wake' ? Date.now() : result.record.at;
    $('#voiceWhen').textContent = Math.abs(Date.now() - at) < 60000
      ? 'Just now' : `At ${Fmt.clock(at)}, ${Fmt.ago(at)}`;
    $('#voiceSheet').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeVoice() {
    $('#voiceSheet').hidden = true;
    document.body.style.overflow = '';
    pendingVoice = null;
  }

  async function listen() {
    const btn = $('#micBtn');
    btn.classList.add('is-listening');
    $('#micLabel').textContent = 'Listening…';
    try {
      const heard = await Voice.listen();
      const result = Voice.parse(heard);
      if (!result) {
        toast(`Didn't understand “${heard}”`);
        return;
      }
      showVoice(result);
    } catch (err) {
      const why = Voice.explain(err);
      if (why) toast(why);
    } finally {
      btn.classList.remove('is-listening');
      $('#micLabel').textContent = 'Say it instead';
    }
  }

  function saveVoice() {
    if (!pendingVoice) return;
    if (pendingVoice.kind === 'wake') {
      const asleep = Wake.state(Store.all(), Fmt.ageMonths(Store.settings().dob)).entry;
      if (asleep && asleep.end == null) {
        Store.update(asleep.id, { end: Date.now() });
        toast(`Slept ${Fmt.duration(Date.now() - asleep.at)}`);
      } else {
        toast('No sleep was running.');
      }
    } else {
      Store.add(pendingVoice.record);
      toast('Logged');
    }
    closeVoice();
  }

  $('#micBtn').addEventListener('click', listen);
  $('#voiceSave').addEventListener('click', saveVoice);
  $('#voiceClose').addEventListener('click', closeVoice);
  $('#voiceSheet').addEventListener('click', e => {
    if (e.target.id === 'voiceSheet') closeVoice();
  });
  // Heard it wrong, or wants to add a note: hand it to the normal editor.
  $('#voiceEdit').addEventListener('click', () => {
    const result = pendingVoice;
    closeVoice();
    if (!result) return;
    if (result.kind === 'wake') { openSheet('sleep', Store.activeSleep() || undefined); return; }
    const saved = Store.add(result.record);
    openSheet(saved.type, saved);
  });

  /* ── SETTINGS view ───────────────────────────────────────── */
  function renderSettings() {
    const s = Store.settings();
    setIfIdle($('#setName'), s.name);
    setIfIdle($('#setDob'), s.dob);
    setIfIdle($('#setUnits'), s.units);
    setIfIdle($('#setSex'), s.sex);
    setIfIdle($('#setGrowthUnits'), s.growthUnits);
    Home.hasPickedHero().then(has => { $('#homePhotoRow').hidden = !has; });
    renderTrackers();
    // Show what sync is really using. These fall back to config.js, so
    // displaying only the stored override made a working setup look blank.
    const effective = Sync.effective();
    setIfIdle($('#setSyncUrl'), effective.url);
    setIfIdle($('#setSyncKey'), effective.key);
    setIfIdle($('#setSyncCode'), effective.code);

    const n = Store.all().length;
    $('#dataCount').textContent = `${n} entr${n === 1 ? 'y' : 'ies'} in the log.`;
    $('#dataScope').textContent = Sync.enabled()
      ? 'Entries are kept on this device and synced to your server. Export a backup anyway — this app should never be the only copy.'
      : 'Everything is stored on this device only. Nothing is uploaded anywhere.';
    renderSyncStatus();
  }

  const TRACKER_NOTES = {
    feed: 'Bottle and breast feeds',
    diaper: 'Wet and dirty changes',
    sleep: 'Naps, nights and the wake-window ring',
    solids: 'Meals, foods tried and allergens',
    growth: 'Weight, length and head on the WHO chart',
    milestone: 'Firsts, with a photo',
  };

  function renderTrackers() {
    const el = $('#trackerList');
    if (el.contains(document.activeElement)) return;
    el.innerHTML = Features.all().map(f => `
      <label class="tracker-row">
        <span class="tracker-icon tracker-${f.type}" aria-hidden="true">${f.icon}</span>
        <span class="tracker-text"><b>${f.label}</b><em>${TRACKER_NOTES[f.type] || ''}</em></span>
        <input type="checkbox" class="switch" data-tracker="${f.type}"
               ${Store.trackerOn(f.type) ? 'checked' : ''}>
      </label>`).join('');
  }

  $('#trackerList').addEventListener('change', e => {
    const box = e.target.closest('[data-tracker]');
    if (!box) return;
    const trackers = { ...Store.settings().trackers, [box.dataset.tracker]: box.checked };
    if (!Features.types().some(t => trackers[t] !== false)) {
      box.checked = true;
      toast('Keep at least one tracker on.');
      return;
    }
    Store.saveSettings({ trackers });
  });

  /** Never overwrite a field the user is currently typing in. */
  function setIfIdle(el, value) {
    if (el && document.activeElement !== el) el.value = value ?? '';
  }

  /* Sharing should feel like it just works, so this stays quiet.
   *
   * A failed sync is not news: entries are saved either way and go up on
   * their own. Saying so every time would train both of us to worry about
   * something that needs no action. So nothing is shown while it is working,
   * nor for a blip — only once it has genuinely been stuck for an hour, which
   * is the point where somebody might actually want to look into it. */
  const STUCK_AFTER_MS = 60 * 60 * 1000;

  function renderSyncStatus() {
    const st = Sync.status();
    const el = $('#syncStatus');
    if (!el) return;

    const paired = Boolean(Store.settings().syncCode);
    const stuck = st.enabled && st.error &&
                  st.lastSyncedAt && Date.now() - st.lastSyncedAt > STUCK_AFTER_MS;
    // Never synced at all, and erroring — worth saying, since it may be set up wrong.
    const neverWorked = st.enabled && st.error && !st.lastSyncedAt;

    el.hidden = !(stuck || neverWorked);
    el.classList.toggle('is-bad', true);
    if (!el.hidden) {
      el.textContent = `Hasn't reached the server ${st.lastSyncedAt
        ? `since ${Fmt.ago(st.lastSyncedAt)}` : 'yet'} — ${st.error} `;
    }

    $('#pairBtn').textContent = paired
      ? 'Add another phone' : 'Share this log with another phone';
    $('#syncHint').textContent = paired
      ? 'Every phone with this code shows the same log, and updates itself.'
      : 'Scan one code and both phones share the same log, updating on their own.';
  }

  $('#setName').addEventListener('input', e => Store.saveSettings({ name: e.target.value.trim() }));
  $('#setDob').addEventListener('change', e => Store.saveSettings({ dob: e.target.value }));
  $('#setUnits').addEventListener('change', e => Store.saveSettings({ units: e.target.value }));
  $('#setSex').addEventListener('change', e => Store.saveSettings({ sex: e.target.value }));
  $('#setGrowthUnits').addEventListener('change', e => Store.saveSettings({ growthUnits: e.target.value }));

  // Changing where we sync to invalidates the pull cursor — start over.
  $('#setSyncUrl').addEventListener('change', e =>
    Store.saveSettings({ syncUrl: e.target.value.trim(), lastPulledAt: 0 }));
  $('#setSyncKey').addEventListener('change', e =>
    Store.saveSettings({ syncKey: e.target.value.trim() }));
  $('#setSyncCode').addEventListener('change', e =>
    Store.saveSettings({ syncCode: e.target.value.trim(), lastPulledAt: 0 }));

  $('#pairBtn').addEventListener('click', () => {
    // First tap on a fresh phone: make a code, then show it.
    if (!Store.settings().syncCode) {
      Store.saveSettings({ syncCode: Sync.newPairingCode(), lastPulledAt: 0 });
    }
    const res = Pair.open();
    if (res.error) toast(res.error);
  });

  $('#pairClose').addEventListener('click', Pair.close);
  $('#pairSheet').addEventListener('click', e => {
    if (e.target.id === 'pairSheet') Pair.close();
  });

  $('#pairShare').addEventListener('click', async () => {
    const how = await Pair.share();
    if (how === 'copied') toast('Link copied — paste it to her');
    else if (how === 'failed') toast("Couldn't share the link on this browser.");
  });

  $('#genCode').addEventListener('click', () => {
    if (Store.settings().syncCode &&
        !confirm('Start a new pairing code?\n\nThis log moves across to it, but every other ' +
                 'phone stops syncing until you show them the new code. To add a phone, you ' +
                 'do not need this — just scan the code you already have.')) return;
    const code = Sync.newPairingCode();
    // A new code is for cutting phones off, so the photo key goes with it.
    Store.saveSettings({ syncCode: code, photoKey: Photos.newKey(), lastPulledAt: 0 });
    $('#setSyncCode').value = code;
    toast('New pairing code');
  });

  $('#syncNow').addEventListener('click', async () => {
    if (!Sync.enabled()) { toast('Pair a phone first.'); return; }
    const st = await Sync.run();
    toast(st.error ? `Still ${st.error}` : 'Up to date');
  });

  Sync.onChange(() => { if (currentView === 'settings') renderSyncStatus(); });

  /* ── backup / restore ────────────────────────────────────── */
  function download(filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const stamp = () => new Date().toISOString().slice(0, 10);

  $('#exportJson').addEventListener('click', () => {
    download(`nayla-backup-${stamp()}.json`,
      JSON.stringify(Store.exportData(), null, 2), 'application/json');
  });

  $('#exportCsv').addEventListener('click', () => {
    const settings = Store.settings();
    const rows = [['type', 'start', 'end', 'duration_min', 'detail', `amount_${settings.units}`, 'note', 'more']];
    for (const r of [...Store.all()].reverse()) {
      const feature = Features.get(r.type);
      rows.push([
        r.type,
        new Date(r.at).toISOString(),
        r.end ? new Date(r.end).toISOString() : '',
        r.end ? Math.round((r.end - r.at) / Fmt.MIN) : '',
        feature.describe(r, settings).title,
        r.data.amount != null ? Fmt.fromMl(r.data.amount, settings.units) : '',
        r.note || '',
        feature.describe(r, settings).detail || '',
      ]);
    }
    download(`nayla-log-${stamp()}.csv`,
      rows.map(r => r.map(csvCell).join(',')).join('\n'), 'text/csv');
  });

  function csvCell(value) {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  $('#importBtn').addEventListener('click', () => $('#importFile').click());

  $('#importFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data) ? data : (data.records || data.entries);
      if (!Array.isArray(incoming)) throw new Error('no records in file');
      const shared = Sync.enabled()
        ? ' The imported entries will sync to the other phone as well.' : '';
      if (!confirm(`Replace this phone's log with ${incoming.length} imported entries?${shared}`)) return;
      Store.replaceAll(incoming, Array.isArray(data) ? null : data.settings);
      toast('Backup restored');
    } catch (err) {
      console.warn(err);
      toast("That file doesn't look like a Nayla backup.");
    } finally {
      e.target.value = '';
    }
  });

  $('#clearBtn').addEventListener('click', () => {
    const shared = Sync.enabled()
      ? ' This deletes them on the other phone too, not just this one.' : '';
    if (!confirm(`Delete every entry?${shared} This cannot be undone — export a backup first if you might want it.`)) return;
    Store.clear();
    toast('All entries deleted');
  });

  /* ── render loop ─────────────────────────────────────────── */
  function render() {
    const s = Store.settings();
    $('#babyName').textContent = s.name || 'Baby';
    $('#babyAge').textContent = Fmt.age(s.dob);

    buildChrome();
    if (currentView === 'home') { Home.render(); renderStats(); }
    else if (currentView === 'now') renderNow();
    else if (currentView === 'growing') Growing.render($('#growingBody'), { renderList });
    else if (currentView === 'history') renderHistory();
    else if (currentView === 'settings') renderSettings();
  }

  Growing.wire($('#growingBody'), render);
  Home.wire({
    openSheet: type => openSheet(type),
    openEntry: id => { const r = Store.get(id); if (r) openSheet(r.type, r); },
    toggleSleep,
    rerender: render,
    toast,
  });

  $('#homePhotoClear').addEventListener('click', async () => {
    await Home.clearHero();
    $('#homePhotoRow').hidden = true;
    toast('Home photo removed');
  });

  // Hidden entirely where the browser can't do it, rather than offering a
  // button that does nothing.
  $('#micBtn').hidden = !Voice.supported();

  // Opened from a pairing link: adopt the code before the first render, so
  // she never sees an unpaired screen that then changes under her.
  /** Take on the code and photo key from a pairing link. */
  function adopt(invite) {
    const s = Store.settings();
    if (invite.code !== s.syncCode) Store.saveSettings({ syncCode: invite.code, lastPulledAt: 0 });
    if (invite.key && invite.key !== s.photoKey) Store.saveSettings({ photoKey: invite.key });
  }

  const invited = Pair.claimFromUrl();
  if (invited) adopt(invited);

  Store.onChange(render);
  render();
  Sync.start();
  Photos.start();
  Install.start();

  if (invited) {
    toast('Paired — getting the latest entries');
    Sync.run();
  }

  // Tapping a pairing link while the app is ALREADY open changes only the
  // fragment, which is not a page load — app startup never runs, and without
  // this the link would appear to do nothing at all.
  window.addEventListener('hashchange', () => {
    const invite = Pair.claimFromUrl();
    if (!invite) return;
    adopt(invite);
    toast('Paired — getting the latest entries');
    Sync.run();
  });

  // Relative times drift; refresh them steadily, and immediately on return.
  setInterval(() => { if (!Sheet.isOpen()) render(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

  if ('serviceWorker' in navigator) {
    // True only for a returning visitor whose page loaded already under an
    // earlier service worker. A brand-new visitor has no controller yet at
    // this point, and controllerchange fires anyway the moment the very
    // first worker claims the page — which is not an update, and reloading
    // for it would just be a pointless flicker right as the app opens.
    const hadController = Boolean(navigator.serviceWorker.controller);

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
    });

    // A new service worker taking over means updated code just finished
    // installing in the background. Reload once so it's actually in use,
    // instead of leaving stale JS running until the tab next happens to
    // close and reopen. Skipped while the entry sheet is open, so an update
    // landing mid-edit can never wipe out something she's in the middle of
    // typing — she picks it up next time she opens the app instead.
    let reloadedForUpdate = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadedForUpdate || !hadController || Sheet.isOpen()) return;
      reloadedForUpdate = true;
      location.reload();
    });
  }
})();
