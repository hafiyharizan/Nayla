/* The feature registry.
 *
 * Every kind of thing Nayla's app records — a feed, a diaper, a sleep, and
 * later growth measurements, photos and milestones — is described here and
 * nowhere else. A feature declares:
 *
 *   label, icon      how it shows up in lists and buttons
 *   fields           the form, declaratively; sheet.js renders it
 *   toValues         record  -> form values
 *   fromValues       form values -> record  (or { error } to refuse the save)
 *   describe         record  -> { title, detail } for a list row
 *   tally / todayCell   how it contributes to the daily summary
 *
 * Adding a feature means adding an entry here. History, the edit sheet,
 * export and sync all pick it up without changes, because none of them know
 * what a feed is — they only know records.
 */
const Features = (() => {

  const FEED_METHOD = {
    bottle: 'Bottle',
    left: 'Left breast',
    right: 'Right breast',
    solids: 'Solids',
  };

  const DIAPER_KIND = { wet: 'Wet', dirty: 'Dirty', both: 'Wet + dirty' };

  const feed = {
    label: 'Feed',
    noun: 'feed',
    icon: '🍼',
    fields: [
      { name: 'method', input: 'segment',
        options: [['bottle', 'Bottle'], ['left', 'Left'], ['right', 'Right'], ['solids', 'Solids']] },
      { name: 'amount', input: 'number', label: 'Amount', unit: 'volume', half: true },
      { name: 'minutes', input: 'number', label: 'Duration (min)', half: true },
      { input: 'hint', text: 'Fill in whichever you track — both are optional.' },
      { name: 'at', input: 'datetime', label: 'Time' },
      { name: 'note', input: 'textarea', label: 'Note (optional)' },
    ],

    toValues(record, settings) {
      return {
        method: record?.data.method ?? 'bottle',
        amount: record?.data.amount != null ? Fmt.fromMl(record.data.amount, settings.units) : '',
        minutes: record?.end ? Math.round((record.end - record.at) / Fmt.MIN) : '',
        at: record?.at ?? Date.now(),
        note: record?.note ?? '',
      };
    },

    fromValues(v, settings) {
      const minutes = Number(v.minutes);
      return {
        at: v.at,
        end: Number.isFinite(minutes) && minutes > 0 ? v.at + minutes * Fmt.MIN : null,
        note: v.note,
        data: { method: v.method || 'bottle', amount: Fmt.toMl(v.amount, settings.units) },
      };
    },

    describe(record, settings) {
      const bits = [];
      if (record.data.amount != null) bits.push(Fmt.amount(record.data.amount, settings.units));
      if (record.end) bits.push(Fmt.duration(record.end - record.at));
      return { title: FEED_METHOD[record.data.method] || 'Feed', detail: bits.join(' · ') };
    },

    /* The Now screen's status card for the most recent one. */
    statusLabel: 'Last feed',
    statusValue(record) { return Fmt.ago(record.at); },
    status(record, settings) {
      return [FEED_METHOD[record.data.method], Fmt.amount(record.data.amount, settings.units)]
        .filter(Boolean).join(' · ');
    },

    tally(record, totals) {
      totals.feeds = (totals.feeds || 0) + 1;
      if (record.data.amount) totals.feedMl = (totals.feedMl || 0) + record.data.amount;
    },

    todayCell(totals, settings) {
      return {
        label: 'Feeds',
        value: totals.feeds || 0,
        note: totals.feedMl ? Fmt.amount(totals.feedMl, settings.units) : '',
      };
    },
  };

  const diaper = {
    label: 'Diaper',
    noun: 'diaper change',
    icon: '🧷',
    fields: [
      { name: 'kind', input: 'segment',
        options: [['wet', 'Wet'], ['dirty', 'Dirty'], ['both', 'Both']] },
      { name: 'at', input: 'datetime', label: 'Time' },
      { name: 'note', input: 'textarea', label: 'Note (optional)' },
    ],

    toValues(record) {
      return {
        kind: record?.data.kind ?? 'wet',
        at: record?.at ?? Date.now(),
        note: record?.note ?? '',
      };
    },

    fromValues(v) {
      return { at: v.at, end: null, note: v.note, data: { kind: v.kind || 'wet' } };
    },

    describe(record) {
      return { title: DIAPER_KIND[record.data.kind] || 'Diaper', detail: 'Diaper change' };
    },

    statusLabel: 'Last diaper',
    statusValue(record) { return Fmt.ago(record.at); },
    status(record) {
      return DIAPER_KIND[record.data.kind] || '';
    },

    tally(record, totals) {
      totals.diapers = (totals.diapers || 0) + 1;
      if (record.data.kind === 'wet' || record.data.kind === 'both') totals.wet = (totals.wet || 0) + 1;
      if (record.data.kind === 'dirty' || record.data.kind === 'both') totals.dirty = (totals.dirty || 0) + 1;
    },

    todayCell(totals) {
      return {
        label: 'Diapers',
        value: totals.diapers || 0,
        note: `${totals.wet || 0} wet · ${totals.dirty || 0} dirty`,
      };
    },
  };

  const sleep = {
    label: 'Sleep',
    noun: 'sleep',
    icon: '🌙',
    /** Spans time, so day totals count overlap rather than the start instant. */
    spansTime: true,
    fields: [
      { name: 'at', input: 'datetime', label: 'Fell asleep' },
      { name: 'end', input: 'datetime', label: 'Woke up', optional: true },
      { input: 'hint', text: 'Leave “woke up” empty while she is still asleep.' },
      { name: 'note', input: 'textarea', label: 'Note (optional)' },
    ],

    toValues(record) {
      return {
        at: record?.at ?? Date.now(),
        end: record?.end ?? null,
        note: record?.note ?? '',
      };
    },

    fromValues(v) {
      if (v.end != null && v.end < v.at) {
        return { error: 'Wake-up time is before the sleep started.' };
      }
      return { at: v.at, end: v.end, note: v.note, data: {} };
    },

    describe(record) {
      const live = record.end == null;
      return {
        title: live ? 'Sleeping' : 'Sleep',
        detail: live
          ? `since ${Fmt.clock(record.at)}`
          : `${Fmt.clock(record.at)} – ${Fmt.clock(record.end)} · ${Fmt.duration(record.end - record.at)}`,
      };
    },

    /* Shows how long the last sleep ran, not how long ago it was. */
    statusLabel: 'Last sleep',
    statusCompletedOnly: true,
    statusValue(record) { return Fmt.duration(record.end - record.at); },
    status(record) {
      return `ended ${Fmt.clock(record.end)}`;
    },

    tally(record, totals, { from, to }) {
      const end = record.end ?? Date.now();
      const overlap = Math.min(end, to) - Math.max(record.at, from);
      if (overlap > 0) {
        totals.sleepMs = (totals.sleepMs || 0) + overlap;
        totals.naps = (totals.naps || 0) + 1;
      }
    },

    todayCell(totals) {
      return {
        label: 'Sleep',
        value: Fmt.duration(totals.sleepMs || 0),
        note: `${totals.naps || 0} session${totals.naps === 1 ? '' : 's'}`,
      };
    },
  };

  const registry = { feed, diaper, sleep };

  /** The order features appear in quick-log buttons, filters and summaries. */
  const ORDER = ['feed', 'diaper', 'sleep'];

  return {
    get(type) { return registry[type] || null; },
    all() { return ORDER.map(type => ({ type, ...registry[type] })); },
    types() { return [...ORDER]; },
    has(type) { return type in registry; },
    icon(type) { return registry[type]?.icon || '•'; },
    FEED_METHOD, DIAPER_KIND,
  };
})();
