/* The bottom sheet used to create and edit entries. */
const Sheet = (() => {
  const backdrop = document.getElementById('sheetBackdrop');
  const form = document.getElementById('entryForm');
  const fields = document.getElementById('sheetFields');
  const title = document.getElementById('sheetTitle');
  const deleteBtn = document.getElementById('deleteEntry');

  let ctx = null;   // { type, entry, onSave, onDelete }

  /* ── local <input type="datetime-local"> plumbing ────────── */
  function toInput(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
           `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromInput(value) {
    if (!value) return null;
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  /* ── field builders ──────────────────────────────────────── */
  function segment(name, options, current) {
    const buttons = options.map(([value, label]) =>
      `<button type="button" data-seg="${name}" data-value="${value}"
               class="${value === current ? 'is-on' : ''}">${label}</button>`
    ).join('');
    return `<div class="seg" data-seg-group="${name}">${buttons}</div>
            <input type="hidden" name="${name}" value="${current}">`;
  }

  function timeField(name, label, ts) {
    return `<label class="field"><span>${label}</span>
      <input type="datetime-local" name="${name}" value="${ts == null ? '' : toInput(ts)}"></label>`;
  }

  function noteField(note) {
    return `<label class="field"><span>Note (optional)</span>
      <textarea name="note" rows="2" placeholder="Anything worth remembering">${escapeHtml(note || '')}</textarea></label>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── per-type forms ──────────────────────────────────────── */
  function render(type, entry) {
    const units = Store.settings().units;
    const now = Date.now();
    const start = entry ? entry.start : now;

    if (type === 'feed') {
      const method = entry?.method || 'bottle';
      const amountVal = entry?.amount != null ? Fmt.fromMl(entry.amount, units) : '';
      const mins = entry?.end ? Math.round((entry.end - entry.start) / Fmt.MIN) : '';
      return `
        ${segment('method', [['bottle', 'Bottle'], ['left', 'Left'], ['right', 'Right'], ['solids', 'Solids']], method)}
        <div class="row-2" style="margin-top:14px">
          <label class="field"><span>Amount (${units})</span>
            <input type="number" name="amount" inputmode="decimal" min="0" step="any"
                   placeholder="—" value="${amountVal}"></label>
          <label class="field"><span>Duration (min)</span>
            <input type="number" name="minutes" inputmode="numeric" min="0" step="1"
                   placeholder="—" value="${mins}"></label>
        </div>
        <p class="hint">Fill in whichever you track — both are optional.</p>
        ${timeField('start', 'Time', start)}
        ${noteField(entry?.note)}`;
    }

    if (type === 'diaper') {
      const kind = entry?.kind || 'wet';
      return `
        ${segment('kind', [['wet', 'Wet'], ['dirty', 'Dirty'], ['both', 'Both']], kind)}
        <div style="height:14px"></div>
        ${timeField('start', 'Time', start)}
        ${noteField(entry?.note)}`;
    }

    // sleep
    return `
      ${timeField('start', 'Fell asleep', start)}
      ${timeField('end', 'Woke up', entry?.end ?? null)}
      <p class="hint">Leave “woke up” empty while ${Store.settings().name || 'baby'} is still asleep.</p>
      ${noteField(entry?.note)}`;
  }

  /* ── read the form back into an entry patch ──────────────── */
  function collect(type) {
    const data = new FormData(form);
    const units = Store.settings().units;
    const start = fromInput(data.get('start')) ?? Date.now();
    const note = (data.get('note') || '').toString().trim();

    if (type === 'feed') {
      const minutes = Number(data.get('minutes'));
      return {
        type: 'feed',
        method: data.get('method') || 'bottle',
        amount: Fmt.toMl(data.get('amount'), units),
        start,
        end: Number.isFinite(minutes) && minutes > 0 ? start + minutes * Fmt.MIN : null,
        note,
      };
    }

    if (type === 'diaper') {
      return { type: 'diaper', kind: data.get('kind') || 'wet', start, end: null, note };
    }

    let end = fromInput(data.get('end'));
    if (end != null && end < start) return { error: 'Wake-up time is before the sleep started.' };
    return { type: 'sleep', start, end, note };
  }

  /* ── open / close ────────────────────────────────────────── */
  function open(options) {
    ctx = options;
    const { type, entry } = options;
    const verb = entry ? 'Edit' : 'Log';
    const nouns = { feed: 'feed', diaper: 'diaper change', sleep: 'sleep' };
    title.textContent = `${verb} ${nouns[type]}`;
    fields.innerHTML = render(type, entry);
    deleteBtn.hidden = !entry;
    backdrop.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function close() {
    backdrop.hidden = true;
    document.body.style.overflow = '';
    ctx = null;
  }

  /* ── wiring ──────────────────────────────────────────────── */
  fields.addEventListener('click', e => {
    const btn = e.target.closest('[data-seg]');
    if (!btn) return;
    const group = btn.parentElement;
    group.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b === btn));
    form.elements[btn.dataset.seg].value = btn.dataset.value;
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!ctx) return;
    const result = collect(ctx.type);
    if (result.error) { ctx.onError?.(result.error); return; }
    const saved = ctx.onSave(result, ctx.entry);
    if (saved !== false) close();
  });

  deleteBtn.addEventListener('click', () => {
    if (ctx?.entry && confirm('Delete this entry?')) {
      ctx.onDelete(ctx.entry);
      close();
    }
  });

  document.getElementById('sheetClose').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !backdrop.hidden) close();
  });

  return { open, close, isOpen: () => !backdrop.hidden };
})();
