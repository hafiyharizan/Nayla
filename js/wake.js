/* Wake-window guidance.
 *
 * A "wake window" is how long a baby can comfortably stay awake between sleeps.
 * The ranges below are the commonly cited age-based ones — a starting point,
 * not a rule. Cues beat the clock.
 */
const Wake = (() => {
  const RANGES = [
    { upToMonths: 1,  min: 45,  max: 60 },
    { upToMonths: 2,  min: 60,  max: 90 },
    { upToMonths: 3,  min: 75,  max: 105 },
    { upToMonths: 4,  min: 90,  max: 120 },
    { upToMonths: 6,  min: 120, max: 150 },
    { upToMonths: 9,  min: 150, max: 180 },
    { upToMonths: 12, min: 180, max: 240 },
    { upToMonths: 18, min: 240, max: 300 },
    { upToMonths: Infinity, min: 300, max: 360 },
  ];

  /** Recommended window in minutes for an age in months, or null if age unknown. */
  function rangeFor(ageMonths) {
    if (ageMonths == null) return null;
    return RANGES.find(r => ageMonths < r.upToMonths) || RANGES[RANGES.length - 1];
  }

  /**
   * Current wake/sleep state.
   * Returns { sleeping, since, elapsedMs, range, ratio, status }
   *   since     — when the current stretch began (ms), or null if nothing logged yet
   *   ratio     — progress through the recommended window, 0..1+ (null without a range)
   *   status    — 'early' | 'due' | 'over' | null
   */
  function state(entries, ageMonths) {
    const active = entries.find(e => e.type === 'sleep' && e.end == null);
    const range = rangeFor(ageMonths);

    if (active) {
      return {
        sleeping: true,
        since: active.start,
        elapsedMs: Date.now() - active.start,
        range, ratio: null, status: null,
        entry: active,
      };
    }

    const lastSleep = entries.find(e => e.type === 'sleep' && e.end != null);
    const since = lastSleep ? lastSleep.end : null;
    const elapsedMs = since ? Date.now() - since : null;

    let ratio = null, status = null;
    if (range && elapsedMs != null) {
      ratio = elapsedMs / (range.max * Fmt.MIN);
      const mins = elapsedMs / Fmt.MIN;
      status = mins < range.min ? 'early' : mins <= range.max ? 'due' : 'over';
    }

    return { sleeping: false, since, elapsedMs, range, ratio, status, entry: lastSleep };
  }

  /** One line of plain-language guidance under the timer. */
  function hint(st) {
    if (st.sleeping) return 'Tap to log wake-up';
    if (!st.range) return 'Add a date of birth for wake-window guidance';
    const { min, max } = st.range;
    const target = `Aim for ${Fmt.duration(min * Fmt.MIN)}–${Fmt.duration(max * Fmt.MIN)}`;
    if (st.elapsedMs == null) return target;
    if (st.status === 'early') {
      const left = min * Fmt.MIN - st.elapsedMs;
      return `${target} · sleepy in ~${Fmt.duration(left)}`;
    }
    if (st.status === 'due') return `${target} · in the sleep window now`;
    return `${target} · overtired territory`;
  }

  return { rangeFor, state, hint };
})();
