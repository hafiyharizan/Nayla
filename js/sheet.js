/* The bottom sheet for creating and editing records.
 *
 * It knows nothing about feeds or diapers — it renders whatever fields the
 * feature declares, hands the values back, and lets the feature build the
 * record. New features get an editor for free.
 */
const Sheet = (() => {
  const backdrop = document.getElementById('sheetBackdrop');
  const form = document.getElementById('entryForm');
  const fields = document.getElementById('sheetFields');
  const title = document.getElementById('sheetTitle');
  const deleteBtn = document.getElementById('deleteEntry');

  let ctx = null;   // { type, record, onSave, onDelete, onError }

  /* ── <input type="datetime-local"> plumbing ──────────────── */
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── rendering a declared field ──────────────────────────── */
  function label(field, settings) {
    if (field.unit === 'volume') return `${field.label} (${settings.units})`;
    return field.label;
  }

  function renderField(field, values, settings) {
    const value = values[field.name];

    if (field.input === 'hint') {
      return `<p class="hint">${escapeHtml(field.text)}</p>`;
    }

    if (field.input === 'segment') {
      const buttons = field.options.map(([v, l]) =>
        `<button type="button" data-seg="${field.name}" data-value="${v}"
                 class="${v === value ? 'is-on' : ''}">${escapeHtml(l)}</button>`).join('');
      return `<div class="seg">${buttons}</div>
              <input type="hidden" name="${field.name}" value="${escapeHtml(value ?? '')}">`;
    }

    if (field.input === 'datetime') {
      return `<label class="field"><span>${escapeHtml(label(field, settings))}</span>
        <input type="datetime-local" name="${field.name}"
               value="${value == null ? '' : toInput(value)}"></label>`;
    }

    if (field.input === 'number') {
      return `<label class="field"><span>${escapeHtml(label(field, settings))}</span>
        <input type="number" name="${field.name}" inputmode="decimal" min="0" step="any"
               placeholder="—" value="${escapeHtml(value ?? '')}"></label>`;
    }

    if (field.input === 'textarea') {
      return `<label class="field"><span>${escapeHtml(label(field, settings))}</span>
        <textarea name="${field.name}" rows="2"
                  placeholder="Anything worth remembering">${escapeHtml(value ?? '')}</textarea></label>`;
    }

    return `<label class="field"><span>${escapeHtml(label(field, settings))}</span>
      <input type="text" name="${field.name}" value="${escapeHtml(value ?? '')}"></label>`;
  }

  /** Consecutive fields marked `half` share a row. */
  function renderFields(spec, values, settings) {
    const out = [];
    for (let i = 0; i < spec.length; i++) {
      if (spec[i].half && spec[i + 1]?.half) {
        out.push(`<div class="row-2">${renderField(spec[i], values, settings)}` +
                 `${renderField(spec[i + 1], values, settings)}</div>`);
        i++;
      } else {
        out.push(renderField(spec[i], values, settings));
      }
    }
    return out.join('');
  }

  /* ── reading the form back ───────────────────────────────── */
  function collect(feature) {
    const data = new FormData(form);
    const values = {};
    for (const field of feature.fields) {
      if (!field.name) continue;
      const raw = data.get(field.name);
      values[field.name] = field.input === 'datetime'
        ? fromInput(raw)
        : (raw ?? '').toString().trim();
    }
    if (values.at == null) values.at = Date.now();
    return values;
  }

  /* ── open / close ────────────────────────────────────────── */
  function open(options) {
    ctx = options;
    const feature = Features.get(options.type);
    if (!feature) return;

    const settings = Store.settings();
    const values = feature.toValues(options.record, settings);

    title.textContent = `${options.record ? 'Edit' : 'Log'} ${feature.noun}`;
    fields.innerHTML = renderFields(feature.fields, values, settings);
    deleteBtn.hidden = !options.record;
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
    btn.parentElement.querySelectorAll('button')
      .forEach(b => b.classList.toggle('is-on', b === btn));
    form.elements[btn.dataset.seg].value = btn.dataset.value;
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!ctx) return;
    const feature = Features.get(ctx.type);
    const built = feature.fromValues(collect(feature), Store.settings());
    if (built.error) { ctx.onError?.(built.error); return; }
    ctx.onSave({ type: ctx.type, ...built }, ctx.record);
    close();
  });

  deleteBtn.addEventListener('click', () => {
    if (ctx?.record && confirm('Delete this entry?')) {
      ctx.onDelete(ctx.record);
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
