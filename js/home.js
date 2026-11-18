/* Home: the screen the app opens on — an overview to look at, with nothing
 * to log from. Everything that is done lives on Log.
 *
 * Top to bottom, sized to fit one phone screen without scrolling:
 *   a header photo   picked on this phone and kept on this phone; until one
 *                    is picked, the newest milestone photo this phone has
 *   since last       how long she has been awake (or asleep), and since her
 *                    last feed and diaper
 *   today            each tracker's total since her day began, against what
 *                    she usually has by this time of day, with the last 7
 *                    days drawn small underneath. Tapping a tile opens that
 *                    tracker's full 7-day chart below the tiles.
 *   growing          her latest weight, length and head size, with their
 *                    WHO percentiles
 */
const Home = (() => {
  const HEADER_ID = 'home-header';
  const MIN = 60000;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const on = type => Store.trackerOn(type);

  /** Today so far (index 0) and the seven whole days before it, each with
   *  its totals as far into that day as today has got — so 9am is compared
   *  with other mornings, not with whole days. Days run from her day's start
   *  (day.js). Worked out once per render and shared by the Today tiles
   *  and the 7-day charts. */
  function days() {
    const now = Date.now();
    const into = now - Day.start(0);
    const out = [{ start: Day.start(0), totals: Day.totals(Day.start(0), now) }];
    for (let k = 1; k <= 7; k++) {
      const start = Day.start(k);
      out.push({
        start,
        totals: Day.totals(start, Day.start(k - 1)),
        soFar: Day.totals(start, start + into, start + into),
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

  /** Oldest first: six whole days, then today so far. */
  const oldestFirst = week => [...week.slice(1, 7)].reverse().concat(week[0]);

  /** Each tracker since her day began, against what she usually has by this
   *  time of day — a fair comparison at 9am as well as at 9pm — and against
   *  her usual whole day. */
  function today(week = days()) {
    return Object.entries(METRIC).filter(([type]) => on(type)).map(([type, m]) => {
      const value = m.get(week[0].totals);
      const usual = usualDay(week, m.get);
      const tile = { type, label: m.label, icon: Features.get(type).icon,
        value, shown: m.show(value), byNow: null, perDay: null, perDayRaw: null, trend: null, delta: '',
        spark: oldestFirst(week).map(d => m.get(d.totals)) };
      if (!usual) return tile;

      const byNow = mean(usual.logged.map(d => m.get(d.soFar)));
      const diff = value - byNow;
      tile.byNow = m.show(byNow);
      tile.perDay = m.show(usual.perDay);
      tile.perDayRaw = usual.perDay;
      if (Math.abs(diff) >= m.step && (byNow === 0 || Math.abs(diff) / byNow > 0.15)) {
        tile.trend = diff > 0 ? 'up' : 'down';
        tile.delta = `${(m.delta || m.show)(Math.abs(diff))} ${diff > 0 ? m.more : m.less}`;
      } else {
        tile.trend = 'same';
      }
      return tile;
    });
  }

  /* The 7-day charts, by the tile that opens them. Bottle volume opens with
   * feeds, once there is some to show. */
  function weekCharts(units) {
    return [
      { key: 'sleep',  type: 'sleep',  title: 'Sleep per day',   get: METRIC.sleep.get,  show: METRIC.sleep.show },
      { key: 'feed',   type: 'feed',   title: 'Feeds per day',   get: METRIC.feed.get,   show: count },
      { key: 'feedMl', type: 'feed',   title: 'Bottle volume per day', get: t => t.feedMl || 0,
        show: ml => Fmt.amount(ml, units), optional: true },
      { key: 'diaper', type: 'diaper', title: 'Diapers per day', get: METRIC.diaper.get, show: count },
      { key: 'solids', type: 'solids', title: 'Solid meals per day', get: METRIC.solids.get, show: count },
    ].filter(c => on(c.type));
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

  /* ── since last ──────────────────────────────────────────── */
  /** Awake or asleep for how long, then the time since each tracker's last
   *  entry that has a status (feed, diaper). Numbers only: editing them is
   *  done from Log or History. */
  function since() {
    const s = Store.settings();
    const out = [];
    if (on('sleep')) {
      const st = Wake.state(Store.all(), Fmt.ageMonths(s.dob));
      // A stale reading is a gap in the log, not a real duration.
      const value = (st.elapsedMs == null || st.stale) ? '—' : Fmt.duration(st.elapsedMs);
      out.push({ type: 'sleep', label: st.sleeping ? 'Asleep' : 'Awake', value,
        state: st.sleeping ? 'is-sleeping' : st.status === 'over' ? 'is-over' : '' });
    }
    for (const f of Features.all().filter(f => f.statusLabel && f.type !== 'sleep' && on(f.type))) {
      const record = Store.latest(f.type, { completedOnly: Boolean(f.statusCompletedOnly) });
      out.push({ type: f.type, label: f.statusLabel, value: record ? f.statusValue(record, s) : '—', state: '' });
    }
    return out;
  }

  function renderSince() {
    const list = since();
    const box = document.getElementById('homeSince');
    box.hidden = !list.length;
    box.style.setProperty('--cols', list.length || 1);
    box.innerHTML = list.map(t => `
      <div class="since since-${t.type} ${t.state}">
        <span class="since-label">${escapeHtml(t.label)}</span>
        <b class="since-value">${escapeHtml(t.value)}</b>
      </div>`).join('');
  }

  /* ── today ───────────────────────────────────────────────── */
  const CHIP = { up: '↑', down: '↓' };
  let openChart = null;                      // the tracker whose chart is open

  /** "since midnight", "since 6:00 AM", "since Subuh, 4:37 AM" — and
   *  "…yesterday" at 3am — so it's plain when her day began. */
  function sinceWhen() {
    const t = Day.today();
    if (t.kind === 'midnight') return 'since midnight';
    const calToday = Fmt.dayKey(t.at) === Fmt.dayKey(Date.now());
    const when = `${Fmt.clock(t.at)}${calToday ? '' : ' yesterday'}`;
    const name = { sunrise: 'sunrise', subuh: 'Subuh' }[t.kind];
    return name ? `since ${name}, ${when}` : `since ${when}`;
  }

  /** Seven little columns, today last and darkest, and her usual day as a
   *  dashed line. The full chart is a tap away. */
  function spark(values, perDay) {
    const max = Math.max(...values, perDay || 0) || 1;
    const pct = v => (v / max * 100).toFixed(1);
    return `<span class="sum-spark" aria-hidden="true">${
      values.map((v, i) => `<i${i === 6 ? ' class="is-today"' : ''} style="height:${pct(v)}%"></i>`).join('')
    }${perDay != null ? `<s style="bottom:${pct(perDay)}%"></s>` : ''}</span>`;
  }

  function renderToday(week) {
    const tiles = today(week);
    if (openChart && !tiles.some(t => t.type === openChart)) openChart = null;
    const box = document.getElementById('homeSummary');
    box.hidden = !tiles.length;
    document.getElementById('summaryHead').hidden = !tiles.length;
    document.getElementById('summaryMeta').textContent = sinceWhen();
    box.innerHTML = tiles.map((t, i) => {
      const chip = t.trend === 'same'
        ? `<span class="sum-chip is-same">On track</span>`
        : t.trend ? `<span class="sum-chip is-${t.trend}">${CHIP[t.trend]} ${escapeHtml(t.delta)}</span>` : '';
      const notes = t.perDay == null
        ? `<em class="sum-note">Not enough days yet</em>`
        : `<em class="sum-note">Usually ${escapeHtml(t.byNow)} by now</em>
           <em class="sum-note">Avg ${escapeHtml(t.perDay)} a day</em>`;
      const open = openChart === t.type;
      return `
      <button class="sum-tile sum-${t.type} ${open ? 'is-open' : ''}" data-open="${t.type}" style="--i:${i}"
              aria-expanded="${open}" aria-controls="statsBody">
        <span class="sum-top"><span class="sum-label">${t.icon} ${t.label}</span>${chip}</span>
        <b class="sum-value">${escapeHtml(t.shown)}</b>
        ${spark(t.spark, t.perDayRaw)}
        ${notes}
      </button>`;
    }).join('');
  }

  /* ── the 7-day chart, opened from a tile ─────────────────── */
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
    if (!openChart) { box.innerHTML = ''; box.hidden = true; return; }
    const units = Store.settings().units;
    const order = oldestFirst(week);
    const charts = weekCharts(units)
      .filter(c => c.type === openChart)
      .map(c => ({ c, cols: order.map((d, i) => ({ value: c.get(d.totals), start: d.start,
        short: weekday(d.start, i),
        long: i === 6 ? 'Today so far' : new Date(d.start).toLocaleDateString([], { weekday: 'long' }) })) }))
      .filter(({ c, cols }) => !c.optional || cols.some(d => d.value > 0));

    box.hidden = !charts.length;
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

  /* ── growing ─────────────────────────────────────────────── */
  function renderGrowth() {
    const latest = on('growth') ? Growing.latest() : [];
    const shown = latest.filter(g => g.record);
    const box = document.getElementById('homeGrowth');
    box.hidden = !shown.length;
    document.getElementById('growthHead').hidden = !shown.length;
    if (!shown.length) { box.innerHTML = ''; return; }
    const newest = Math.max(...shown.map(g => g.record.at));
    document.getElementById('growthMeta').textContent = `measured ${Fmt.shortDate(newest)}`;
    box.innerHTML = latest.map(g => `
      <span class="hg">
        <span class="hg-label">${escapeHtml(g.label)}</span>
        <b class="hg-value">${escapeHtml(g.value)}</b>
        <span class="hg-pct">${g.pct != null ? escapeHtml(Who.describe(g.pct).replace(/ percentile$/, '')) : '&nbsp;'}</span>
      </span>`).join('');
  }

  function render() {
    renderHero();
    renderSince();
    const week = days();
    renderToday(week);
    renderWeek(week);
    renderGrowth();
  }

  function toggleChart(type) {
    openChart = openChart === type ? null : type;
    const week = days();
    renderToday(week);
    renderWeek(week);
    if (openChart) document.getElementById('statsBody').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function pickColumn(col) {
    const key = col.dataset.chart, i = Number(col.dataset.col);
    picked[key] = picked[key] === i ? undefined : i;
    renderWeek();
    // Keep keyboard focus on the column that was just read out.
    document.querySelector(`#statsBody [data-chart="${key}"][data-col="${i}"]`)?.focus({ preventScroll: true });
  }

  /* ── wiring ──────────────────────────────────────────────── */
  function wire({ go, toast }) {
    const view = document.getElementById('view-home');
    view.addEventListener('click', e => {
      const tile = e.target.closest('[data-open]');
      if (tile) { toggleChart(tile.dataset.open); return; }
      const col = e.target.closest('[data-col]');
      if (col) { pickColumn(col); return; }
      if (e.target.closest('#homeGrowth')) go('growing');
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

  return { render, wire, clearHero, hasPickedHero, today, greeting, HEADER_ID };
})();
