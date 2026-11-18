/* Right now: what needs attention, and a few gentle suggestions, worked out
 * from the log — never more than five. Shown on Log, above Next up, since
 * each of them is something to do.
 *
 * Alert buttons use data-act rather than the data-log / data-entry buttons
 * used everywhere else; Log's click handler (wire, below) runs them, and the
 * same handler runs Next up's buttons (next.js).
 */
const Alerts = (() => {
  const DISMISS_KEY = 'nayla.dismissed.v1';
  const DAY = 86400000, HOUR = 3600000;
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

  /** A dismissed alert comes back when her next day starts (see day.js). */
  const endOfToday = () => Day.next(Day.start(0));

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
      }
    }

    /* Awake past her wake window and a feed being due live in Next up
     * (next.js), with the other timings, rather than here. */

    /* diapers: fewer wet ones than usual, judged only late in the day (and
     * not overnight, when changes are naturally fewer) */
    const dayBegan = Day.start(0);
    if (on('diaper') && now - dayBegan >= 9 * HOUR && new Date().getHours() >= 15) {
      const wet = r => r.data.kind === 'wet' || r.data.kind === 'both';
      const days = [];
      for (let k = 1; k <= 7; k++) {
        const from = Day.start(k), to = Day.start(k - 1);
        const list = Store.byType('diaper').filter(r => r.at >= from && r.at < to);
        if (list.length) days.push(list.filter(wet).length);
      }
      if (days.length >= 3) {
        const usual = days.reduce((a, b) => a + b, 0) / days.length;
        const today = Store.byType('diaper').filter(r => r.at >= dayBegan && wet(r)).length;
        const soFar = usual * ((now - dayBegan) / DAY);
        if (usual >= 4 && today < soFar * 0.5) {
          out.push({ id: `wet:${Day.key(now)}`, level: 'info', icon: '💧',
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

    /* a babysitter can still see the log: a nudge to remove them after */
    if (!Guest.on()) {
      for (const g of Guest.cached()) {
        out.push({ id: `guest:${g.token}`, level: 'info', icon: '🧸',
          title: `${g.label} can see ${name}'s log`,
          body: `${g.can_log ? 'They can log too' : 'View only'}, ${Guest.untilWords(g.expires_at, 'until you remove them')}. Remove them once you're back.`,
          action: { label: 'Remove access', act: `unguest:${g.token}` } });
      }
    }

    const hidden = dismissed();
    // A babysitter needs what's happening, not suggestions meant for the family.
    const guest = Guest.on();
    return out
      .filter(a => !(guest && a.level === 'tip'))
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

  /* ── rendering ───────────────────────────────────────────── */
  /* Which tracker an alert is about, by the start of its id, so its icon
   * sits in that tracker's colour. */
  const TONE = {
    forgotten: 'sleep', wet: 'diaper',
    allergen: 'solids', signs: 'solids', 'solids-ready': 'solids', allergens: 'solids',
    'growth-first': 'growth', 'growth-due': 'growth',
    month: 'milestone', guest: 'milestone',
  };

  function renderAlerts() {
    const list = alerts();
    document.getElementById('logAlerts').innerHTML = list.length
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
           <span class="alert-text"><b>All calm</b><span>Nothing out of the ordinary.</span></span></li>`;
  }

  function render() { renderAlerts(); }

  /* ── wiring ──────────────────────────────────────────────── */
  function wire(view, { openSheet, openEntry, toggleSleep, unguest, rerender }) {
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
      else if (kind === 'unguest') unguest(arg);
    });
  }

  return { alerts, render, wire };
})();
