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

  /* A date-only entry is stored at local noon, so a phone in a slightly
   * different time zone still files it under the same day. */
  function toDateInput(ts) {
    return toInput(ts).slice(0, 10);
  }

  function fromDateInput(value) {
    if (!value) return null;
    const ts = new Date(`${value}T12:00`).getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── rendering a declared field ──────────────────────────── */
  function label(field, settings) {
    const imperial = settings.growthUnits === 'imperial';
    if (field.unit === 'volume') return `${field.label} (${settings.units})`;
    if (field.unit === 'weight') return `${field.label} (${imperial ? 'lb' : 'kg'})`;
    if (field.unit === 'length') return `${field.label} (${imperial ? 'in' : 'cm'})`;
    return field.label;
  }

  /* A photo picked in this sheet, waiting for Save. Kept out of the form
   * because a data URL is far too big to round-trip through an input. */
  let pendingPhoto = null;
  let photoBusy = false;

  function renderField(field, values, settings) {
    const value = values[field.name];

    if (field.input === 'hint') {
      return `<p class="hint">${escapeHtml(field.text)}</p>`;
    }

    if (field.input === 'segment') {
      const buttons = field.options.map(([v, l]) =>
        `<button type="button" data-seg="${field.name}" data-value="${v}"
                 ${field.optional ? 'data-optional' : ''}
                 class="${v === value ? 'is-on' : ''}">${escapeHtml(l)}</button>`).join('');
      const heading = field.label
        ? `<span class="seg-label">${escapeHtml(field.label)}${field.optional ? ' <em>(optional)</em>' : ''}</span>` : '';
      return `${heading}<div class="seg">${buttons}</div>
              <input type="hidden" name="${field.name}" value="${escapeHtml(value ?? '')}">`;
    }

    if (field.input === 'date') {
      return `<label class="field"><span>${escapeHtml(label(field, settings))}</span>
        <input type="date" name="${field.name}"
               value="${value == null ? '' : toDateInput(value)}"></label>`;
    }

    if (field.input === 'toggle') {
      // A toggle can depend on the moment — sharing needs a paired phone.
      const st = field.state?.(settings) || {};
      const detail = st.detail ?? field.detail;
      return `<label class="toggle-field ${st.disabled ? 'is-disabled' : ''}">
        <span><b>${escapeHtml(field.label)}</b>${detail ? `<em>${escapeHtml(detail)}</em>` : ''}</span>
        <input type="checkbox" class="switch" name="${field.name}"
               ${value && !st.disabled ? 'checked' : ''} ${st.disabled ? 'disabled' : ''}></label>`;
    }

    /* Chips for what she has had before, plus a box for anything new. */
    if (field.input === 'tags') {
      const chosen = new Set(value || []);
      const known = field.suggest?.() || [];
      const all = [...known];
      for (const v of chosen) if (!all.some(k => k.value === v)) all.unshift({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) });
      const chips = all.map(k =>
        `<button type="button" class="tag ${chosen.has(k.value) ? 'is-on' : ''}"
                 data-tag="${escapeHtml(k.value)}">${escapeHtml(k.label)}</button>`).join('');
      return `<div class="field" data-tags="${field.name}"><span>${escapeHtml(field.label)}</span>
        <div class="tags">${chips}</div>
        <div class="tag-add">
          <input type="text" data-tag-input enterkeyhint="done" autocomplete="off"
                 placeholder="${escapeHtml(field.placeholder || 'Add')}">
          <button type="button" class="btn" data-tag-add>Add</button>
        </div></div>`;
    }

    if (field.input === 'photo') {
      return `<div class="field photo-field" data-photo-field="${field.name}">
        <span>${escapeHtml(field.label)}</span>
        <div class="photo-box" data-photo-wrap>
          <img class="photo-preview" alt="" ${value
            ? `data-photo="${escapeHtml(value)}" data-shared="${values.sharePhoto ? 'true' : 'false'}"` : 'hidden'}>
          <p class="photo-elsewhere">The photo is on the other phone — it hasn't been shared to this one.</p>
          <div class="photo-actions">
            <label class="btn photo-pick"><span data-photo-pick-label>${value ? 'Change photo' : 'Add a photo'}</span>
              <input type="file" accept="image/*" data-photo-input hidden></label>
            ${Photos.sendable()
              ? `<button type="button" class="btn" data-photo-send ${value ? '' : 'hidden'}>Send…</button>` : ''}
            <button type="button" class="btn btn-ghost" data-photo-remove ${value ? '' : 'hidden'}>Remove</button>
          </div>
        </div>
        <input type="hidden" name="${field.name}" value="${escapeHtml(value ?? '')}"
               data-original="${escapeHtml(value ?? '')}">
      </div>`;
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

    // Plain text, with optional one-tap suggestions underneath.
    const ideas = field.suggest?.() || [];
    const chips = ideas.length
      ? `<div class="tags tags-suggest">${ideas.map(t =>
          `<button type="button" class="tag" data-fill="${field.name}">${escapeHtml(t)}</button>`).join('')}</div>`
      : '';
    return `<label class="field"><span>${escapeHtml(label(field, settings))}</span>
      <input type="text" name="${field.name}" value="${escapeHtml(value ?? '')}"
             placeholder="${escapeHtml(field.placeholder || '')}" autocomplete="off"></label>${chips}`;
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
  function collect(spec) {
    const data = new FormData(form);
    const values = {};
    for (const field of spec) {
      if (!field.name) continue;
      const raw = data.get(field.name);
      if (field.input === 'datetime') values[field.name] = fromInput(raw);
      else if (field.input === 'date') values[field.name] = fromDateInput(raw);
      else if (field.input === 'toggle') values[field.name] = raw != null;
      else if (field.input === 'tags') values[field.name] = readTags(field.name);
      else if (field.input === 'photo') {
        const el = form.elements[field.name];
        values[field.name] = {
          keep: el.value && el.value !== 'new' ? el.value : null,
          dataUrl: el.value === 'new' ? pendingPhoto : null,
          original: el.dataset.original || null,
        };
      } else values[field.name] = (raw ?? '').toString().trim();
    }
    if (values.at == null) values.at = Date.now();
    return values;
  }

  /** Selected chips, plus whatever is still sitting in the box unadded. */
  function readTags(name) {
    const box = fields.querySelector(`[data-tags="${name}"]`);
    const picked = [...box.querySelectorAll('.tag.is-on')].map(b => b.dataset.tag);
    const typed = box.querySelector('[data-tag-input]').value.split(',').map(t => t.trim()).filter(Boolean);
    return [...picked, ...typed];
  }

  function addTypedTags(box) {
    const input = box.querySelector('[data-tag-input]');
    const tags = box.querySelector('.tags');
    for (const raw of input.value.split(',')) {
      const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!key) continue;
      let chip = [...tags.querySelectorAll('.tag')].find(b => b.dataset.tag === key);
      if (!chip) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tag';
        chip.dataset.tag = key;
        chip.textContent = key.charAt(0).toUpperCase() + key.slice(1);
        tags.prepend(chip);
      }
      chip.classList.add('is-on');
    }
    input.value = '';
    input.focus();
  }

  /* ── open / close ────────────────────────────────────────── */
  function open(options) {
    ctx = options;
    const feature = Features.get(options.type);
    if (!feature) return;

    const settings = Store.settings();
    const values = feature.toValues(options.record, settings);

    title.textContent = `${options.record ? 'Edit' : 'Log'} ${feature.noun}`;
    pendingPhoto = null;
    photoBusy = false;
    fields.innerHTML = renderFields(Features.fields(options.type, settings), values, settings);
    fields.querySelectorAll('img[data-photo]').forEach(img =>
      Photos.show(img, img.dataset.photo, { shared: img.dataset.shared === 'true' }));
    deleteBtn.hidden = !options.record;
    backdrop.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function close() {
    backdrop.hidden = true;
    document.body.style.overflow = '';
    ctx = null;
    pendingPhoto = null;
  }

  /* ── wiring ──────────────────────────────────────────────── */
  fields.addEventListener('click', e => {
    const tag = e.target.closest('.tag[data-tag]');
    if (tag) { tag.classList.toggle('is-on'); return; }

    const fill = e.target.closest('[data-fill]');
    if (fill) { form.elements[fill.dataset.fill].value = fill.textContent; return; }

    const add = e.target.closest('[data-tag-add]');
    if (add) { addTypedTags(add.closest('[data-tags]')); return; }

    const remove = e.target.closest('[data-photo-remove]');
    if (remove) {
      const box = remove.closest('[data-photo-field]');
      pendingPhoto = null;
      box.querySelector('input[type="hidden"]').value = '';
      box.querySelector('.photo-preview').hidden = true;
      box.querySelector('[data-photo-wrap]').classList.remove('is-missing');
      box.querySelector('[data-photo-pick-label]').textContent = 'Add a photo';
      remove.hidden = true;
      const send = box.querySelector('[data-photo-send]');
      if (send) send.hidden = true;
      return;
    }

    // Straight to WhatsApp, AirDrop and the like — never through our server.
    const send = e.target.closest('[data-photo-send]');
    if (send) {
      const box = send.closest('[data-photo-field]');
      const preview = box.querySelector('.photo-preview');
      const url = pendingPhoto || (!preview.hidden && preview.src);
      if (url) Photos.send(url, form.elements.title?.value || 'Milestone');
      else ctx?.onError?.('That photo is on the other phone.');
      return;
    }

    const btn = e.target.closest('[data-seg]');
    if (!btn) return;
    // An optional choice can be tapped again to clear it.
    const clearing = btn.hasAttribute('data-optional') && btn.classList.contains('is-on');
    btn.parentElement.querySelectorAll('button')
      .forEach(b => b.classList.toggle('is-on', b === btn && !clearing));
    form.elements[btn.dataset.seg].value = clearing ? '' : btn.dataset.value;
  });

  // Enter in the "add a food" box adds it, rather than submitting the sheet.
  fields.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('[data-tag-input]')) {
      e.preventDefault();
      addTypedTags(e.target.closest('[data-tags]'));
    }
  });

  fields.addEventListener('change', async e => {
    if (!e.target.matches('[data-photo-input]')) return;
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const box = e.target.closest('[data-photo-field]');
    const preview = box.querySelector('.photo-preview');
    photoBusy = true;
    box.classList.add('is-busy');
    try {
      pendingPhoto = await Photos.fromFile(file);
      preview.src = pendingPhoto;
      preview.hidden = false;
      box.querySelector('input[type="hidden"]').value = 'new';
      box.querySelector('[data-photo-pick-label]').textContent = 'Change photo';
      box.querySelector('[data-photo-remove]').hidden = false;
      box.querySelector('[data-photo-wrap]').classList.remove('is-missing');
      const send = box.querySelector('[data-photo-send]');
      if (send) send.hidden = false;
    } catch (err) {
      console.warn(err);
      ctx?.onError?.("Couldn't read that photo — try another one.");
    } finally {
      photoBusy = false;
      box.classList.remove('is-busy');
    }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!ctx) return;
    if (photoBusy) { ctx.onError?.('Still getting the photo ready…'); return; }
    const feature = Features.get(ctx.type);
    const spec = Features.fields(ctx.type, Store.settings());
    const built = feature.fromValues(collect(spec), Store.settings());
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
