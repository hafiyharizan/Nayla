/* Home: the screen the app opens on.
 *
 * Four things, top to bottom:
 *   a header photo   picked on this phone and kept on this phone; until one
 *                    is picked, the newest milestone photo this phone has
 *   alerts           what needs attention now, and a few gentle suggestions,
 *                    worked out from the log — never more than five
 *   today            each tracker's total since midnight, against what she
 *                    usually has by this time of day, and on a whole day
 *   the last 7 days  a column per day (what used to be the Stats tab)
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

  /* Local midnight k days ago, and this same clock time k days ago. Built
   * from calendar dates rather than by subtracting 24-hour blocks, so the
   * day a clock changes still lines up. */
  function dayStart(k) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - k);
    return d.getTime();
  }
  function sameTime(k) {
    const d = new Date(); d.setDate(d.getDate() - k);
    return d.getTime();
  }

  /** Today so far (index 0) and the seven whole days before it, each with
   *  its totals up to this time of day as well. Worked out once per render
   *  and shared by the Today tiles and the 7-day charts. */
  function days() {
    const now = Date.now();
    const out = [{ start: dayStart(0), totals: totalsBetween(dayStart(0), now) }];
    for (let k = 1; k <= 7; k++) {
      out.push({
        start: dayStart(k),
        totals: totalsBetween(dayStart(k), dayStart(k - 1)),
        soFar: totalsBetween(dayStart(k), sameTime(k)),
      });
    }
    return out;
  }

  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const count = n => `${Math.round(n)}`;

  /* The one number each tracker is judged by, how to show it, and the
   * smallest difference worth calling more or less than usual. */
  const METRIC = {
    feed:   { get: t => t.feeds || 0,   show: count,        label: 'Feeds',   step: 1,        more: 'more', less: 'fewer' },
    sleep:  { get: t => t.sleepMs || 0, show: Fmt.duration, label: 'Sleep',   step: 30 * MIN, more: 'more', less: 'less',
              // Short enough for the badge: 40m, then to the half hour — 1.5h, 6h.
              delta: ms => ms < 55 * MIN ? `${Math.round(ms / MIN)}m` : `${Math.round(ms / (30 * MIN)) / 2}h` },
    diaper: { get: t => t.diapers || 0, show: count,        label: 'Diapers', step: 1,        more: 'more', less: 'fewer' },
    solids: { get: t => t.meals || 0,   show: count,        label: 'Solids',  step: 1,        more: 'more', less: 'fewer' },
  };

  /** Her usual whole day for one measure: the average over the last seven
   *  days, counting only days it was logged at all — so a new user's empty
   *  week doesn't drag it to zero. Null until there are two such days. */
  function usualDay(week, get) {
    const logged = week.slice(1).filter(d => get(d.totals) > 0);
    return logged.length >= 2 ? { perDay: mean(logged.map(d => get(d.totals))), logged } : null;
  }

  /** Each tracker since midnight, against what she usually has by this time
   *  of day — a fair comparison at 9am as well as at 9pm — and against her
   *  usual whole day. */
  function today(week = days()) {
    return Object.entries(METRIC).filter(([type]) => on(type)).map(([type, m]) => {
      const value = m.get(week[0].totals);
      const usual = usualDay(week, m.get);
      const tile = { type, label: m.label, icon: Features.get(type).icon,
        value, shown: m.show(value), byNow: null, perDay: null, trend: null, delta: '' };
      if (!usual) return tile;

      const byNow = mean(usual.logged.map(d => m.get(d.soFar)));
      const diff = value - byNow;
      tile.byNow = m.show(byNow);
      tile.perDay = m.show(usual.perDay);
      tile.fill = Math.min(1, value / usual.perDay);
      tile.mark = Math.min(1, byNow / usual.perDay);
      if (Math.abs(diff) >= m.step && (byNow === 0 || Math.abs(diff) / byNow > 0.15)) {
        tile.trend = diff > 0 ? 'up' : 'down';
        tile.delta = `${(m.delta || m.show)(Math.abs(diff))} ${diff > 0 ? m.more : m.less}`;
      } else {
        tile.trend = 'same';
      }
      return tile;
    });
  }

  /* The 7-day charts. Bottle volume and solids only appear once there is
   * something to show. */
  function weekCharts(units) {
    return [
      { key: 'sleep',  type: 'sleep',  title: 'Sleep per day',   get: METRIC.sleep.get,  show: METRIC.sleep.show },
      { key: 'feed',   type: 'feed',   title: 'Feeds per day',   get: METRIC.feed.get,   show: count },
      { key: 'feedMl', type: 'feed',   title: 'Bottle volume per day', get: t => t.feedMl || 0,
        show: ml => Fmt.amount(ml, units), optional: true },
      { key: 'diaper', type: 'diaper', title: 'Diapers per day', get: METRIC.diaper.get, show: count },
      { key: 'solids', type: 'solids', title: 'Solid meals per day', get: METRIC.solids.get, show: count, optional: true },
    ].filter(c => on(c.type));
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

  /** A hello that knows the hour — including the 3am feed. */
  function greeting(hour = new Date().getHours()) {
    if (hour >= 5 && hour < 12) return { icon: '☀️', text: 'Good morning' };
    if (hour >= 12 && hour < 17) return { icon: '🌤️', text: 'Good afternoon' };
    if (hour >= 17 && hour < 21) return { icon: '🌇', text: 'Good evening' };
    return { icon: '🌙', text: 'Night shift' };
  }

  async function renderHero() {
    const hero = document.getElementById('hero');
    const s = Store.settings();
    const hi = greeting();
    hero.querySelector('.hero-hi').textContent = `${hi.icon} ${hi.text}`;
    hero.querySelector('.hero-name').textContent = s.name || 'Baby';
    // Day 1 is the day she was born.
    const day = Fmt.ageDays(s.dob);
    hero.querySelector('.hero-age').textContent =
      [Fmt.age(s.dob), day != null && day >= 0 ? `day ${day + 1}` : ''].filter(Boolean).join(' · ');
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
  /* Which tracker an alert is about, by the start of its id, so its icon
   * sits in that tracker's colour. */
  const TONE = {
    forgotten: 'sleep', over: 'sleep', due: 'sleep',
    feedgap: 'feed', wet: 'diaper',
    allergen: 'solids', signs: 'solids', 'solids-ready': 'solids', allergens: 'solids',
    'growth-first': 'growth', 'growth-due': 'growth',
    month: 'milestone',
  };

  function renderAlerts() {
    const list = alerts();
    document.getElementById('homeAlerts').innerHTML = list.length
      ? list.map((a, i) => `
        <li class="alert alert-${a.level}" data-alert="${escapeHtml(a.id)}" style="--i:${i}">
          <span class="alert-icon tone-${TONE[a.id.split(':')[0]] || 'none'}" aria-hidden="true">${a.icon}</span>
          <span class="alert-text">
            <b>${escapeHtml(a.title)}</b>
            <span>${escapeHtml(a.body)}</span>
            ${a.action ? `<button class="btn btn-small alert-act" data-act="${escapeHtml(a.action.act)}">${escapeHtml(a.action.label)}</button>` : ''}
          </span>
          <button class="alert-x" data-dismiss="${escapeHtml(a.id)}" data-days="${a.dismissDays || 0}"
                  aria-label="Dismiss">✕</button>
        </li>`).join('')
      : `<li class="alert alert-calm"><span class="alert-icon tone-growth" aria-hidden="true">🌿</span>
           <span class="alert-text"><b>All calm</b><span>Nothing needs you right now.</span></span></li>`;
  }

  const CHIP = { up: '↑', down: '↓' };

  function renderToday(week) {
    const tiles = today(week);
    const box = document.getElementById('homeSummary');
    box.hidden = !tiles.length;
    document.getElementById('summaryHead').hidden = !tiles.length;
    box.innerHTML = tiles.map((t, i) => {
      const chip = t.trend === 'same'
        ? `<span class="sum-chip is-same">On track</span>`
        : t.trend ? `<span class="sum-chip is-${t.trend}">${CHIP[t.trend]} ${escapeHtml(t.delta)}</span>` : '';
      const meter = t.perDay == null ? '' : `
        <span class="sum-meter" role="img"
              aria-label="${escapeHtml(`${t.shown} so far; usually ${t.byNow} by now, ${t.perDay} in a whole day`)}">
          <i style="width:${(t.fill * 100).toFixed(1)}%"></i><s style="left:${(t.mark * 100).toFixed(1)}%"></s>
        </span>`;
      const notes = t.perDay == null
        ? `<em class="sum-note">Not enough days to compare yet</em>`
        : `<em class="sum-note">Usually ${escapeHtml(t.byNow)} by now</em>
           <em class="sum-note">Avg ${escapeHtml(t.perDay)} a day</em>`;
      return `
      <div class="sum-tile sum-${t.type}" style="--i:${i}">
        <span class="sum-top"><span class="sum-icon" aria-hidden="true">${t.icon}</span>${chip}</span>
        <span class="sum-label">${t.label}</span>
        <b class="sum-value">${escapeHtml(t.shown)}</b>
        ${meter}${notes}
      </div>`;
    }).join('');
  }

  /* ── the 7-day charts ────────────────────────────────────── */
  /* One column per day, oldest on the left, today on the right with its
   * value on the cap. Tapping a column reads it out above the chart;
   * tapping it again goes back to her usual day. */
  const picked = {};                         // chart key → column picked
  const W = 320, H = 132, TOP = 18, BASE = 104, LEFT = 4, RIGHT = 28;

  function weekday(start, i) {
    return i === 6 ? 'Today' : new Date(start).toLocaleDateString([], { weekday: 'short' });
  }

  function chartSvg(c, cols, perDay) {
    const max = Math.max(...cols.map(d => d.value), perDay || 0) || 1;
    const slot = (W - LEFT - RIGHT) / 7;
    const bar = Math.min(22, slot * 0.56);
    const y = v => BASE - (v / max) * (BASE - TOP);
    const pick = picked[c.key];

    const columns = cols.map((d, i) => {
      const x = LEFT + slot * i + (slot - bar) / 2;
      const top = y(d.value), h = BASE - top;
      const r = Math.min(4, h);
      const shape = d.value > 0
        ? `<path class="col-bar ${c.type}" style="--i:${i}" d="M${x} ${BASE}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + bar - r}Q${x + bar} ${top} ${x + bar} ${top + r}V${BASE}Z"/>`
        : '';
      const cap = (i === 6 || i === pick) && d.value > 0
        ? `<text class="c-cap" x="${x + bar / 2}" y="${top - 6}">${escapeHtml(c.show(d.value))}</text>` : '';
      const name = `${d.long}: ${d.value > 0 ? c.show(d.value) : 'nothing logged'}`;
      return `<g class="col ${i === pick ? 'is-picked' : ''}" data-chart="${c.key}" data-col="${i}"
                 tabindex="0" role="button" aria-label="${escapeHtml(name)}">
          <title>${escapeHtml(name)}</title>
          <rect class="col-hit" x="${LEFT + slot * i}" y="0" width="${slot}" height="${H}" rx="8"/>
          ${shape}${cap}
          <text class="c-day ${i === 6 ? 'is-today' : ''}" x="${x + bar / 2}" y="${H - 8}">${d.short}</text>
        </g>`;
    }).join('');

    const avg = perDay == null ? '' : `
      <line class="c-avg" x1="${LEFT}" x2="${W - RIGHT + 4}" y1="${y(perDay)}" y2="${y(perDay)}"/>
      <text class="c-avg-label" x="${W - RIGHT + 8}" y="${y(perDay) + 3.5}">avg</text>`;

    return `<svg class="wk-chart ${pick != null ? 'has-pick' : ''}" viewBox="0 0 ${W} ${H}" role="group"
                 aria-label="${escapeHtml(c.title)}, last 7 days">
        <line class="c-base" x1="${LEFT}" x2="${W - RIGHT + 4}" y1="${BASE}" y2="${BASE}"/>
        ${avg}${columns}
      </svg>`;
  }

  function renderWeek(week = days()) {
    const box = document.getElementById('statsBody');
    const units = Store.settings().units;
    // Oldest first: six whole days, then today so far.
    const order = [...week.slice(1, 7)].reverse().concat(week[0]);
    const charts = weekCharts(units)
      .map(c => ({ c, cols: order.map((d, i) => ({ value: c.get(d.totals), start: d.start,
        short: weekday(d.start, i),
        long: i === 6 ? 'Today so far' : new Date(d.start).toLocaleDateString([], { weekday: 'long' }) })) }))
      .filter(({ c, cols }) => !c.optional || cols.some(d => d.value > 0));

    document.getElementById('weekHead').hidden = !charts.length;
    if (!charts.some(({ cols }) => cols.some(d => d.value > 0))) {
      box.innerHTML = charts.length
        ? `<p class="empty">Log a few days and trends will show up here.</p>` : '';
      return;
    }

    box.innerHTML = charts.map(({ c, cols }, n) => {
      const perDay = usualDay(week, c.get)?.perDay ?? null;
      const pick = picked[c.key];
      const readout = pick != null
        ? `${cols[pick].long} · <b>${cols[pick].value > 0 ? escapeHtml(c.show(cols[pick].value)) : 'nothing logged'}</b>`
        : perDay != null ? `Usually <b>${escapeHtml(c.show(perDay))}</b> a day`
        : 'Not enough days for an average yet';
      return `<div class="stat-block" style="--i:${n}">
        <h3>${c.title}</h3>
        <p class="chart-readout">${readout}</p>
        ${chartSvg(c, cols, perDay)}
      </div>`;
    }).join('');
  }

  function render() {
    renderHero();
    renderAlerts();
    const week = days();
    renderToday(week);
    renderWeek(week);
  }

  function pickColumn(col) {
    const key = col.dataset.chart, i = Number(col.dataset.col);
    picked[key] = picked[key] === i ? undefined : i;
    renderWeek();
    // Keep keyboard focus on the column that was just read out.
    document.querySelector(`#statsBody [data-chart="${key}"][data-col="${i}"]`)?.focus({ preventScroll: true });
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
      const col = e.target.closest('[data-col]');
      if (col) { pickColumn(col); return; }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const [kind, arg] = act.dataset.act.split(':');
      if (kind === 'log') openSheet(arg);
      else if (kind === 'entry') openEntry(arg);
      else if (kind === 'sleep') toggleSleep();
    });

    view.addEventListener('keydown', e => {
      const col = e.target.closest?.('[data-col]');
      if (!col || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      pickColumn(col);
    });

    view.querySelector('[data-hero-input]').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try { await pickHero(file); toast('Home photo set — it stays on this phone'); }
      catch (err) { console.warn(err); toast("Couldn't read that photo — try another one."); }
    });
  }

  return { render, wire, clearHero, hasPickedHero, alerts, today, greeting, HEADER_ID };
})();
