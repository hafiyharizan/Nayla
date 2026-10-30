/* Home: the screen the app opens on.
 *
 * Three things, top to bottom:
 *   a header photo     picked on this phone and kept on this phone; until one
 *                      is picked, the newest milestone photo this phone has
 *   alerts             what needs attention now, and a few gentle suggestions,
 *                      worked out from the log — never more than five
 *   the last 24 hours  each tracker's total against her own 7-day average
 *
 * The 7-day charts (what used to be the Stats tab) sit underneath; app.js
 * renders those.
 *
 * Alert buttons use data-act rather than the data-log / data-entry buttons
 * used everywhere else, so a hidden Home never shadows the real ones.
 */
const Home = (() => {
  const HEADER_ID = 'home-header';
  const DISMISS_KEY = 'nayla.dismissed.v1';
  const DAY = 86400000, HOUR = 3600000, MIN = 60000;
  const MAX_ALERTS = 5;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const on = type => Store.trackerOn(type);
  const babyName = () => Store.settings().name || 'Baby';

  /* ── dismissing ──────────────────────────────────────────── */
  /* Per phone, and it only ever hides a message, so browser storage is the
   * right place — if it's lost, an alert simply shows again. */
  function dismissed() {
    try { return JSON.parse(localStorage.getItem(DISMISS_KEY)) || {}; } catch { return {}; }
  }

  function dismiss(id, until) {
    const all = dismissed();
    const now = Date.now();
    for (const k of Object.keys(all)) if (all[k] < now) delete all[k];   // tidy up
    all[id] = until;
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(all)); } catch { /* fine */ }
  }

  function endOfToday() {
    const d = new Date(); d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  /* ── totals over any window ──────────────────────────────── */
  function totalsBetween(from, to) {
    const totals = {};
    for (const r of Store.all()) {
      const f = Features.get(r.type);
      if (!f?.tally || !on(r.type)) continue;
      const end = r.end ?? (f.spansTime ? Date.now() : r.at);
      if (f.spansTime ? (r.at >= to || end <= from) : (r.at < from || r.at >= to)) continue;
      f.tally(r, totals, { from, to });
    }
    return totals;
  }

  /* The one number each tracker is judged by, and how to show it. */
  const METRIC = {
    feed:   { get: t => t.feeds || 0,   show: n => `${Math.round(n)}`, label: 'Feeds' },
    sleep:  { get: t => t.sleepMs || 0, show: n => Fmt.duration(n),    label: 'Sleep' },
    diaper: { get: t => t.diapers || 0, show: n => `${Math.round(n)}`, label: 'Diapers' },
    solids: { get: t => t.meals || 0,   show: n => `${Math.round(n)}`, label: 'Solids' },
  };

  /** Last 24 hours per tracker, against the average of the seven 24-hour
   *  stretches before it — counting only stretches where that tracker was
   *  actually logged, so a new user's empty week doesn't drag it to zero. */
  function summary() {
    const now = Date.now();
    const current = totalsBetween(now - DAY, now);
    const past = [];
    for (let k = 1; k <= 7; k++) past.push(totalsBetween(now - (k + 1) * DAY, now - k * DAY));

    return Object.entries(METRIC).filter(([type]) => on(type)).map(([type, m]) => {
      const logged = past.map(m.get).filter(v => v > 0);
      const avg = logged.length >= 2 ? logged.reduce((a, b) => a + b, 0) / logged.length : null;
      const value = m.get(current);
      let trend = '';
      if (avg != null && value > 0) {
        const diff = (value - avg) / avg;
        trend = diff > 0.15 ? 'up' : diff < -0.15 ? 'down' : '';
      }
      return { type, label: m.label, value: m.show(value), avg: avg == null ? null : m.show(avg), trend };
    });
  }

  /* ── alerts ──────────────────────────────────────────────── */
  /* level: 'warn' (needs you now) · 'info' (worth a look) · 'joy' · 'tip'.
   * Each has an id that stays the same for the same situation, so dismissing
   * it sticks until the situation changes. */
  const RANK = { warn: 0, info: 1, joy: 2, tip: 3 };

  function alerts() {
    const out = [];
    const s = Store.settings();
    const name = babyName();
    const months = Fmt.ageMonths(s.dob);
    const now = Date.now();

    /* sleep */
    if (on('sleep')) {
      const st = Wake.state(Store.all(), months);
      if (st.forgotten) {
        out.push({ id: `forgotten:${st.forgotten.id}`, level: 'warn', icon: '🌙',
          title: 'A sleep was never ended',
          body: `Started ${Fmt.dayLabel(st.forgotten.at).toLowerCase()} at ${Fmt.clock(st.forgotten.at)}. Fix it so the wake timer is right.`,
          action: { label: 'Fix it', act: `entry:${st.forgotten.id}` } });
      } else if (!st.sleeping && !st.stale && st.range && st.status === 'over') {
        out.push({ id: `over:${st.since}`, level: 'warn', icon: '⏰',
          title: `Awake ${Fmt.duration(st.elapsedMs)}`,
          body: `That's past her ${Fmt.duration(st.range.min * MIN)}–${Fmt.duration(st.range.max * MIN)} wake window. Time to wind down?`,
          action: { label: 'Start sleep', act: 'sleep' } });
      } else if (!st.sleeping && !st.stale && st.range && st.status === 'due') {
        out.push({ id: `due:${st.since}`, level: 'info', icon: '😴',
          title: 'In the sleep window',
          body: `Awake ${Fmt.duration(st.elapsedMs)} — a good time for a nap if she's showing sleepy cues.`,
          action: { label: 'Start sleep', act: 'sleep' } });
      }
    }

    /* feeds: longer than her usual gap */
    if (on('feed')) {
      const feeds = Store.byType('feed').filter(r => r.at > now - 3 * DAY).map(r => r.at).sort((a, b) => a - b);
      if (feeds.length >= 6) {
        const gaps = [];
        for (let i = 1; i < feeds.length; i++) {
          const g = feeds[i] - feeds[i - 1];
          if (g > 20 * MIN && g < 8 * HOUR) gaps.push(g);    // ignore top-ups and missed logging
        }
        gaps.sort((a, b) => a - b);
        const usual = gaps[Math.floor(gaps.length / 2)];
        const since = now - feeds[feeds.length - 1];
        if (usual && since > Math.max(usual * 1.3, 2 * HOUR) && since < 12 * HOUR) {
          out.push({ id: `feedgap:${feeds[feeds.length - 1]}`, level: 'info', icon: '🍼',
            title: `${Fmt.duration(since)} since the last feed`,
            body: `She's usually fed about every ${Fmt.duration(usual)}.`,
            action: { label: 'Log a feed', act: 'log:feed' } });
        }
      }
    }

    /* diapers: fewer wet ones than usual, judged only late in the day */
    if (on('diaper') && new Date().getHours() >= 15) {
      const wet = r => r.data.kind === 'wet' || r.data.kind === 'both';
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const days = [];
      for (let k = 1; k <= 7; k++) {
        const from = start.getTime() - k * DAY;
        const list = Store.byType('diaper').filter(r => r.at >= from && r.at < from + DAY);
        if (list.length) days.push(list.filter(wet).length);
      }
      if (days.length >= 3) {
        const usual = days.reduce((a, b) => a + b, 0) / days.length;
        const today = Store.byType('diaper').filter(r => r.at >= start.getTime() && wet(r)).length;
        const soFar = usual * ((now - start.getTime()) / DAY);
        if (usual >= 4 && today < soFar * 0.5) {
          out.push({ id: `wet:${Fmt.dayKey(now)}`, level: 'info', icon: '💧',
            title: 'Fewer wet diapers than usual',
            body: `${today} so far today — she usually has about ${Math.round(usual)} a day. Keep an eye on feeds, and call your clinic if she seems unwell.`,
            action: { label: 'Log a diaper', act: 'log:diaper' } });
        }
      }
    }

    /* solids */
    if (on('solids')) {
      const Foods = Features.Foods;
      const meals = Store.byType('solids');
      for (const r of meals.filter(r => now - r.at < 2 * HOUR && now >= r.at)) {
        const allergens = [...new Set(Foods.newIn(r).map(Foods.allergen).filter(Boolean))];
        if (allergens.length) {
          out.push({ id: `allergen:${r.id}`, level: 'warn', icon: '👀',
            title: 'Watching for a reaction',
            body: `First ${allergens.join(' and ')} at ${Fmt.clock(r.at)}. Look out for rash, hives, swelling or vomiting until about ${Fmt.clock(r.at + 2 * HOUR)}.` });
        }
      }
      for (const r of meals.filter(r => r.data.signs && now - r.at < 3 * DAY)) {
        out.push({ id: `signs:${r.id}`, level: 'info', icon: '⚠️',
          title: 'Reaction noted',
          body: `After ${(r.data.foods || []).map(Foods.label).join(', ')} on ${Fmt.shortDate(r.at)}. Mention it to your clinic before trying it again.`,
          action: { label: 'See it', act: `entry:${r.id}` } });
      }
      if (!meals.length && months != null && Fmt.ageDays(s.dob) >= 167 && months < 8) {
        out.push({ id: 'solids-ready', level: 'tip', icon: '🥣',
          title: 'Starting solids',
          body: `Most babies start solids around 6 months. Ask your clinic whether ${name} is ready.` });
      }
      const first = meals.length ? meals[meals.length - 1].at : null;
      if (first && now - first > 14 * DAY && months != null && months < 12) {
        const tried = new Set(Foods.tried().map(f => f.allergen).filter(Boolean));
        const left = Foods.ALLERGENS.filter(a => !tried.has(a));
        if (left.length) {
          out.push({ id: `allergens:${left.join(',')}`, level: 'tip', icon: '🥜',
            title: 'Common allergens not tried yet',
            body: `${cap(listOf(left))}. Current advice is to introduce them during the first year, one at a time — check with your clinic.`,
            dismissDays: 7 });
        }
      }
    }

    /* growth */
    if (on('growth') && s.dob && months != null && months < 24) {
      const last = Store.byType('growth')[0];
      if (!last) {
        out.push({ id: 'growth-first', level: 'tip', icon: '📏',
          title: 'Add her measurements',
          body: 'Copy weight, length and head size from the clinic health book to see her growth chart.',
          action: { label: 'Add', act: 'log:growth' }, dismissDays: 7 });
      } else {
        const age = now - last.at;
        if (age > (months < 12 ? 35 : 75) * DAY) {
          out.push({ id: `growth-due:${last.id}`, level: 'tip', icon: '📏',
            title: `Last measured ${sinceWords(age)} ago`,
            body: 'Add the numbers from her next clinic visit to keep her growth chart current.',
            action: { label: 'Add', act: 'log:growth' }, dismissDays: 7 });
        }
      }
    }

    /* her month birthdays */
    if (s.dob && months != null && months < 24) {
      const next = monthBirthday(s.dob);
      if (next) {
        const today = Fmt.dayKey(now) === Fmt.dayKey(next.at);
        const soon = !today && next.at - now < 3 * DAY;
        if (today || soon) {
          out.push({ id: `month:${next.months}`, level: 'joy', icon: '🎉',
            title: today
              ? `${name} is ${next.months} month${next.months === 1 ? '' : 's'} old today`
              : `${name} turns ${next.months} month${next.months === 1 ? '' : 's'} ${Fmt.dayLabel(next.at) === 'Tomorrow' ? 'tomorrow' : `on ${new Date(next.at).toLocaleDateString([], { weekday: 'long' })}`}`,
            body: on('milestone') ? 'Worth a milestone, and a photo.' : 'Happy month-birthday.',
            action: on('milestone') ? { label: 'Add a milestone', act: 'log:milestone' } : null });
        }
      }
    }

    const hidden = dismissed();
    return out
      .filter(a => !(hidden[a.id] > now))
      .sort((a, b) => RANK[a.level] - RANK[b.level])
      .slice(0, MAX_ALERTS);
  }

  /** The next month-birthday from today (today included), or null. */
  function monthBirthday(dob) {
    const born = new Date(dob + 'T00:00:00');
    if (isNaN(born)) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let m = 1; m <= 25; m++) {
      const d = new Date(born);
      d.setMonth(born.getMonth() + m);
      // 31 Jan + 1 month rolls into March: use the month's last day instead.
      if (d.getDate() !== born.getDate()) d.setDate(0);
      if (d >= today) return { months: m, at: d.getTime() + 12 * HOUR };
    }
    return null;
  }

  /** 5 weeks, 3 months — how long ago, in the words a parent would use. */
  function sinceWords(ms) {
    const weeks = Math.round(ms / (7 * DAY));
    if (weeks < 9) return `${weeks} weeks`;
    return `${Math.round(ms / (30.44 * DAY))} months`;
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function listOf(items) {
    return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }

  /* ── the header photo ────────────────────────────────────── */
  let heroShown = null;

  async function heroUrl() {
    const own = await Photos.get(HEADER_ID, false);
    if (own) return { url: own, picked: true };
    const withPhoto = Store.byType('milestone').filter(r => r.data.photo).slice(0, 6);
    for (const r of withPhoto) {
      const url = await Photos.get(r.data.photo, r.data.photoShared === true);
      if (url) return { url, picked: false };
    }
    return null;
  }

  async function renderHero() {
    const hero = document.getElementById('hero');
    const s = Store.settings();
    hero.querySelector('.hero-name').textContent = s.name || 'Baby';
    hero.querySelector('.hero-age').textContent = Fmt.age(s.dob);
    const found = await heroUrl().catch(() => null);
    const img = hero.querySelector('.hero-img');
    hero.classList.toggle('has-photo', Boolean(found));
    hero.querySelector('.hero-add').hidden = Boolean(found);
    if (found && heroShown !== found.url) { img.src = found.url; heroShown = found.url; }
    img.hidden = !found;
    if (!found) heroShown = null;
  }

  async function pickHero(file) {
    const url = await Photos.fromFile(file);
    await Photos.setLocal(HEADER_ID, url);
    await renderHero();
  }

  async function clearHero() {
    await Photos.removeLocal(HEADER_ID);
    heroShown = null;
    await renderHero();
  }

  async function hasPickedHero() {
    return Boolean(await Photos.get(HEADER_ID, false));
  }

  /* ── rendering ───────────────────────────────────────────── */
  const TREND = { up: '↑', down: '↓' };
  const TREND_WORD = { up: 'more than usual', down: 'less than usual' };

  function render() {
    renderHero();

    const list = alerts();
    document.getElementById('homeAlerts').innerHTML = list.length
      ? list.map(a => `
        <li class="alert alert-${a.level}" data-alert="${escapeHtml(a.id)}">
          <span class="alert-icon" aria-hidden="true">${a.icon}</span>
          <span class="alert-text">
            <b>${escapeHtml(a.title)}</b>
            <span>${escapeHtml(a.body)}</span>
            ${a.action ? `<button class="btn btn-small alert-act" data-act="${escapeHtml(a.action.act)}">${escapeHtml(a.action.label)}</button>` : ''}
          </span>
          <button class="alert-x" data-dismiss="${escapeHtml(a.id)}" data-days="${a.dismissDays || 0}"
                  aria-label="Dismiss">✕</button>
        </li>`).join('')
      : `<li class="alert alert-calm"><span class="alert-icon" aria-hidden="true">🌿</span>
           <span class="alert-text"><b>All calm</b><span>Nothing needs you right now.</span></span></li>`;

    const tiles = summary();
    const box = document.getElementById('homeSummary');
    box.hidden = !tiles.length;
    document.getElementById('summaryTitle').hidden = !tiles.length;
    box.style.setProperty('--cols', tiles.length === 3 ? 3 : 2);
    box.innerHTML = tiles.map(t => `
      <div class="sum-tile sum-${t.type}">
        <span class="sum-label">${t.label}</span>
        <b class="sum-value">${escapeHtml(t.value)}${t.trend
          ? ` <span class="sum-trend" title="${TREND_WORD[t.trend]}" aria-label="${TREND_WORD[t.trend]}">${TREND[t.trend]}</span>` : ''}</b>
        <em class="sum-note">${t.avg != null ? `7-day avg ${escapeHtml(t.avg)}` : 'not enough days yet'}</em>
      </div>`).join('');
  }

  /* ── wiring ──────────────────────────────────────────────── */
  function wire({ openSheet, openEntry, toggleSleep, rerender, toast }) {
    const view = document.getElementById('view-home');
    view.addEventListener('click', e => {
      const x = e.target.closest('[data-dismiss]');
      if (x) {
        const days = Number(x.dataset.days) || 0;
        dismiss(x.dataset.dismiss, days ? Date.now() + days * DAY : endOfToday());
        rerender();
        return;
      }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const [kind, arg] = act.dataset.act.split(':');
      if (kind === 'log') openSheet(arg);
      else if (kind === 'entry') openEntry(arg);
      else if (kind === 'sleep') toggleSleep();
    });

    view.querySelector('[data-hero-input]').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try { await pickHero(file); toast('Home photo set — it stays on this phone'); }
      catch (err) { console.warn(err); toast("Couldn't read that photo — try another one."); }
    });
  }

  return { render, wire, clearHero, hasPickedHero, alerts, summary, HEADER_ID };
})();
