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
  /* No baby sleeps through this. An open sleep older than it is not a baby
   * asleep — it is a "Start sleep" tap that never got its "Woke up", and
   * without this cap it hijacks the Now screen indefinitely: the ring counts
   * up forever, the wake window is unusable, and closing it finally would
   * write an absurd sleep into the history. */
  const MAX_OPEN_SLEEP_MS = 12 * 3600 * 1000;

  /* Likewise there is no useful "awake for" once nothing has been logged in
   * a day — that is a gap in the log, not a very long afternoon. */
  const MAX_AWAKE_MS = 24 * 3600 * 1000;

  function state(records, ageMonths) {
    const open = records.find(r => r.type === 'sleep' && r.end == null);
    const forgotten = open && Date.now() - open.at > MAX_OPEN_SLEEP_MS ? open : null;
    const active = forgotten ? null : open;
    const range = rangeFor(ageMonths);

    if (active) {
      return {
        sleeping: true,
        since: active.at,
        elapsedMs: Date.now() - active.at,
        range, ratio: null, status: null,
        entry: active, forgotten: null, stale: false,
      };
    }

    const lastSleep = records.find(r => r.type === 'sleep' && r.end != null);
    const since = lastSleep ? lastSleep.end : null;
    const elapsedMs = since ? Date.now() - since : null;

    let ratio = null, status = null;
    if (range && elapsedMs != null) {
      ratio = elapsedMs / (range.max * Fmt.MIN);
      const mins = elapsedMs / Fmt.MIN;
      status = mins < range.min ? 'early' : mins <= range.max ? 'due' : 'over';
    }

    // Nothing logged for a day or more: say so, rather than showing a number
    // that reads like a medical emergency.
    const stale = elapsedMs != null && elapsedMs > MAX_AWAKE_MS;

    return {
      sleeping: false, since, elapsedMs, range, ratio, status,
      entry: lastSleep, forgotten, stale,
    };
  }

  /** One line of plain-language guidance under the timer. */
  function hint(st) {
    if (st.sleeping) return 'Tap to log wake-up';
    if (st.forgotten) return 'A sleep was left running — fix it below';
    if (st.stale) return 'Nothing logged for a while';
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
