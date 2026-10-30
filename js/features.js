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
 *   quick            gets a big tile under "Log something" (the everyday ones)
 *   dateOnly         a day, not a moment — lists show the date, not the clock
 *   onDelete         clean-up when an entry goes
 *   afterSave        optional message to show instead of plain "Saved"
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
    quick: true,
    /* "Solids" was a feed type before solids had a tracker of its own. Old
     * entries keep the label; the option only goes once the tracker is on. */
    fields(settings) {
      const methods = [['bottle', 'Bottle'], ['left', 'Left'], ['right', 'Right']];
      if (settings && settings.trackers?.solids === false) methods.push(['solids', 'Solids']);
      return [
        { name: 'method', input: 'segment', options: methods },
        { name: 'amount', input: 'number', label: 'Amount', unit: 'volume', half: true },
        { name: 'minutes', input: 'number', label: 'Duration (min)', half: true },
        { input: 'hint', text: 'Fill in whichever you track — both are optional.' },
        { name: 'at', input: 'datetime', label: 'Time' },
        { name: 'note', input: 'textarea', label: 'Note (optional)' },
      ];
    },

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
    quick: true,
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
    quick: true,
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

  /* ── solids ─────────────────────────────────────────────── */

  /* The common allergens, matched against what was typed. English plus the
   * Malay words most likely to be typed for the same foods. Matching is
   * deliberately loose — a false "contains egg" costs a glance; a missed one
   * costs more. */
  const ALLERGENS = [
    ['egg', /\begg|telur/],
    ['peanut', /peanut|kacang tanah/],
    ['tree nuts', /almond|cashew|walnut|hazelnut|pistachio|pecan|macadamia|brazil nut/],
    ['dairy', /(?<!breast )milk|yog(h)?urt|cheese|butter(?!nut)|dairy|custard|keju|susu lembu/],
    ['wheat', /wheat|bread|pasta|spaghetti|roti|couscous|semolina|biscuit|cracker|gandum/],
    ['soy', /\bsoy|soya|tofu|tempeh|edamame|tauhu/],
    ['fish', /fish|salmon|tuna|\bcod\b|mackerel|sardine|anchov|ikan|bilis/],
    ['shellfish', /shrimp|prawn|crab|lobster|scallop|mussel|clam|oyster|squid|udang|ketam|kerang|sotong/],
    ['sesame', /sesame|tahini|bijan/],
  ];

  const AMOUNT = { taste: 'A taste', some: 'Some', most: 'Most', all: 'All of it' };
  const REACTION = { loved: 'Loved it', ok: 'Okay', refused: 'Refused' };

  const Foods = {
    ALLERGENS: ALLERGENS.map(([name]) => name),

    /** "  Sweet  Potato " -> "sweet potato": one food, however it was typed. */
    key(name) { return String(name).trim().toLowerCase().replace(/\s+/g, ' '); },
    label(key) { return key.charAt(0).toUpperCase() + key.slice(1); },

    allergen(key) {
      const hit = ALLERGENS.find(([, re]) => re.test(key));
      return hit ? hit[0] : null;
    },

    /** Every food she has had, with when, how often, and how it went. */
    tried() {
      const map = new Map();
      // Oldest first, so "first" and "last" fall out of the walk.
      for (const r of [...Store.byType('solids')].reverse()) {
        for (const key of r.data.foods || []) {
          const f = map.get(key) || { key, first: r.at, times: 0, flagged: false };
          f.times++;
          f.last = r.at;
          if (r.data.reaction) f.reaction = r.data.reaction;
          if (r.data.signs) f.flagged = true;
          map.set(key, f);
        }
      }
      return [...map.values()].map(f => ({ ...f, allergen: Foods.allergen(f.key) }));
    },

    /** Foods in this entry that no earlier entry has. Two meals in the same
     *  minute are ordered by id, which is creation time. */
    newIn(record) {
      const before = new Set();
      for (const r of Store.byType('solids')) {
        const earlier = r.at < record.at || (r.at === record.at && r.id < record.id);
        if (r.id !== record.id && earlier) (r.data.foods || []).forEach(k => before.add(k));
      }
      return (record.data.foods || []).filter(k => !before.has(k));
    },
  };

  const solids = {
    label: 'Solids',
    noun: 'meal',
    icon: '🥣',
    quick: true,
    fields: [
      { name: 'foods', input: 'tags', label: 'What did she eat?',
        placeholder: 'Add a food — e.g. pumpkin',
        suggest: () => Foods.tried()
          .sort((a, b) => b.last - a.last)
          .slice(0, 16)
          .map(f => ({ value: f.key, label: Foods.label(f.key) })) },
      { name: 'amount', input: 'segment', label: 'How much', optional: true,
        options: [['taste', 'A taste'], ['some', 'Some'], ['most', 'Most'], ['all', 'All']] },
      { name: 'reaction', input: 'segment', label: 'How did it go', optional: true,
        options: [['loved', 'Loved it'], ['ok', 'Okay'], ['refused', 'Refused']] },
      { name: 'signs', input: 'toggle', label: 'Signs of a reaction',
        detail: 'Rash, hives, swelling, vomiting — anything unusual afterwards.' },
      { name: 'at', input: 'datetime', label: 'Time' },
      { name: 'note', input: 'textarea', label: 'Note (optional)' },
    ],

    toValues(record) {
      return {
        foods: record?.data.foods ?? [],
        amount: record?.data.amount ?? '',
        reaction: record?.data.reaction ?? '',
        signs: Boolean(record?.data.signs),
        at: record?.at ?? Date.now(),
        note: record?.note ?? '',
      };
    },

    fromValues(v) {
      const foods = [...new Set((v.foods || []).map(Foods.key).filter(Boolean))];
      if (!foods.length) return { error: 'Add at least one food.' };
      const data = { foods };
      if (AMOUNT[v.amount]) data.amount = v.amount;
      if (REACTION[v.reaction]) data.reaction = v.reaction;
      if (v.signs) data.signs = true;
      return { at: v.at, end: null, note: v.note, data };
    },

    describe(record) {
      const foods = (record.data.foods || []).map(Foods.label);
      const fresh = Foods.newIn(record);
      const bits = [AMOUNT[record.data.amount], REACTION[record.data.reaction]];
      if (fresh.length) bits.push(`first ${fresh.map(Foods.label).join(', ').toLowerCase()}`);
      if (record.data.signs) bits.push('⚠ reaction');
      return { title: foods.join(', ') || 'Solids', detail: bits.filter(Boolean).join(' · ') };
    },

    /* A new allergen is the one moment worth more than "Saved". */
    afterSave(record, settings) {
      const allergens = Foods.newIn(record).map(Foods.allergen).filter(Boolean);
      if (!allergens.length) return null;
      const name = settings.name || 'her';
      return `First time with ${[...new Set(allergens)].join(' and ')} — keep an eye on ${name} for the next couple of hours.`;
    },

    tally(record, totals) {
      totals.meals = (totals.meals || 0) + 1;
      totals.foods = totals.foods || new Set();
      (record.data.foods || []).forEach(k => totals.foods.add(k));
    },

    todayCell(totals) {
      const n = totals.foods?.size || 0;
      return {
        label: 'Solids',
        value: totals.meals || 0,
        note: n ? `${n} food${n === 1 ? '' : 's'}` : 'none yet',
      };
    },
  };

  /* ── growth ─────────────────────────────────────────────── */

  /* Plausible for birth to about three years. Outside this it is almost
   * always a typo or the wrong units, and a wild point wrecks the chart. */
  const SANE = { weight: [0.8, 25], length: [35, 110], head: [25, 55] };

  const growth = {
    label: 'Growth',
    noun: 'measurement',
    icon: '📏',
    dateOnly: true,
    fields: [
      { name: 'weight', input: 'number', label: 'Weight', unit: 'weight', half: true },
      { name: 'length', input: 'number', label: 'Length', unit: 'length', half: true },
      { name: 'head', input: 'number', label: 'Head', unit: 'length', half: true },
      { name: 'at', input: 'date', label: 'Measured on', half: true },
      { input: 'hint', text: 'Fill in whichever were measured — the clinic book usually has all three.' },
      { name: 'note', input: 'textarea', label: 'Note (optional)' },
    ],

    toValues(record, settings) {
      const u = settings.growthUnits;
      return {
        weight: Fmt.fromKg(record?.data.weight, u),
        length: Fmt.fromCm(record?.data.length, u),
        head: Fmt.fromCm(record?.data.head, u),
        at: record?.at ?? Date.now(),
        note: record?.note ?? '',
      };
    },

    fromValues(v, settings) {
      const u = settings.growthUnits;
      const data = {};
      const weight = Fmt.toKg(v.weight, u), length = Fmt.toCm(v.length, u), head = Fmt.toCm(v.head, u);
      if (weight != null) data.weight = Math.round(weight * 1000) / 1000;
      if (length != null) data.length = Math.round(length * 10) / 10;
      if (head != null) data.head = Math.round(head * 10) / 10;
      if (!Object.keys(data).length) return { error: 'Fill in at least one measurement.' };

      const unitOf = { weight: u === 'imperial' ? 'lb' : 'kg', length: u === 'imperial' ? 'in' : 'cm' };
      for (const [k, [lo, hi]] of Object.entries(SANE)) {
        if (data[k] != null && (data[k] < lo || data[k] > hi)) {
          return { error: `That ${k} looks off — is it in ${k === 'weight' ? unitOf.weight : unitOf.length}?` };
        }
      }
      return { at: v.at, end: null, note: v.note, data };
    },

    describe(record, settings) {
      const u = settings.growthUnits;
      const bits = [];
      if (record.data.weight != null) bits.push(Fmt.weight(record.data.weight, u));
      if (record.data.length != null) bits.push(Fmt.length(record.data.length, u));
      if (record.data.head != null) bits.push(`head ${Fmt.length(record.data.head, u)}`);
      return { title: 'Measured', detail: bits.join(' · ') };
    },
  };

  /* ── milestones ─────────────────────────────────────────── */

  /* Roughly in the order they tend to happen, so the next likely ones sit
   * first once the earlier ones are logged. */
  const MILESTONE_IDEAS = [
    'First smile', 'First laugh', 'Held head up', 'Rolled over', 'Reached for a toy',
    'First solid food', 'Sat up', 'First tooth', 'Crawled', 'Waved bye-bye',
    'Pulled up to stand', 'First word', 'First steps', 'First haircut',
  ];

  const milestone = {
    label: 'Milestone',
    noun: 'milestone',
    icon: '⭐',
    dateOnly: true,
    fields: [
      { name: 'title', input: 'text', label: 'What happened', placeholder: 'e.g. First smile',
        suggest: () => {
          const done = new Set(Store.byType('milestone').map(r => r.data.title?.toLowerCase()));
          return MILESTONE_IDEAS.filter(t => !done.has(t.toLowerCase())).slice(0, 6);
        } },
      { name: 'at', input: 'date', label: 'When' },
      { name: 'photo', input: 'photo', label: 'Photo (optional)' },
      /* Off unless chosen: a photo stays on this phone by default. */
      { name: 'sharePhoto', input: 'toggle', label: 'Share photo with the other phone',
        state() {
          const can = Photos.canShare();
          if (can === 'unpaired') return { disabled: true,
            detail: 'Pair a phone first (Settings → Sync). Until then photos stay on this phone.' };
          if (can === 'no-key') return { disabled: true,
            detail: 'One-time step: on this phone open Settings → Sync → Add another phone, and scan it with the other phone.' };
          return { detail: 'Encrypted on this phone first — only your paired phones can open it, not the server.' };
        } },
      { name: 'note', input: 'textarea', label: 'Note (optional)' },
    ],

    toValues(record) {
      return {
        title: record?.data.title ?? '',
        at: record?.at ?? Date.now(),
        photo: record?.data.photo ?? null,
        sharePhoto: record?.data.photoShared === true,
        note: record?.note ?? '',
      };
    },

    fromValues(v) {
      const title = (v.title || '').trim();
      if (!title) return { error: 'Say what happened — "First smile", say.' };
      const data = { title };
      const photo = v.photo || {};
      if (photo.dataUrl) data.photo = Photos.add(photo.dataUrl);
      else if (photo.keep) data.photo = photo.keep;
      // A replaced or removed photo is swept up by Photos.sync — nothing
      // points at it any more.
      if (data.photo && v.sharePhoto) data.photoShared = true;
      return { at: v.at, end: null, note: v.note, data };
    },

    describe(record, settings) {
      const age = Fmt.ageAt(settings.dob, record.at);
      const photo = record.data.photo && (record.data.photoShared ? 'shared photo' : 'photo');
      const bits = [age && `at ${age}`, photo].filter(Boolean);
      return { title: record.data.title || 'Milestone', detail: bits.join(' · ') };
    },
  };

  const registry = { feed, diaper, sleep, solids, growth, milestone };

  /** The order features appear in quick-log buttons, filters and summaries. */
  const ORDER = ['feed', 'diaper', 'sleep', 'solids', 'growth', 'milestone'];

  return {
    get(type) { return registry[type] || null; },
    all() { return ORDER.map(type => ({ type, ...registry[type] })); },
    types() { return [...ORDER]; },
    has(type) { return type in registry; },
    icon(type) { return registry[type]?.icon || '•'; },
    /** A feature's form, which may depend on settings. */
    fields(type, settings) {
      const f = registry[type]?.fields;
      return typeof f === 'function' ? f(settings) : f || [];
    },
    FEED_METHOD, DIAPER_KIND, Foods, MILESTONE_IDEAS,
  };
})();
