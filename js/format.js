/* Formatting helpers — durations, clock times, day labels, entry summaries. */
const Fmt = (() => {
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;

  /** 95m -> "1h 35m". Short and glanceable. */
  function duration(ms, { long = false } = {}) {
    if (ms == null || !Number.isFinite(ms)) return '—';
    const total = Math.max(0, Math.round(ms / MIN));
    const h = Math.floor(total / 60), m = total % 60;
    if (long) {
      if (h && m) return `${h} hr ${m} min`;
      if (h) return `${h} hr`;
      return `${m} min`;
    }
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
  }

  /** "2h 10m ago", "just now". */
  function ago(ts) {
    if (ts == null) return '—';
    const diff = Date.now() - ts;
    if (diff < MIN) return 'just now';
    return `${duration(diff)} ago`;
  }

  function clock(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function dayLabel(ts) {
    const d = new Date(ts); d.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - d) / DAY);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  /** Age from a yyyy-mm-dd string, in friendly units. */
  function age(dob) {
    if (!dob) return '';
    const born = new Date(dob + 'T00:00:00');
    if (isNaN(born)) return '';
    const days = Math.floor((Date.now() - born) / DAY);
    if (days < 0) return '';
    if (days < 14) return `${days} day${days === 1 ? '' : 's'} old`;
    if (days < 120) {
      const w = Math.floor(days / 7);
      return `${w} week${w === 1 ? '' : 's'} old`;
    }
    const months = ageMonths(dob);
    if (months < 24) return `${months} month${months === 1 ? '' : 's'} old`;
    return `${Math.floor(months / 12)} years old`;
  }

  /** Whole months since dob, for wake-window lookup. */
  function ageMonths(dob) {
    if (!dob) return null;
    const born = new Date(dob + 'T00:00:00');
    if (isNaN(born)) return null;
    const now = new Date();
    let months = (now.getFullYear() - born.getFullYear()) * 12 + (now.getMonth() - born.getMonth());
    if (now.getDate() < born.getDate()) months--;
    return Math.max(0, months);
  }

  const ML_PER_OZ = 29.5735;

  function amount(ml, units) {
    if (ml == null) return '';
    return units === 'oz'
      ? `${round1(ml / ML_PER_OZ)} oz`
      : `${Math.round(ml)} ml`;
  }

  function toMl(value, units) {
    if (value === '' || value == null) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return units === 'oz' ? n * ML_PER_OZ : n;
  }

  function fromMl(ml, units) {
    if (ml == null) return '';
    return units === 'oz' ? round1(ml / ML_PER_OZ) : Math.round(ml);
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  const FEED_METHOD = {
    bottle: 'Bottle',
    left: 'Left breast',
    right: 'Right breast',
    solids: 'Solids',
  };
  const DIAPER_KIND = { wet: 'Wet', dirty: 'Dirty', both: 'Wet + dirty' };
  const ICON = { feed: '🍼', diaper: '🧷', sleep: '🌙' };

  /** Headline + detail line for an entry row. */
  function describe(entry, units) {
    if (entry.type === 'feed') {
      const bits = [];
      if (entry.amount != null) bits.push(amount(entry.amount, units));
      if (entry.end) bits.push(duration(entry.end - entry.start));
      return { title: FEED_METHOD[entry.method] || 'Feed', detail: bits.join(' · ') };
    }
    if (entry.type === 'diaper') {
      return { title: DIAPER_KIND[entry.kind] || 'Diaper', detail: 'Diaper change' };
    }
    const live = entry.end == null;
    return {
      title: live ? 'Sleeping' : 'Sleep',
      detail: live
        ? `since ${clock(entry.start)}`
        : `${clock(entry.start)} – ${clock(entry.end)} · ${duration(entry.end - entry.start)}`,
    };
  }

  return {
    MIN, HOUR, DAY,
    duration, ago, clock, dayKey, dayLabel, age, ageMonths,
    amount, toMl, fromMl, describe,
    FEED_METHOD, DIAPER_KIND, ICON,
  };
})();
