/* Formatting helpers — durations, clock times, day labels, units.
 * Pure presentation: knows nothing about feeds, sleeps or records. */
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

  /* Growth is stored in kg and cm; 'imperial' shows lb and inches. */
  const KG_PER_LB = 0.45359237;
  const CM_PER_IN = 2.54;

  function parsePositive(value) {
    if (value === '' || value == null) return null;
    const n = Number(String(value).replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /** Form value -> kg / cm. */
  function toKg(value, units) {
    const n = parsePositive(value);
    return n == null ? null : units === 'imperial' ? n * KG_PER_LB : n;
  }
  function toCm(value, units) {
    const n = parsePositive(value);
    return n == null ? null : units === 'imperial' ? n * CM_PER_IN : n;
  }

  /** kg / cm -> the number shown in a form field. */
  function fromKg(kg, units) {
    if (kg == null) return '';
    return units === 'imperial' ? Math.round(kg / KG_PER_LB * 100) / 100 : Math.round(kg * 1000) / 1000;
  }
  function fromCm(cm, units) {
    if (cm == null) return '';
    return units === 'imperial' ? round1(cm / CM_PER_IN) : round1(cm);
  }

  /** "6.82 kg", or "15 lb 1 oz" — nobody says "15.06 lb" out loud. */
  function weight(kg, units) {
    if (kg == null) return '';
    if (units === 'imperial') {
      const oz = Math.round(kg / KG_PER_LB * 16);
      return `${Math.floor(oz / 16)} lb ${oz % 16} oz`;
    }
    return `${Math.round(kg * 100) / 100} kg`;
  }
  function length(cm, units) {
    if (cm == null) return '';
    return units === 'imperial' ? `${round1(cm / CM_PER_IN)} in` : `${round1(cm)} cm`;
  }

  /** "12 Oct", with the year only when it isn't this one. */
  function shortDate(ts) {
    const d = new Date(ts);
    const opts = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString([], opts);
  }

  /** "4 months", "3 weeks" — her age on a given day, for milestones. */
  function ageAt(dob, ts) {
    if (!dob) return '';
    const born = new Date(dob + 'T00:00:00');
    if (isNaN(born)) return '';
    const days = Math.floor((ts - born) / DAY);
    if (days < 0) return '';
    if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
    if (days < 91) { const w = Math.floor(days / 7); return `${w} weeks`; }
    const d = new Date(ts);
    let months = (d.getFullYear() - born.getFullYear()) * 12 + (d.getMonth() - born.getMonth());
    if (d.getDate() < born.getDate()) months--;
    if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;
    const y = Math.floor(months / 12), m = months % 12;
    return m ? `${y} yr ${m} mo` : `${y} years`;
  }

  return {
    MIN, HOUR, DAY,
    duration, ago, clock, dayKey, dayLabel, age, ageMonths,
    amount, toMl, fromMl,
    toKg, toCm, fromKg, fromCm, weight, length, shortDate, ageAt,
  };
})();
