/* App wiring: views, live timers, quick logging, stats, settings. */
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

  /* ── NOW view ────────────────────────────────────────────── */
  function renderNow() {
    const settings = Store.settings();
    const entries = Store.all();
    const st = Wake.state(entries, Fmt.ageMonths(settings.dob));

    // wake / sleep ring
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

    // status row
    const units = settings.units;
    const lastFeed = Store.latest('feed');
    const lastDiaper = Store.latest('diaper');
    const lastSleep = Store.latest('sleep', { completedOnly: true });

    $('#lastFeed').textContent = lastFeed ? Fmt.ago(lastFeed.start) : '—';
    $('#lastFeedNote').textContent = lastFeed
      ? [Fmt.FEED_METHOD[lastFeed.method], Fmt.amount(lastFeed.amount, units)].filter(Boolean).join(' · ')
      : 'nothing logged';

    $('#lastDiaper').textContent = lastDiaper ? Fmt.ago(lastDiaper.start) : '—';
    $('#lastDiaperNote').textContent = lastDiaper
      ? Fmt.DIAPER_KIND[lastDiaper.kind]
      : 'nothing logged';

    $('#lastSleep').textContent = lastSleep ? Fmt.duration(lastSleep.end - lastSleep.start) : '—';
    $('#lastSleepNote').textContent = lastSleep
      ? `ended ${Fmt.clock(lastSleep.end)}`
      : 'nothing logged';

    renderToday();
    renderList($('#recentList'), entries.slice(0, 8));
  }

  function renderToday() {
    const day = dayTotals(new Date());
    const units = Store.settings().units;
    const volume = day.feedMl ? Fmt.amount(day.feedMl, units) : '';
    $('#todaySummary').innerHTML = `
      <div class="today-cell"><span>Feeds</span><b>${day.feeds}</b><em>${volume || '&nbsp;'}</em></div>
      <div class="today-cell"><span>Diapers</span><b>${day.diapers}</b><em>${day.wet} wet · ${day.dirty} dirty</em></div>
      <div class="today-cell"><span>Sleep</span><b>${Fmt.duration(day.sleepMs)}</b><em>${day.naps} session${day.naps === 1 ? '' : 's'}</em></div>`;
  }

  /** Totals for a local day, splitting sleep that straddles midnight. */
  function dayTotals(date) {
    const from = new Date(date); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    const a = from.getTime(), b = Math.min(to.getTime(), Date.now());

    const totals = { feeds: 0, feedMl: 0, diapers: 0, wet: 0, dirty: 0, sleepMs: 0, naps: 0 };

    for (const e of Store.forDay(from)) {
      if (e.type === 'feed' && e.start >= a && e.start < to.getTime()) {
        totals.feeds++;
        if (e.amount) totals.feedMl += e.amount;
      } else if (e.type === 'diaper' && e.start >= a && e.start < to.getTime()) {
        totals.diapers++;
        if (e.kind === 'wet' || e.kind === 'both') totals.wet++;
        if (e.kind === 'dirty' || e.kind === 'both') totals.dirty++;
      } else if (e.type === 'sleep') {
        const end = e.end ?? Date.now();
        const overlap = Math.min(end, b) - Math.max(e.start, a);
        if (overlap > 0) { totals.sleepMs += overlap; totals.naps++; }
      }
    }
    return totals;
  }

  /* ── entry lists ─────────────────────────────────────────── */
  function renderList(container, entries) {
    if (!entries.length) {
      container.innerHTML = `<li class="empty">Nothing logged yet. Tap a button above to start.</li>`;
      return;
    }
    const units = Store.settings().units;
    container.innerHTML = entries.map(e => {
      const { title, detail } = Fmt.describe(e, units);
      const live = e.type === 'sleep' && e.end == null;
      const note = e.note ? ` · ${escapeHtml(e.note)}` : '';
      return `<li><button class="entry ${live ? 'is-live' : ''}" data-entry="${e.id}">
        <span class="entry-dot ${e.type}">${Fmt.ICON[e.type]}</span>
        <span class="entry-main">
          <span class="entry-title">${title}</span>
          <span class="entry-sub">${escapeHtml(detail)}${note}</span>
        </span>
        <span class="entry-time">${live ? Fmt.duration(Date.now() - e.start) : Fmt.clock(e.start)}</span>
      </button></li>`;
    }).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    const entries = Store.byType(historyFilter);
    const target = $('#historyList');
    if (!entries.length) {
      target.innerHTML = `<p class="empty">No entries yet.</p>`;
      return;
    }

    // group by local day, newest day first
    const groups = new Map();
    for (const e of entries) {
      const key = Fmt.dayKey(e.start);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }

    target.innerHTML = [...groups.values()].map(group => {
      const day = dayTotals(new Date(group[0].start));
      const summary = `${day.feeds} feed${day.feeds === 1 ? '' : 's'} · ` +
                      `${day.diapers} diaper${day.diapers === 1 ? '' : 's'} · ` +
                      `${Fmt.duration(day.sleepMs)} sleep`;
      return `<div class="day-group">
        <div class="day-head"><h3>${Fmt.dayLabel(group[0].start)}</h3><span>${summary}</span></div>
        <ul class="entries" data-day="${Fmt.dayKey(group[0].start)}"></ul>
      </div>`;
    }).join('');

    [...groups.entries()].forEach(([key, group]) => {
      renderList(target.querySelector(`[data-day="${key}"]`), group);
    });
  }

  /* ── STATS view ──────────────────────────────────────────── */
  function renderStats() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({ date: d, ...dayTotals(d) });
    }

    const units = Store.settings().units;
    const hasData = days.some(d => d.feeds || d.diapers || d.sleepMs);
    if (!hasData) {
      $('#statsBody').innerHTML = `<p class="empty">Log a few days and trends will show up here.</p>`;
      return;
    }

    $('#statsBody').innerHTML = [
      block('Sleep per day', days, 'sleep', d => d.sleepMs, ms => Fmt.duration(ms)),
      block('Feeds per day', days, 'feed', d => d.feeds, n => `${n}`),
      block('Diapers per day', days, 'diaper', d => d.diapers, n => `${n}`),
      volumeBlock(days, units),
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

  function volumeBlock(days, units) {
    if (!days.some(d => d.feedMl)) return '';
    return block('Bottle volume per day', days, 'feed', d => d.feedMl,
      ml => Fmt.amount(ml, units));
  }

  function shortDay(date) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(date); d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) return 'Today';
    return d.toLocaleDateString([], { weekday: 'short' });
  }

  /* ── logging actions ─────────────────────────────────────── */
  function openSheet(type, entry) {
    Sheet.open({
      type, entry,
      onSave(data, existing) {
        if (existing) {
          Store.update(existing.id, data);
          toast('Updated');
        } else {
          Store.add(data);
          toast('Saved');
        }
      },
      onDelete(existing) {
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
      const type = quick.dataset.quick;
      const last = type === 'sleep'
        ? Store.latest('sleep')
        : Store.latest(type);
      openSheet(type, last || undefined);
      return;
    }

    const entryBtn = e.target.closest('[data-entry]');
    if (entryBtn) {
      const entry = Store.get(entryBtn.dataset.entry);
      if (entry) openSheet(entry.type, entry);
    }
  });

  $('#sleepToggle').addEventListener('click', () => {
    const active = Store.activeSleep();
    if (active) {
      Store.update(active.id, { end: Date.now() });
      toast(`Slept ${Fmt.duration(Date.now() - active.start)}`);
    } else {
      Store.add({ type: 'sleep', start: Date.now(), end: null });
      toast('Sleep started');
    }
  });

  /* ── SETTINGS view ───────────────────────────────────────── */
  function renderSettings() {
    const s = Store.settings();
    $('#setName').value = s.name;
    $('#setDob').value = s.dob;
    $('#setUnits').value = s.units;
    const n = Store.all().length;
    $('#dataCount').textContent = `${n} entr${n === 1 ? 'y' : 'ies'} stored on this device.`;
  }

  $('#setName').addEventListener('input', e => Store.saveSettings({ name: e.target.value.trim() }));
  $('#setDob').addEventListener('change', e => Store.saveSettings({ dob: e.target.value }));
  $('#setUnits').addEventListener('change', e => Store.saveSettings({ units: e.target.value }));

  function download(filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function stamp() {
    return new Date().toISOString().slice(0, 10);
  }

  $('#exportJson').addEventListener('click', () => {
    download(`nayla-backup-${stamp()}.json`,
      JSON.stringify(Store.exportData(), null, 2), 'application/json');
  });

  $('#exportCsv').addEventListener('click', () => {
    const units = Store.settings().units;
    const rows = [['type', 'start', 'end', 'duration_min', 'detail', `amount_${units}`, 'note']];
    for (const e of [...Store.all()].reverse()) {
      const detail = e.type === 'feed' ? (Fmt.FEED_METHOD[e.method] || '')
                   : e.type === 'diaper' ? (Fmt.DIAPER_KIND[e.kind] || '')
                   : '';
      rows.push([
        e.type,
        new Date(e.start).toISOString(),
        e.end ? new Date(e.end).toISOString() : '',
        e.end ? Math.round((e.end - e.start) / Fmt.MIN) : '',
        detail,
        e.amount != null ? Fmt.fromMl(e.amount, units) : '',
        e.note || '',
      ]);
    }
    const csv = rows.map(r => r.map(csvCell).join(',')).join('\n');
    download(`nayla-log-${stamp()}.csv`, csv, 'text/csv');
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
      const incoming = Array.isArray(data) ? data : data.entries;
      if (!Array.isArray(incoming)) throw new Error('no entries in file');
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

  Store.onChange(render);
  render();

  // Relative times drift; refresh them steadily, and immediately on return.
  setInterval(() => { if (!Sheet.isOpen()) render(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
    });
  }
})();
