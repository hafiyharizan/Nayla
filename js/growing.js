/* The Growing tab: the slow-moving things.
 *
 * Feeds and diapers are counted per day; these are looked back on over
 * months — her line on the growth chart, the milestones with their photos,
 * and the foods she has tried. Each section shows only while its tracker is
 * on, so the tab is as small as what this family actually tracks.
 *
 * Like wake.js knows about sleep, this knows about growth, solids and
 * milestones by name. Entries still open in the ordinary sheet, through the
 * same data-entry / data-log buttons as everywhere else.
 */
const Growing = (() => {
  const INDICATORS = [
    ['weight', 'Weight'],
    ['length', 'Length'],
    ['head', 'Head'],
  ];

  let indicator = 'weight';
  let pickedId = null;            // the point tapped on the chart
  let rerender = () => {};

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function anyOn() {
    return ['growth', 'milestone', 'solids'].some(t => Store.trackerOn(t));
  }

  /* ── the whole tab ───────────────────────────────────────── */
  function render(el, { renderList }) {
    const settings = Store.settings();
    const parts = [];
    if (Store.trackerOn('growth')) parts.push(growthSection(settings));
    if (Store.trackerOn('milestone')) parts.push(milestoneSection(settings));
    if (Store.trackerOn('solids')) parts.push(foodSection(settings));
    el.innerHTML = parts.join('');

    const list = el.querySelector('#growthList');
    if (list) renderList(list, Store.byType('growth'), settings);
    el.querySelectorAll('img[data-photo]').forEach(img => Photos.show(img, img.dataset.photo));
  }

  function head(title, type, action) {
    return `<div class="grow-head"><h2 class="section-title">${title}</h2>
      <button class="btn btn-small" data-log="${type}">${action}</button></div>`;
  }

  /* ── growth ──────────────────────────────────────────────── */
  function growthSection(settings) {
    const records = Store.byType('growth');
    if (!records.length) {
      return `<section class="grow-section">${head('Growth', 'growth', '+ Add')}
        <div class="card soft-empty">Add her weight, length and head size after each
          clinic visit — the numbers are in the health book — and she'll show up on the
          WHO growth chart.</div></section>`;
    }

    const tiles = INDICATORS.map(([key, label]) => {
      const latest = records.find(r => r.data[key] != null);
      const value = latest ? show(key, latest.data[key], settings) : '—';
      const pct = latest ? percentileOf(key, latest, settings) : null;
      return `<button class="g-tile ${key === indicator ? 'is-on' : ''}" data-indicator="${key}"
                aria-pressed="${key === indicator}">
        <span class="g-label">${label}</span>
        <strong class="g-value">${escapeHtml(value)}</strong>
        <span class="g-note">${pct != null ? escapeHtml(Who.describe(pct)) : latest ? '&nbsp;' : 'not measured'}</span>
      </button>`;
    }).join('');

    return `<section class="grow-section">${head('Growth', 'growth', '+ Add')}
      <div class="g-tiles">${tiles}</div>
      ${chartCard(records, settings)}
      <h3 class="sub-title">Every measurement</h3>
      <ul class="entries" id="growthList"></ul>
    </section>`;
  }

  function show(key, value, settings) {
    return key === 'weight' ? Fmt.weight(value, settings.growthUnits) : Fmt.length(value, settings.growthUnits);
  }

  function percentileOf(key, record, settings) {
    const months = Who.ageInMonths(settings.dob, record.at);
    return Who.percentile(settings.sex, key, months, record.data[key]);
  }

  /* ── the chart ───────────────────────────────────────────── */
  const W = 340, H = 216, PAD = { l: 34, r: 36, t: 14, b: 26 };

  function chartCard(records, settings) {
    if (!settings.dob) {
      return `<div class="card soft-empty">Add her date of birth in Settings to see the growth chart.</div>`;
    }
    const nowMonths = Who.ageInMonths(settings.dob, Date.now());
    if (nowMonths > Who.MAX_MONTHS + 1 && !records.some(r => inRange(r, settings))) {
      return `<div class="card soft-empty">The WHO charts here cover birth to two years.</div>`;
    }

    const points = records
      .filter(r => r.data[indicator] != null && inRange(r, settings))
      .map(r => ({ r, x: Who.ageInMonths(settings.dob, r.at), v: r.data[indicator] }))
      .sort((a, b) => a.x - b.x);

    const sexWord = settings.sex === 'boy' ? 'boys' : 'girls';
    const name = INDICATORS.find(([k]) => k === indicator)[1].toLowerCase();
    return `<div class="card chart-card">
      <p class="chart-title">${escapeHtml(cap(name))} for age, ${unitOf(settings)}
        <span>· WHO standard for ${sexWord}</span></p>
      <p class="chart-readout" id="growthReadout">${readout(points, settings)}</p>
      ${chartSvg(points, settings)}
      <p class="chart-foot">The darker band is the middle 70% of healthy ${sexWord}, the lighter one
        the middle 94%. The shape of her line over time says more than any one dot — take any
        worry to your clinic.</p>
    </div>`;
  }

  function unitOf(settings) {
    const imperial = settings.growthUnits === 'imperial';
    return indicator === 'weight' ? (imperial ? 'lb' : 'kg') : (imperial ? 'in' : 'cm');
  }

  function inRange(r, settings) {
    const m = Who.ageInMonths(settings.dob, r.at);
    return m != null && m >= 0 && m <= Who.MAX_MONTHS;
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function readout(points, settings) {
    if (!points.length) return `No ${indicator} measured yet.`;
    const p = points.find(p => p.r.id === pickedId) || points[points.length - 1];
    const pct = Who.percentile(settings.sex, indicator, p.x, p.v);
    return [
      `<b>${escapeHtml(show(indicator, p.v, settings))}</b>`,
      escapeHtml(Who.describe(pct)),
      escapeHtml(`${Fmt.shortDate(p.r.at)}, at ${Fmt.ageAt(settings.dob, p.r.at) || 'birth'}`),
    ].filter(Boolean).join(' · ');
  }

  /** Display units for the axis: the chart reads in what the parent uses. */
  function toDisplay(v, settings) {
    if (settings.growthUnits !== 'imperial') return v;
    return indicator === 'weight' ? v / 0.45359237 : v / 2.54;
  }

  function chartSvg(points, settings) {
    const sex = settings.sex;
    const nowMonths = Who.ageInMonths(settings.dob, Date.now());
    const lastX = Math.max(nowMonths, ...points.map(p => p.x));
    const xMax = Math.min(Who.MAX_MONTHS, Math.max(6, Math.ceil(lastX) + 1));

    const conv = v => toDisplay(v, settings);
    const sample = [];
    for (let x = 0; x <= xMax + 1e-9; x += 0.25) sample.push(x);
    const curves = Object.fromEntries(Who.CURVES.map(p =>
      [p, sample.map(x => conv(Who.curve(sex, indicator, x, p)))]));

    const values = points.map(p => conv(p.v));
    const lo = Math.min(curves[3][0], ...values);
    const hi = Math.max(curves[97][curves[97].length - 1], ...values);
    const step = niceStep((hi - lo) / 4);
    const yMin = Math.floor(lo / step) * step;
    const yMax = Math.ceil(hi / step) * step;

    const sx = x => PAD.l + (x / xMax) * (W - PAD.l - PAD.r);
    const sy = v => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
    const line = ys => ys.map((y, i) => `${i ? 'L' : 'M'}${sx(sample[i]).toFixed(1)},${sy(y).toFixed(1)}`).join('');
    const band = (a, b) => `${line(curves[b])}${[...curves[a]].reverse()
      .map((y, i) => `L${sx(sample[sample.length - 1 - i]).toFixed(1)},${sy(y).toFixed(1)}`).join('')}Z`;

    const grid = [];
    for (let v = yMin; v <= yMax + step / 2; v += step) {
      grid.push(`<line class="c-grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${sy(v)}" y2="${sy(v)}"/>
        <text class="c-tick" x="${PAD.l - 6}" y="${sy(v) + 3.5}" text-anchor="end">${fmtTick(v, step)}</text>`);
    }
    const xStep = xMax > 12 ? 3 : xMax > 8 ? 2 : 1;
    const xTicks = [];
    for (let m = 0; m <= xMax; m += xStep) {
      const last = m + xStep > xMax;
      xTicks.push(`<text class="c-tick" x="${sx(m)}" y="${H - 8}" text-anchor="middle">${m}${last ? ' mo' : ''}</text>`);
    }

    const end = sample.length - 1;
    const curveLabel = p => `<text class="c-curve" x="${W - PAD.r + 5}" y="${sy(curves[p][end]) + 3.5}">${Who.ordinal(p)}</text>`;

    const path = points.length > 1
      ? `<path class="c-her" d="${points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(conv(p.v)).toFixed(1)}`).join('')}"/>`
      : '';
    const picked = points.find(p => p.r.id === pickedId) || points[points.length - 1];
    const dots = points.map(p => {
      const cx = sx(p.x).toFixed(1), cy = sy(conv(p.v)).toFixed(1);
      return `<g class="c-point ${p === picked ? 'is-picked' : ''}" data-point="${p.r.id}">
        <circle class="c-hit" cx="${cx}" cy="${cy}" r="15"/>
        <circle class="c-dot" cx="${cx}" cy="${cy}" r="${p === picked ? 5.5 : 4.5}"/></g>`;
    }).join('');

    return `<svg class="g-chart" viewBox="0 0 ${W} ${H}" role="img"
        aria-label="${escapeHtml(`${cap(indicator)} for age chart, ${points.length} measurement${points.length === 1 ? '' : 's'}`)}">
      ${grid.join('')}
      <path class="c-band-outer" d="${band(3, 97)}"/>
      <path class="c-band-inner" d="${band(15, 85)}"/>
      <path class="c-median" d="${line(curves[50])}"/>
      ${curveLabel(97)}${curveLabel(50)}${curveLabel(3)}
      ${xTicks.join('')}
      ${path}${dots}
    </svg>`;
  }

  function niceStep(raw) {
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  }

  function fmtTick(v, step) {
    return step < 1 ? v.toFixed(1) : String(Math.round(v));
  }

  /* ── milestones ──────────────────────────────────────────── */
  function milestoneSection(settings) {
    const records = Store.byType('milestone');
    if (!records.length) {
      return `<section class="grow-section">${head('Milestones', 'milestone', '+ Add')}
        <div class="card soft-empty">First smile, rolling over, the first tooth — note each one
          down with a photo, and both phones keep it.</div></section>`;
    }
    const cards = records.map(r => `
      <li><button class="m-card" data-entry="${r.id}">
        ${r.data.photo
          ? `<span class="m-photo" data-photo-wrap><img alt="" data-photo="${escapeHtml(r.data.photo)}" hidden></span>`
          : `<span class="m-photo m-photo-none" aria-hidden="true">⭐</span>`}
        <span class="m-text">
          <span class="m-title">${escapeHtml(r.data.title || 'Milestone')}</span>
          <span class="m-when">${escapeHtml(Fmt.shortDate(r.at))}${Fmt.ageAt(settings.dob, r.at)
            ? ` · ${escapeHtml(Fmt.ageAt(settings.dob, r.at))}` : ''}</span>
        </span>
      </button></li>`).join('');
    return `<section class="grow-section">${head('Milestones', 'milestone', '+ Add')}
      <ul class="m-grid">${cards}</ul></section>`;
  }

  /* ── foods ───────────────────────────────────────────────── */
  const REACTION_MARK = { loved: '😋', ok: '🙂', refused: '🙅' };

  function foodSection() {
    const Foods = Features.Foods;
    const foods = Foods.tried().sort((a, b) => b.first - a.first);
    if (!foods.length) {
      return `<section class="grow-section">${head('Foods tried', 'solids', '+ Log a meal')}
        <div class="card soft-empty">When she starts solids, every new food lands here — with
          how it went, and which common allergens she has had so far.</div></section>`;
    }

    const triedAllergens = new Set(foods.map(f => f.allergen).filter(Boolean));
    const allergenChips = Foods.ALLERGENS.map(a =>
      `<li class="a-chip ${triedAllergens.has(a) ? 'is-done' : ''}">
        <span aria-hidden="true">${triedAllergens.has(a) ? '✓' : ''}</span>${escapeHtml(cap(a))}
        <span class="sr-only">${triedAllergens.has(a) ? 'tried' : 'not yet'}</span></li>`).join('');

    const rows = foods.map(f => `
      <li class="f-row ${f.flagged ? 'is-flagged' : ''}">
        <span class="f-main">
          <span class="f-name">${escapeHtml(Foods.label(f.key))}${f.allergen
            ? `<span class="f-badge">${escapeHtml(f.allergen)}</span>` : ''}</span>
          <span class="f-sub">First ${escapeHtml(Fmt.shortDate(f.first))} · ${f.times}×${f.flagged
            ? ' · <b>reaction noted</b>' : ''}</span>
        </span>
        <span class="f-mark" title="${escapeHtml(f.reaction || '')}">${f.flagged ? '⚠️' : REACTION_MARK[f.reaction] || ''}</span>
      </li>`).join('');

    return `<section class="grow-section">${head(`Foods tried <span class="count">${foods.length}</span>`, 'solids', '+ Log a meal')}
      <div class="card">
        <p class="a-title">Common allergens so far</p>
        <ul class="a-chips">${allergenChips}</ul>
      </div>
      <ul class="f-list">${rows}</ul>
    </section>`;
  }

  /* ── wiring ──────────────────────────────────────────────── */
  function wire(container, onRerender) {
    rerender = onRerender;
    container.addEventListener('click', e => {
      const tile = e.target.closest('[data-indicator]');
      if (tile) { indicator = tile.dataset.indicator; pickedId = null; rerender(); return; }
      const point = e.target.closest('[data-point]');
      if (point) { pickedId = point.dataset.point; rerender(); }
    });
  }

  return { render, wire, anyOn };
})();
