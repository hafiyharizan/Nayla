/* Logging by voice.
 *
 * Two halves, deliberately separable: a pure parser that turns a spoken
 * phrase into a record, and a thin wrapper over the browser's speech
 * recognition. The parser has no dependencies and no side effects, so it can
 * be tested exhaustively without a microphone — which matters, because
 * mis-hearing "forty" as "fourteen" writes the wrong number into a feed log.
 *
 * Nothing is ever saved straight from speech. The app shows what it heard and
 * what it intends to write, and waits to be told yes. One extra tap is a
 * small price next to silently recording a feed that never happened.
 */
const Voice = (() => {

  /* ── words to numbers ────────────────────────────────────────
   * Recognisers usually return digits for quantities, but not always, and
   * "one thirty" comes back spelled out often enough to matter. */
  const UNITS = {
    zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8,
    nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14,
    fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19,
  };
  const TENS = { twenty:20, thirty:30, forty:40, fourty:40, fifty:50,
                 sixty:60, seventy:70, eighty:80, ninety:90 };

  /** "one hundred and thirty" -> 130, "forty" -> 40, "130" -> 130. */
  function toNumber(text) {
    const digits = /(\d+)/.exec(text);
    if (digits) return Number(digits[1]);

    const words = text.toLowerCase().replace(/-/g, ' ').split(/\s+/);
    let current = 0, saw = false;
    for (const w of words) {
      if (w === 'and') continue;
      if (w in UNITS)      { current += UNITS[w]; saw = true; }
      else if (w in TENS)  { current += TENS[w];  saw = true; }
      else if (w === 'hundred') { current = (current || 1) * 100; saw = true; }
      else if (saw) break;               // the number has ended
    }
    return saw ? current : null;
  }

  const NUMERIC_WORD = w => /^\d+$/.test(w) || w in UNITS || w in TENS ||
                            w === 'hundred' || w === 'and';

  /** A number only if the WHOLE phrase is exactly one — "ml 20" is not, and
   *  neither is "100 twenty", which is two numbers sitting next to each
   *  other ("feed 100, twenty minutes ago") rather than one. */
  function pureNumber(phrase) {
    const words = phrase.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.length || !words.every(NUMERIC_WORD)) return null;
    // Digits stand alone; spelled-out numbers may run over several words.
    if (words.some(w => /^\d+$/.test(w)) && words.length > 1) return null;
    return toNumber(words.join(' '));
  }

  /* ── when ────────────────────────────────────────────────────
   * "ten minutes ago" is the common one: you log once the feed is finished,
   * not while it is happening.
   *
   * The quantity is read by walking BACKWARDS from the unit, taking the
   * longest run of words that is entirely a number. Matching forwards with a
   * loose pattern swallowed whole phrases — "wet nappy an hour ago" came back
   * with "wet nappy an" as the quantity, leaving nothing to identify. */
  function parseWhen(text, now = Date.now()) {
    if (/\bhalf an hour ago\b/i.test(text)) {
      return { at: now - 1800000, matched: /half an hour ago/i.exec(text)[0] };
    }

    const unit = /\b(minutes|minute|mins|min|hours|hour|hrs|hr)\s+ago\b/i.exec(text);
    if (unit) {
      const step = /^h/i.test(unit[1]) ? 3600000 : 60000;
      const before = text.slice(0, unit.index).trimEnd();
      const words = before.split(/\s+/).filter(Boolean);

      let n = null, used = 0;
      for (const take of [3, 2, 1]) {
        if (take > words.length) continue;
        const value = pureNumber(words.slice(-take).join(' '));
        if (value != null) { n = value; used = take; break; }
      }
      // "an hour ago" / "a minute ago" carry no number at all.
      const quantity = used ? words.slice(-used).join(' ') : '';
      const startedAt = used
        ? before.length - quantity.length
        : unit.index;

      return {
        at: now - (n ?? 1) * step,
        matched: text.slice(startedAt, unit.index + unit[0].length),
      };
    }

    // "at 7:30", "at 7 30 pm", "at 7pm"
    const at = /\bat\s+(\d{1,2})[:.\s]?(\d{2})?\s*(am|pm)?\b/i.exec(text);
    if (at) {
      let hour = Number(at[1]);
      const minute = at[2] ? Number(at[2]) : 0;
      const mer = (at[3] || '').toLowerCase();
      if (mer === 'pm' && hour < 12) hour += 12;
      if (mer === 'am' && hour === 12) hour = 0;
      if (hour <= 23 && minute <= 59) {
        const d = new Date(now);
        d.setHours(hour, minute, 0, 0);
        // Spoken after the fact; a time in the future means earlier today.
        if (d.getTime() > now + 60000) d.setDate(d.getDate() - 1);
        return { at: d.getTime(), matched: at[0] };
      }
    }
    return { at: now, matched: null };
  }

  /* ── what ────────────────────────────────────────────────── */
  const WAKE   = /\b(woke|awake|waking|wake\s*up|got\s*up)\b/i;
  const SLEEP  = /\b(sleep|asleep|sleeping|nap|napping|went\s*down|going\s*down|bed)\b/i;
  const DIAPER = /\b(nappy|nappies|diaper|diapers|changed?)\b/i;
  const WET    = /\b(wet|pee|peed|wee|weed|urine)\b/i;
  const DIRTY  = /\b(dirty|poo|poop|pooped|poops|soiled|dirtied|number\s*two)\b/i;
  const FEED   = /\b(feed|fed|feeding|bottle|milk|drank|drink|formula|ate|eat)\b/i;
  const BREAST = /\b(breast|nursed|nursing|nurse|latch)\b/i;
  const LEFT   = /\bleft\b/i;
  const RIGHT  = /\bright\b/i;
  const AMOUNT = /(\d+)\s*(?:ml|mls|millilitres|milliliters)?\b|\b(?:ml|mls)\b/i;

  /**
   * Turn a spoken phrase into something the app can log.
   *
   * Returns null when nothing recognisable was said — better to say "didn't
   * catch that" than to guess at a feed.
   *
   *   { kind: 'record', record: {...}, summary: 'Feed · 130 ml' }
   *   { kind: 'wake' }                        — close the sleep in progress
   */
  function parse(phrase, now = Date.now()) {
    if (!phrase || !phrase.trim()) return null;
    const text = phrase.trim();

    const when = parseWhen(text, now);
    // Strip the time words before looking for an amount, so "20 minutes ago"
    // cannot be mistaken for 20 ml.
    const body = when.matched ? text.replace(when.matched, ' ') : text;

    // Waking is checked first: "woke up from her nap" mentions sleep too.
    if (WAKE.test(body)) return { kind: 'wake', heard: phrase };

    if (SLEEP.test(body)) {
      return {
        kind: 'record', heard: phrase, summary: 'Sleep · starting now',
        record: { type: 'sleep', at: when.at, end: null, note: '', data: {} },
      };
    }

    const wet = WET.test(body), dirty = DIRTY.test(body);
    if (wet || dirty || DIAPER.test(body)) {
      const kind = wet && dirty ? 'both' : dirty ? 'dirty' : 'wet';
      const label = { wet: 'Wet', dirty: 'Dirty', both: 'Wet + dirty' }[kind];
      return {
        kind: 'record', heard: phrase, summary: `Diaper · ${label}`,
        record: { type: 'diaper', at: when.at, end: null, note: '', data: { kind } },
      };
    }

    if (FEED.test(body) || BREAST.test(body) || AMOUNT.test(body)) {
      const method = BREAST.test(body)
        ? (RIGHT.test(body) ? 'right' : LEFT.test(body) ? 'left' : 'left')
        : 'bottle';
      // Only read a number as millilitres for a bottle; "left breast" has none.
      const amount = method === 'bottle' ? toNumber(body) : null;
      const label = { bottle: 'Bottle', left: 'Left breast', right: 'Right breast' }[method];
      return {
        kind: 'record', heard: phrase,
        summary: `Feed · ${label}${amount ? ` · ${amount} ml` : ''}`,
        record: {
          type: 'feed', at: when.at, end: null, note: '',
          data: { method, amount: amount || null },
        },
      };
    }

    return null;
  }

  /* ── the microphone ──────────────────────────────────────── */
  const Recognition = typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  const supported = () => Boolean(Recognition);

  let active = null;

  /**
   * Listen once. Resolves with the transcript, or rejects with a reason the
   * UI can show plainly.
   */
  function listen() {
    return new Promise((resolve, reject) => {
      if (!Recognition) return reject(new Error('unsupported'));
      stop();

      const rec = new Recognition();
      rec.lang = (navigator.language || '').startsWith('en') ? navigator.language : 'en-GB';
      rec.continuous = false;
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      let settled = false;
      const done = fn => (...a) => { if (!settled) { settled = true; active = null; fn(...a); } };
      const ok = done(resolve), fail = done(reject);

      rec.onresult = e => ok(e.results[0][0].transcript);
      rec.onerror = e => fail(new Error(e.error || 'failed'));
      // Ended with nothing heard — silence, or the mic never opened.
      rec.onend = () => fail(new Error('no-speech'));

      active = rec;
      try { rec.start(); } catch (err) { fail(err); }
    });
  }

  function stop() {
    if (active) { try { active.abort(); } catch { /* already gone */ } active = null; }
  }

  /** Why it failed, in words worth showing someone holding a baby. */
  function explain(err) {
    const reason = String(err && err.message || err);
    if (reason === 'unsupported') return "This browser can't do voice. Use the buttons instead.";
    if (reason === 'not-allowed' || reason === 'service-not-allowed')
      return 'Microphone access is off for this site. Turn it on in your browser settings.';
    if (reason === 'no-speech') return "Didn't hear anything — try again.";
    if (reason === 'network') return 'Voice needs a connection, and there is none right now.';
    if (reason === 'aborted') return '';
    return "Didn't catch that — try again.";
  }

  return { parse, parseWhen, toNumber, listen, stop, supported, explain };
})();

if (typeof module !== 'undefined') module.exports = Voice;
