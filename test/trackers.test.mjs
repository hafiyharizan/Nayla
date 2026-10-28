/* Solids, growth, milestones, and turning trackers on and off.
 *
 * Drives real Chromium pages against a static server plus a mock of the
 * sync functions and the photo functions from 0003_photos.sql. The photo
 * functions can be switched off, to check a server without that migration
 * keeps photos on the phone rather than breaking anything.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4195;
const T = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript',
  '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };

const rows = new Map();
const photos = new Map();        // `${code}\0${id}` -> data URL
let rev = 0;
let photoFunctions = true;       // false = the 0003 migration isn't applied

function assertCode(c) { if (!c || c.length < 24) throw new Error('invalid pairing code'); }

const rpc = {
  nayla_sync_push({ p_code, p_rows }) {
    assertCode(p_code);
    let max = 0;
    for (const r of p_rows) { max = ++rev; rows.set(`${p_code}\0${r.id}`, { ...r, household: p_code, rev: max, updated_at: Date.now() }); }
    return max;
  },
  nayla_sync_pull({ p_code, p_since }) {
    assertCode(p_code);
    return [...rows.values()].filter(r => r.household === p_code && r.rev > (p_since || 0))
      .sort((a, b) => a.rev - b.rev).map(({ household, ...r }) => r);
  },
  nayla_photo_put({ p_code, p_id, p_data }) {
    assertCode(p_code);
    if (p_data == null) photos.delete(`${p_code}\0${p_id}`);
    else {
      if (!String(p_data).startsWith('data:image/')) throw new Error('not an image');
      photos.set(`${p_code}\0${p_id}`, p_data);
    }
    return null;
  },
  nayla_photo_get({ p_code, p_id }) {
    assertCode(p_code);
    return photos.get(`${p_code}\0${p_id}`) ?? null;
  },
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && path.startsWith('/rest/v1/rpc/')) {
    const body = JSON.parse(await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b || '{}')); }));
    const fn = path.split('/').pop();
    if (!rpc[fn] || (!photoFunctions && fn.startsWith('nayla_photo_'))) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'PGRST202', message: `Could not find the function public.${fn}` }));
      return;
    }
    try {
      const out = rpc[fn](body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: err.message }));
    }
    return;
  }
  if (path === '/js/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(`const Config = { url: 'http://localhost:${PORT}', anonKey: '' };`);
    return;
  }
  try {
    const file = join(ROOT, normalize(path === '/' ? '/index.html' : path));
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': T[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const fails = [], errs = [];
const ok = (name, cond, extra = '') => {
  if (!cond) fails.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
};

async function phone(label, settings = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kuala_Lumpur' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(`${label}: ${e.message}`));
  p.on('console', m => {
    // 404s are the "migration not applied" case, provoked on purpose.
    if (m.type() === 'error' && !/status of 404/.test(m.text())) errs.push(`${label}: ${m.text()}`);
  });
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.evaluate(s => {
    localStorage.clear();
    localStorage.setItem('nayla.settings.v1', JSON.stringify({ name: 'Nayla', dob: '2026-06-04', ...s }));
  }, settings);
  await p.reload();
  await p.waitForTimeout(250);
  return { ctx, p };
}

const tab = (p, name) => p.click(`.tab[data-tab="${name}"]`);
const visible = (p, sel) => p.locator(sel).isVisible();
const toastText = p => p.locator('#toast').textContent();

/* A small but real JPEG-able image, made by the browser itself. */
async function pngBuffer(p, color) {
  const b64 = await p.evaluate(c => {
    const cv = document.createElement('canvas'); cv.width = 400; cv.height = 300;
    const g = cv.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 400, 300);
    return cv.toDataURL('image/png').split(',')[1];
  }, color);
  return Buffer.from(b64, 'base64');
}

/* ── 1. trackers on and off ───────────────────────────────── */
{
  const { ctx, p } = await phone('toggles');
  ok('all six trackers are on by default',
    (await p.evaluate(() => Features.types().every(t => Store.trackerOn(t)))));
  ok('four quick-log tiles (feed, diaper, sleep, solids)',
    (await p.locator('#quickGrid .quick').count()) === 4);
  ok('Growing tab shows', await visible(p, '.tab[data-tab="growing"]'));

  // Log a meal, then hide solids: the entry stays, but the tracker goes.
  await p.evaluate(() => Store.add({ type: 'solids', at: Date.now(), data: { foods: ['banana'] } }));
  await tab(p, 'settings');
  await p.locator('[data-tracker="solids"]').uncheck();
  await tab(p, 'now');
  ok('solids tile hidden when off', (await p.locator('.quick-solids').count()) === 0);
  ok('solids hidden from Today', !(await p.locator('#todaySummary').textContent()).includes('Solids'));
  ok('solids entry hidden from Recent', !(await p.locator('#recentList').textContent()).includes('Banana'));
  ok('…but the entry is kept', (await p.evaluate(() => Store.byType('solids').length)) === 1);

  await p.click('[data-log="feed"]');
  ok('feed offers "Solids" again while the solids tracker is off',
    (await p.locator('#sheetFields [data-value="solids"]').count()) === 1);
  await p.click('#sheetClose');

  await tab(p, 'history');
  ok('no Solids filter in History', (await p.locator('#historyFilters [data-filter="solids"]').count()) === 0);

  // Turning sleep off takes the wake ring with it.
  await tab(p, 'settings');
  await p.locator('[data-tracker="sleep"]').uncheck();
  await tab(p, 'now');
  ok('wake card hidden when sleep is off', !(await visible(p, '#wakeCard')));
  ok('status row narrows to what is left',
    (await p.locator('#statusRow .stat').count()) === 2);

  // All three slow trackers off: the Growing tab goes.
  await tab(p, 'settings');
  for (const t of ['growth', 'milestone']) await p.locator(`[data-tracker="${t}"]`).uncheck();
  ok('Growing tab hidden with growth, milestones and solids off', !(await visible(p, '.tab[data-tab="growing"]')));

  // Can't switch everything off.
  await p.locator('[data-tracker="feed"]').uncheck();
  await p.locator('[data-tracker="diaper"]').click();   // refused, so not uncheck()
  ok('the last tracker refuses to turn off',
    await p.locator('[data-tracker="diaper"]').isChecked() &&
    /at least one/.test(await toastText(p)));

  // And back on: the entry reappears.
  await p.locator('[data-tracker="solids"]').check();
  await tab(p, 'now');
  ok('turning it back on brings the entry back', (await p.locator('#recentList').textContent()).includes('Banana'));
  await ctx.close();
}

/* ── 2. solids ────────────────────────────────────────────── */
{
  const { ctx, p } = await phone('solids');
  await p.click('[data-log="solids"]');
  await p.click('#sheetFields button[type="submit"], .sheet-actions button[type="submit"]');
  ok('a meal needs a food', /at least one food/.test(await toastText(p)));

  await p.fill('[data-tag-input]', 'Sweet  Potato');
  await p.press('[data-tag-input]', 'Enter');
  ok('Enter adds the food as a chip instead of saving',
    await visible(p, '#sheetBackdrop') &&
    (await p.locator('.tag.is-on').textContent()) === 'Sweet potato');
  await p.click('[data-seg="amount"][data-value="most"]');
  await p.click('[data-seg="reaction"][data-value="loved"]');
  await p.click('[data-seg="reaction"][data-value="loved"]');   // tap again to clear
  await p.click('.sheet-actions button[type="submit"]');
  const first = await p.evaluate(() => Store.byType('solids')[0]);
  ok('meal saved with a normalised food', JSON.stringify(first.data.foods) === '["sweet potato"]');
  ok('optional choice cleared by a second tap', first.data.amount === 'most' && first.data.reaction == null);

  // Second meal: the old food is a one-tap chip, and egg is new.
  await p.waitForTimeout(100);
  await p.click('[data-log="solids"]');
  ok('known foods offered as chips', (await p.locator('.tag[data-tag="sweet potato"]').count()) === 1);
  await p.click('.tag[data-tag="sweet potato"]');
  await p.fill('[data-tag-input]', 'egg yolk');            // typed but not "Add"ed still counts
  await p.click('.sheet-actions button[type="submit"]');
  ok('a first allergen gets a heads-up', /First time with egg/.test(await toastText(p)), await toastText(p));
  const second = await p.evaluate(() => {
    const r = Store.byType('solids').find(x => x.data.foods.length === 2);
    return { foods: r.data.foods, detail: Features.get('solids').describe(r, Store.settings()).detail };
  });
  ok('unadded typed food is kept', second.foods.includes('egg yolk') && second.foods.includes('sweet potato'));
  ok('only the new food is called "first"', /first egg yolk/.test(second.detail) && !/sweet/.test(second.detail));

  await tab(p, 'growing');
  ok('foods tried lists both', (await p.locator('.f-row').count()) === 2);
  ok('egg ticked off the allergen list',
    (await p.locator('.a-chip.is-done').textContent()).includes('Egg'));
  await ctx.close();
}

/* ── 3. growth ────────────────────────────────────────────── */
{
  const { ctx, p } = await phone('growth');
  await tab(p, 'growing');
  ok('empty growth section invites the first measurement',
    (await p.locator('.grow-section').first().textContent()).includes('clinic'));

  await p.click('[data-log="growth"]');
  await p.fill('input[name="weight"]', '65');
  await p.fill('input[name="at"]', '2026-10-01');
  await p.click('.sheet-actions button[type="submit"]');
  ok('an implausible weight is refused', /looks off/.test(await toastText(p)));

  await p.fill('input[name="weight"]', '6.4');
  await p.fill('input[name="length"]', '62');
  await p.click('.sheet-actions button[type="submit"]');
  const g = await p.evaluate(() => Store.byType('growth')[0]);
  ok('measurement saved in kg / cm', g.data.weight === 6.4 && g.data.length === 62 && g.data.head == null);
  ok('date-only entry stored at local noon', await p.evaluate(at => new Date(at).getHours() === 12, g.at));

  const expected = await p.evaluate(() =>
    Who.describe(Who.percentile('girl', 'weight', Who.ageInMonths('2026-06-04', new Date('2026-10-01T12:00').getTime()), 6.4)));
  const tile = await p.locator('.g-tile[data-indicator="weight"] .g-note').textContent();
  ok('weight tile shows the WHO percentile', tile === expected, `${tile} vs ${expected}`);
  ok('chart drawn with her point', (await p.locator('.g-chart .c-dot').count()) === 1);

  await p.click('.g-tile[data-indicator="length"]');
  ok('tapping a tile switches the chart', (await p.locator('.chart-title').textContent()).includes('Length'));

  // Boys' chart gives a different answer for the same girl's numbers.
  await p.evaluate(() => Store.saveSettings({ sex: 'boy' }));
  await p.waitForTimeout(50);
  const boyNote = await p.locator('.g-tile[data-indicator="weight"] .g-note').textContent();
  ok('sex setting changes the chart used', boyNote !== tile, boyNote);

  // Imperial: type pounds, stored as kg, shown as lb + oz.
  await p.evaluate(() => Store.saveSettings({ sex: 'girl', growthUnits: 'imperial' }));
  await p.click('[data-log="growth"]');
  ok('weight label switches to lb', (await p.locator('#sheetFields').textContent()).includes('Weight (lb)'));
  await p.fill('input[name="weight"]', '15');
  await p.click('.sheet-actions button[type="submit"]');
  const lb = await p.evaluate(() => Store.byType('growth')[0].data.weight);
  ok('pounds converted to kg', Math.abs(lb - 6.804) < 0.001, String(lb));
  ok('shown back as lb and oz',
    (await p.locator('.g-tile[data-indicator="weight"] .g-value').textContent()) === '15 lb 0 oz');
  await ctx.close();
}

/* ── 4. milestones and photos between two phones ──────────── */
{
  const code = 'c'.repeat(32);
  const dad = await phone('dad', { syncCode: code });
  const mum = await phone('mum', { syncCode: code });

  await tab(dad.p, 'growing');
  await dad.p.click('[data-log="milestone"]');
  await dad.p.click('.tag[data-fill="title"] >> text=First laugh');
  ok('suggestion fills the title', (await dad.p.inputValue('input[name="title"]')) === 'First laugh');
  await dad.p.setInputFiles('[data-photo-input]', { name: 'laugh.png', mimeType: 'image/png', buffer: await pngBuffer(dad.p, '#e07a5f') });
  await dad.p.waitForSelector('.photo-preview:not([hidden])');
  await dad.p.click('.sheet-actions button[type="submit"]');
  await dad.p.waitForTimeout(300);

  const m = await dad.p.evaluate(() => Store.byType('milestone')[0]);
  ok('milestone saved with a photo id, not the image', /^p[0-9a-f]{16}$/.test(m.data.photo) &&
    JSON.stringify(m).length < 500);
  ok('photo shrunk to a JPEG', await dad.p.evaluate(id => Photos.get(id).then(u => u.startsWith('data:image/jpeg')), m.data.photo));
  ok('first-laugh suggestion gone once logged',
    await dad.p.evaluate(() => !Features.get('milestone').fields[0].suggest().includes('First laugh')));

  await dad.p.evaluate(() => Sync.run());
  await dad.p.waitForTimeout(500);
  ok('photo uploaded to the server', photos.has(`${code}\0${m.data.photo}`));

  await mum.p.evaluate(() => Sync.run());
  await tab(mum.p, 'growing');
  await mum.p.waitForSelector('.m-photo img:not([hidden])', { timeout: 3000 }).catch(() => {});
  ok("the other phone shows dad's photo",
    await mum.p.locator('.m-photo img').evaluate(img => img.src.startsWith('data:image/jpeg') && img.naturalWidth > 0));

  // A new pairing code moves the log to a new household — photos included.
  const newCode = 'e'.repeat(32);
  await dad.p.evaluate(c => Store.saveSettings({ syncCode: c }), newCode);
  await dad.p.evaluate(() => Sync.run());
  await dad.p.waitForTimeout(500);
  ok('photo follows the log to a new pairing code', photos.has(`${newCode}\0${m.data.photo}`));
  await dad.p.evaluate(c => Store.saveSettings({ syncCode: c }), code);
  await dad.p.evaluate(() => Sync.run());
  await dad.p.waitForTimeout(300);

  // Deleting the milestone takes the photo off the server too.
  await dad.p.click('.m-card');
  dad.p.once('dialog', d => d.accept());
  await dad.p.click('#deleteEntry');
  await dad.p.waitForTimeout(500);
  ok('deleting the milestone deletes its photo on the server', !photos.has(`${code}\0${m.data.photo}`));
  await dad.ctx.close(); await mum.ctx.close();
}

/* ── 5. a server without the photo migration ──────────────── */
{
  photoFunctions = false;
  const code = 'd'.repeat(32);
  const solo = await phone('no-migration', { syncCode: code });
  await tab(solo.p, 'growing');
  await solo.p.click('[data-log="milestone"]');
  await solo.p.fill('input[name="title"]', 'Sat up');
  await solo.p.setInputFiles('[data-photo-input]', { name: 'sit.png', mimeType: 'image/png', buffer: await pngBuffer(solo.p, '#81b29a') });
  await solo.p.waitForSelector('.photo-preview:not([hidden])');
  await solo.p.click('.sheet-actions button[type="submit"]');
  await solo.p.evaluate(() => Sync.run());
  await solo.p.waitForTimeout(500);
  ok('milestone still syncs', [...rows.values()].some(r => r.household === code && r.type === 'milestone'));
  ok('photo kept on the phone', await solo.p.locator('.m-photo img').evaluate(img => img.naturalWidth > 0));
  ok('log sync not marked as failing', await solo.p.evaluate(() => !Sync.status().error));
  await solo.ctx.close();
}

await browser.close();
server.close();

if (errs.length) { console.log('\nconsole errors:'); errs.forEach(e => console.log('  ' + e)); }
else console.log('\nno console errors');
if (fails.length || errs.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log('\nall passed');
