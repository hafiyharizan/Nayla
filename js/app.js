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
  let currentView = 'now';

  function showView(name) {
    currentView = name;
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
    toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── static chrome built from the registry ───────────────── */
  function buildChrome() {
    $('#quickGrid').innerHTML = Features.all().map(f =>
      `<button class="quick quick-${f.type}" data-log="${f.type}">
         <span class="quick-icon">${f.icon}</span><span>${f.label}</span>
       </button>`).join('');

    $('#historyFilters').innerHTML =
      `<button class="chip is-on" data-filter="all">All</button>` +
      Features.all().map(f =>
        `<button class="chip" data-filter="${f.type}">${f.label}s</button>`).join('');
  }

  /* ── NOW view ────────────────────────────────────────────── */
  function renderNow() {
    const settings = Store.settings();
    const records = Store.all();
    const st = Wake.state(records, Fmt.ageMonths(settings.dob));

    const card = $('#wakeCard');
    card.classList.toggle('is-sleeping', st.sleeping);
    card.classList.toggle('is-over', !st.sleeping && st.status === 'over');

    $('#wakeLabel').textContent = st.sleeping ? 'Asleep for' : 'Awake for';
    $('#wakeValue').textContent = st.elapsedMs == null ? '—' : Fmt.duration(st.elapsedMs);
    $('#wakeSub').textContent = Wake.hint(st);
    $('#sleepToggle').textContent = st.sleeping ? 'Woke up' : 'Start sleep';

    const ratio = st.sleeping
      ? Math.min(1, st.elapsedMs / NAP_REFERENCE_MS)
      : Math.min(1, st.ratio ?? 0);
    $('#ringFill').style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - ratio);

    renderStatusRow(settings);
    renderToday(settings);
    renderList($('#recentList'), records.slice(0, 8), settings);
  }

  function renderStatusRow(settings) {
    $('#statusRow').innerHTML = Features.all().map(f => {
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
    $('#todaySummary').innerHTML = Features.all().map(f => {
      const cell = f.todayCell?.(totals, settings);
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
      container.innerHTML = `<li class="empty">Nothing logged yet. Tap a button above to start.</li>`;
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
        <span class="entry-time">${live ? Fmt.duration(Date.now() - r.at) : Fmt.clock(r.at)}</span>
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
    const records = Store.byType(historyFilter);
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
      const summary = Features.all()
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

    if (!days.some(d => d.feeds || d.diapers || d.sleepMs)) {
      $('#statsBody').innerHTML = `<p class="empty">Log a few days and trends will show up here.</p>`;
      return;
    }

    $('#statsBody').innerHTML = [
      block('Sleep per day', days, 'sleep', d => d.sleepMs || 0, ms => Fmt.duration(ms)),
      block('Feeds per day', days, 'feed', d => d.feeds || 0, n => `${n}`),
      block('Diapers per day', days, 'diaper', d => d.diapers || 0, n => `${n}`),
      days.some(d => d.feedMl)
        ? block('Bottle volume per day', days, 'feed', d => d.feedMl || 0,
                ml => Fmt.amount(ml, settings.units))
        : '',
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
        if (existing) { Store.update(existing.id, fields); toast('Updated'); }
        else { Store.add(fields); toast('Saved'); }
      },
      onDelete(existing) { Store.remove(existing.id); toast('Deleted'); },
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

  $('#sleepToggle').addEventListener('click', () => {
    const active = Store.activeSleep();
    if (active) {
      Store.update(active.id, { end: Date.now() });
      toast(`Slept ${Fmt.duration(Date.now() - active.at)}`);
    } else {
      Store.add({ type: 'sleep', at: Date.now(), end: null, data: {} });
      toast('Sleep started');
    }
  });

  /* ── SETTINGS view ───────────────────────────────────────── */
  function renderSettings() {
    const s = Store.settings();
    setIfIdle($('#setName'), s.name);
    setIfIdle($('#setDob'), s.dob);
    setIfIdle($('#setUnits'), s.units);
    setIfIdle($('#setSyncUrl'), s.syncUrl);
    setIfIdle($('#setSyncKey'), s.syncKey);
    setIfIdle($('#setSyncCode'), s.syncCode);

    const n = Store.all().length;
    $('#dataCount').textContent = `${n} entr${n === 1 ? 'y' : 'ies'} in the log.`;
    $('#dataScope').textContent = Sync.enabled()
      ? 'Entries are kept on this device and synced to your server. Export a backup anyway — this app should never be the only copy.'
      : 'Everything is stored on this device only. Nothing is uploaded anywhere.';
    renderSyncStatus();
  }

  /** Never overwrite a field the user is currently typing in. */
  function setIfIdle(el, value) {
    if (el && document.activeElement !== el) el.value = value ?? '';
  }

  function renderSyncStatus() {
    const st = Sync.status();
    const el = $('#syncStatus');
    if (!el) return;
    if (!st.enabled) el.textContent = 'Sync is off — the log stays on this device.';
    else if (st.busy) el.textContent = 'Syncing…';
    else if (st.error) el.textContent = `Last sync failed: ${st.error}`;
    else if (st.lastSyncedAt) el.textContent = `Synced ${Fmt.ago(st.lastSyncedAt)}.`;
    else el.textContent = 'Sync is on — waiting for the first run.';
  }

  $('#setName').addEventListener('input', e => Store.saveSettings({ name: e.target.value.trim() }));
  $('#setDob').addEventListener('change', e => Store.saveSettings({ dob: e.target.value }));
  $('#setUnits').addEventListener('change', e => Store.saveSettings({ units: e.target.value }));

  // Changing where we sync to invalidates the pull cursor — start over.
  $('#setSyncUrl').addEventListener('change', e =>
    Store.saveSettings({ syncUrl: e.target.value.trim(), lastPulledAt: 0 }));
  $('#setSyncKey').addEventListener('change', e =>
    Store.saveSettings({ syncKey: e.target.value.trim() }));
  $('#setSyncCode').addEventListener('change', e =>
    Store.saveSettings({ syncCode: e.target.value.trim(), lastPulledAt: 0 }));

  $('#genCode').addEventListener('click', () => {
    if (Store.settings().syncCode &&
        !confirm('Replace the current pairing code? The other phone will stop syncing until you give it the new one.')) return;
    const code = Sync.newPairingCode();
    Store.saveSettings({ syncCode: code, lastPulledAt: 0 });
    $('#setSyncCode').value = code;
    toast('New pairing code');
  });

  $('#syncNow').addEventListener('click', async () => {
    if (!Sync.enabled()) { toast('Fill in all three sync fields first.'); return; }
    const st = await Sync.run();
    toast(st.error ? st.error : 'Synced');
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
    const rows = [['type', 'start', 'end', 'duration_min', 'detail', `amount_${settings.units}`, 'note']];
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
      if (!confirm(`Replace the current log with ${incoming.length} imported entries?`)) return;
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
    if (!confirm('Delete every entry? This cannot be undone — export a backup first if you might want it.')) return;
    Store.clear();
    toast('All entries deleted');
  });

  /* ── render loop ─────────────────────────────────────────── */
  function render() {
    const s = Store.settings();
    $('#babyName').textContent = s.name || 'Baby';
    $('#babyAge').textContent = Fmt.age(s.dob);

    if (currentView === 'now') renderNow();
    else if (currentView === 'history') renderHistory();
    else if (currentView === 'stats') renderStats();
    else if (currentView === 'settings') renderSettings();
  }

  buildChrome();
  Store.onChange(render);
  render();
  Sync.start();
  Install.start();

  // Relative times drift; refresh them steadily, and immediately on return.
  setInterval(() => { if (!Sheet.isOpen()) render(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
    });
  }
})();
