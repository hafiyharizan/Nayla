/* Next up: what she is likely to need next, worked out from the log.
 *
 * One line each for feeding, sleep, her diaper and her bath, saying either
 * "do this now", "coming up" or "next around 4:40 PM". The timings come from
 * her own rhythm once there is enough of it in the log, and from common
 * age-based guidance until then. They are a nudge, not a schedule — her
 * cues beat the clock, and the wording says so where it matters.
 *
 *   now     overdue: worth doing now           (sorted first, highlighted)
 *   soon    due within the half hour, or due but she is asleep
 *   later   not yet: when it's next due
 */
const Next = (() => {
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const RANK = { now: 0, soon: 1, later: 2 };

  /* Age-based starting points, used until her own rhythm is in the log. */
  const FEED_EVERY = [            // between the starts of feeds
    { upToMonths: 1, ms: 2 * HOUR },
    { upToMonths: 3, ms: 2.5 * HOUR },
    { upToMonths: 6, ms: 3 * HOUR },
    { upToMonths: 12, ms: 3.5 * HOUR },
    { upToMonths: Infinity, ms: 4 * HOUR },
  ];
  const DIAPER_EVERY = [
    { upToMonths: 3, ms: 2.5 * HOUR },
    { upToMonths: 12, ms: 3 * HOUR },
    { upToMonths: Infinity, ms: 3.5 * HOUR },
  ];
  /* Past this a daytime nap starts eating into the night. */
  const NAP_MAX = [
    { upToMonths: 3, ms: 2.5 * HOUR },
    { upToMonths: 12, ms: 2 * HOUR },
    { upToMonths: Infinity, ms: 2.5 * HOUR },
  ];
  /* Two or three times a week is plenty for most babies. */
  const BATH_EVERY = 2 * DAY;

  /** Newborns shouldn't go much longer than this without a feed, asleep or not. */
  const NEWBORN_FEED_MAX = 4 * HOUR;

  const pick = (table, months) =>
    (table.find(r => (months ?? 4) < r.upToMonths) || table[table.length - 1]).ms;

  const median = xs => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  /** Her usual gap between entries of a type, from the recent log — or null
   *  until there are enough of them to say. Gaps outside lo..hi are ignored:
   *  shorter is a top-up or a double entry, longer is the night or a gap in
   *  the logging. */
  function usualGap(type, { days, min, lo, hi }) {
    const now = Date.now();
    const at = Store.byType(type).filter(r => r.at > now - days * DAY && r.at <= now)
      .map(r => r.at).sort((a, b) => a - b);
    if (at.length < min) return null;
    const gaps = [];
    for (let i = 1; i < at.length; i++) {
      const g = at[i] - at[i - 1];
      if (g >= lo && g <= hi) gaps.push(g);
    }
    return gaps.length >= min - 1 ? median(gaps) : null;
  }

  /** "around 4:40 PM", "tomorrow morning", "on Friday". */
  function when(ts) {
    const now = Date.now();
    if (Fmt.dayKey(ts) === Fmt.dayKey(now)) return `around ${Fmt.clock(ts)}`;
    if (Fmt.dayKey(ts) === Fmt.dayKey(now + DAY)) {
      const h = new Date(ts).getHours();
      return `tomorrow ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}`;
    }
    return `on ${new Date(ts).toLocaleDateString([], { weekday: 'long' })}`;
  }

  /** "3:10 PM", "yesterday 7:05 PM", "Monday" — when something last happened. */
  function lastTime(ts) {
    const label = Fmt.dayLabel(ts);
    if (label === 'Today') return Fmt.clock(ts);
    if (label === 'Yesterday') return `yesterday ${Fmt.clock(ts)}`;
    return new Date(ts).toLocaleDateString([], { weekday: 'long' });
  }

  /** "3h 10m" within the day, then "1 day", "3 days". */
  function longAgo(ms) {
    if (ms < 20 * HOUR) return Fmt.duration(ms);
    const n = Math.max(1, Math.round(ms / DAY));
    return `${n} day${n === 1 ? '' : 's'}`;
  }

  /** Night: a sleep that began in the evening or small hours. */
  const isNight = ts => { const h = new Date(ts).getHours(); return h >= 19 || h < 6; };

  function items() {
    const on = t => Store.trackerOn(t);
    const s = Store.settings();
    const months = Fmt.ageMonths(s.dob);
    const days = Fmt.ageDays(s.dob);
    const now = Date.now();
    const st = Wake.state(Store.all(), months);
    // A sleep left running is not a baby asleep: Right now asks to fix it.
    const asleep = on('sleep') && st.sleeping;
    const unsure = on('sleep') && (st.forgotten || st.stale);
    const out = [];

    /* ── feeding ── */
    const lastFeed = on('feed') ? Store.latest('feed') : null;
    let feedSince = null;
    if (lastFeed && now - lastFeed.at < DAY) {
      const usual = usualGap('feed', { days: 3, min: 6, lo: 20 * MIN, hi: 8 * HOUR });
      const every = usual || pick(FEED_EVERY, months);
      const why = usual ? `She usually feeds about every ${Fmt.duration(usual)}.`
                        : `Babies her age usually feed about every ${Fmt.duration(every)}.`;
      feedSince = now - lastFeed.at;
      const due = lastFeed.at + every;
      const last = `Last fed ${Fmt.duration(feedSince)} ago (${lastTime(lastFeed.at)}).`;
      const item = { key: 'feed', tone: 'feed', icon: '🍼', due,
        action: { label: 'Log a feed', act: 'log:feed' } };
      if (now >= due && asleep) {
        Object.assign(item, { level: 'soon', title: 'Feed her when she wakes', body: `${last} ${why}` });
      } else if (now >= due) {
        Object.assign(item, { level: 'now', title: 'Time for a feed', body: `${last} ${why} Watch for hunger cues — rooting, sucking on hands.` });
      } else if (due - now <= 30 * MIN) {
        Object.assign(item, { level: 'soon', title: `Feed due ${when(due)}`, body: `${last} ${why}` });
      } else {
        Object.assign(item, { level: 'later', title: `Next feed ${when(due)}`, body: last, action: null });
      }
      out.push(item);
    }

    /* ── sleep: wake her, or put her down ── */
    if (on('sleep') && !unsure && st.since != null) {
      const item = { key: 'sleep', tone: 'sleep', icon: '🌙' };
      if (asleep) {
        const slept = st.elapsedMs;
        const night = isNight(st.since);
        const napMax = pick(NAP_MAX, months);
        const newborn = days != null && days < 28;
        const wakeAct = { label: 'She woke up', act: 'sleep' };
        if (newborn && on('feed') && feedSince != null && feedSince >= NEWBORN_FEED_MAX) {
          Object.assign(item, { level: 'now', icon: '🍼', title: 'Wake her for a feed', due: lastFeed.at + NEWBORN_FEED_MAX,
            body: `Asleep ${Fmt.duration(slept)}, last fed ${Fmt.duration(feedSince)} ago. Newborns usually shouldn't go more than about 4h without a feed — check with your clinic.`,
            action: wakeAct });
        } else if (!night && slept >= napMax) {
          Object.assign(item, { level: 'now', icon: '⏰', title: 'Time to wake her', due: st.since + napMax,
            body: `Napping ${Fmt.duration(slept)}. A nap much past ${Fmt.duration(napMax)} can cut into her night sleep.`,
            action: wakeAct });
        } else if (!night) {
          Object.assign(item, { level: 'later', title: `Napping ${Fmt.duration(slept)}`, due: st.since + napMax,
            body: `Let her sleep — wake her ${when(st.since + napMax)} if she's still down.` });
        } else {
          Object.assign(item, { level: 'later', title: `Asleep ${Fmt.duration(slept)}`, due: Infinity,
            body: 'Night sleep — let her sleep.' });
        }
        out.push(item);
      } else if (st.range) {
        const { min, max } = st.range;
        const window = `${Fmt.duration(min * MIN)}–${Fmt.duration(max * MIN)}`;
        const awake = Fmt.duration(st.elapsedMs);
        const sleepAct = { label: 'Start sleep', act: 'sleep' };
        if (st.status === 'over') {
          Object.assign(item, { level: 'now', icon: '😴', title: 'Time for her to sleep', due: st.since + max * MIN,
            body: `Awake ${awake} — past her ${window} wake window, so she may be overtired. Time to wind down.`,
            action: sleepAct });
        } else if (st.status === 'due') {
          Object.assign(item, { level: 'soon', icon: '😴', title: 'Sleep soon', due: st.since + min * MIN,
            body: `Awake ${awake}, in her ${window} wake window. Watch for yawns, rubbing eyes, staring off.`,
            action: sleepAct });
        } else {
          Object.assign(item, { level: 'later', title: `Next sleep ${when(st.since + min * MIN)}`, due: st.since + min * MIN,
            body: `Awake ${awake} of her ${window} wake window.` });
        }
        out.push(item);
      }
    }

    /* ── diaper ── */
    const lastDiaper = on('diaper') ? Store.latest('diaper') : null;
    if (lastDiaper && now - lastDiaper.at < DAY && !(asleep && isNight(now))) {
      const usual = usualGap('diaper', { days: 3, min: 6, lo: 45 * MIN, hi: 6 * HOUR });
      const every = Math.min(4 * HOUR, Math.max(2 * HOUR, usual || pick(DIAPER_EVERY, months)));
      const since = now - lastDiaper.at;
      const due = lastDiaper.at + every;
      const kind = Features.DIAPER_KIND[lastDiaper.data.kind];
      const last = `Last changed ${Fmt.duration(since)} ago (${lastTime(lastDiaper.at)}${kind ? `, ${kind.toLowerCase()}` : ''}).`;
      const item = { key: 'diaper', tone: 'diaper', icon: '🧷', due,
        action: { label: 'Log a diaper', act: 'log:diaper' } };
      if (now >= due && asleep) {
        Object.assign(item, { level: 'soon', title: 'Check her diaper when she wakes', body: last });
      } else if (now >= due) {
        Object.assign(item, { level: 'now', title: 'Diaper check', body: `${last} Worth a check and a change.` });
      } else if (due - now <= 30 * MIN) {
        Object.assign(item, { level: 'soon', title: `Diaper check ${when(due)}`, body: last });
      } else {
        Object.assign(item, { level: 'later', title: `Next diaper check ${when(due)}`, body: last, action: null });
      }
      out.push(item);
    }

    /* ── bath ── */
    if (on('bath')) {
      const lastBath = Store.latest('bath');
      const item = { key: 'bath', tone: 'bath', icon: '🛁',
        action: { label: 'Log a bath', act: 'log:bath' } };
      if (!lastBath) {
        Object.assign(item, { level: 'later', due: Infinity, title: 'Bath time',
          body: 'Log her baths and this will say when the next one is due.', showAction: true });
      } else {
        const usual = usualGap('bath', { days: 21, min: 3, lo: 6 * HOUR, hi: 8 * DAY });
        const every = usual || BATH_EVERY;
        const since = now - lastBath.at;
        const due = lastBath.at + every;
        const hour = new Date(now).getHours();
        const daytime = hour >= 8 && hour < 20;
        const why = usual
          ? `She usually has one every ${usual < 36 * HOUR ? 'day' : `${Math.round(usual / DAY)} days`}.`
          : 'Two or three a week is plenty for most babies.';
        const last = `Last bath ${longAgo(since)} ago (${lastTime(lastBath.at)}).`;
        item.due = due;
        // Within a couple of hours of due is close enough for a bath.
        if (now >= due - 2 * HOUR && daytime && !asleep) {
          Object.assign(item, { level: now >= due + every / 2 ? 'now' : 'soon',
            title: 'Bath time', body: `${last} ${why}` });
        } else if (now >= due - 2 * HOUR) {
          Object.assign(item, { level: 'later', title: asleep ? 'Bath when she wakes' : hour < 8 ? 'Bath later today' : 'Bath tomorrow',
            body: `${last} ${why}`, action: null });
        } else {
          Object.assign(item, { level: 'later', title: `Next bath ${when(due)}`, body: last, action: null });
        }
      }
      out.push(item);
    }

    return out.sort((a, b) => RANK[a.level] - RANK[b.level] || a.due - b.due);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render() {
    const list = items();
    const box = document.getElementById('homeNext');
    document.getElementById('nextHead').hidden = !list.length;
    box.hidden = !list.length;
    box.innerHTML = list.map((it, i) => `
      <li class="next next-${it.level}" data-next="${it.key}" style="--i:${i}">
        <span class="next-icon tone-${it.tone}" aria-hidden="true">${it.icon}</span>
        <span class="next-text">
          ${it.level === 'later' ? '' : `<em class="next-tag">${it.level === 'now' ? 'Now' : 'Soon'}</em>`}
          <b>${escapeHtml(it.title)}</b>
          <span>${escapeHtml(it.body)}</span>
          ${it.action && (it.level !== 'later' || it.showAction)
            ? `<button class="btn btn-small next-act" data-act="${escapeHtml(it.action.act)}">${escapeHtml(it.action.label)}</button>` : ''}
        </span>
      </li>`).join('');
  }

  return { items, render };
})();
