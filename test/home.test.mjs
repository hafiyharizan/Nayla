/* The Home screen: where the app opens, its header photo, its alerts, and
 * the last-24-hours summary.
 *
 * Runs against a static server with a stub backend that records every call,
 * so the test can prove the Home photo never leaves the phone.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4196;
const T = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript',
  '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };

const calls = [];                 // every backend call, by function name
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && path.startsWith('/rest/v1/rpc/')) {
    const fn = path.split('/').pop();
    let body = ''; for await (const c of req) body += c;
    calls.push({ fn, body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(fn === 'nayla_sync_pull' ? '[]' : fn === 'nayla_sync_push' ? '1' : 'null');
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

const H = 3600000, D = 24 * H;
const iso = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** A phone with settings and records already in place, opened fresh. */
async function phone(label, { settings = {}, records = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(`${label}: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error') errs.push(`${label}: ${m.text()}`); });
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.evaluate(({ settings, records }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('nayla.settings.v1', JSON.stringify({ name: 'Nayla', dob: '2026-06-04', ...settings }));
    const now = Date.now();
    localStorage.setItem('nayla.records.v2', JSON.stringify(records.map((r, i) => ({
      id: `r${String(i).padStart(4, '0')}`, end: null, note: '', data: {}, rev: 0,
      updatedAt: now, dirty: false, deleted: false, ...r }))));
  }, { settings, records });
  await p.reload();
  await p.waitForTimeout(350);
  return { ctx, p };
}

const alertTitles = p => p.$$eval('#homeAlerts .alert b', els => els.map(e => e.textContent));
const hasAlert = async (p, re) => (await alertTitles(p)).some(t => re.test(t));

/* ── 1. where it opens ─────────────────────────────────────── */
{
  const { ctx, p } = await phone('opens');
  ok('opens on Home', await p.isVisible('#view-home') && !(await p.isVisible('#view-now')));
  ok('five tabs, Stats folded into Home',
    (await p.$$eval('.tab:not([hidden])', t => t.map(x => x.dataset.tab).join())) === 'home,now,growing,history,settings');
  ok('7-day charts live on Home', await p.isVisible('#view-home #statsBody'));
  ok('the name is in the photo, so the plain header steps aside', !(await p.isVisible('.topbar')));
  ok('…and comes back on other tabs', await (async () => { await p.click('.tab[data-tab="history"]'); return p.isVisible('.topbar'); })());

  await p.reload(); await p.waitForTimeout(300);
  ok('a reload keeps the tab you were on', await p.isVisible('#view-history'));
  const fresh = await ctx.newPage();
  await fresh.goto(`http://localhost:${PORT}/index.html`); await fresh.waitForTimeout(300);
  ok('opening the app afresh starts at Home', await fresh.isVisible('#view-home'));
  await ctx.close();

  // No birthday, nothing logged, nothing due: a calm line, not an empty box.
  const quiet = await phone('quiet', { settings: { dob: '' } });
  ok('calm when nothing needs attention', await hasAlert(quiet.p, /All calm/), (await alertTitles(quiet.p)).join(' | '));
  await quiet.ctx.close();
}

/* ── 2. alerts ─────────────────────────────────────────────── */
{
  const now = Date.now();
  // Woke 3h ago — past a 4-month-old's 2–2.5h window.
  const { ctx, p } = await phone('alerts', { records: [
    { type: 'sleep', at: now - 5 * H, end: now - 3 * H },
  ] });
  ok('awake past the window is flagged', await hasAlert(p, /^Awake 3h/), (await alertTitles(p)).join(' | '));
  await p.click('[data-act="sleep"]');
  await p.waitForTimeout(150);
  ok('"Start sleep" on the alert starts a sleep', await p.evaluate(() => Boolean(Store.activeSleep())));
  ok('…and the alert goes', !(await hasAlert(p, /^Awake/)));
  await ctx.close();
}
{
  const now = Date.now();
  const { ctx, p } = await phone('forgotten', { records: [{ type: 'sleep', at: now - 30 * H }] });
  ok('a sleep left running is flagged', await hasAlert(p, /never ended/));
  await p.click('[data-act^="entry:"]');
  ok('"Fix it" opens that sleep', await p.isVisible('#sheetBackdrop') &&
    (await p.textContent('#sheetTitle')) === 'Edit sleep');
  await ctx.close();
}
{
  // Feeds every 3h for three days, the last one 5h ago.
  const now = Date.now();
  const feeds = [];
  for (let t = now - 5 * H; t > now - 3 * D; t -= 3 * H) feeds.push({ type: 'feed', at: t, data: { method: 'bottle' } });
  const { ctx, p } = await phone('feedgap', { records: feeds });
  ok('a longer-than-usual gap since the last feed is flagged',
    await hasAlert(p, /^5h since the last feed/), (await alertTitles(p)).join(' | '));
  ok('it says what usual is', (await p.textContent('#homeAlerts')).includes('about every 3h'));

  // Dismiss it: gone, and still gone after a reload.
  await p.click('#homeAlerts [data-dismiss^="feedgap"]');
  ok('dismissing hides it', !(await hasAlert(p, /since the last feed/)));
  await p.reload(); await p.waitForTimeout(300);
  ok('…and it stays dismissed', !(await hasAlert(p, /since the last feed/)));
  await ctx.close();
}
{
  const { ctx, p } = await phone('allergen');
  await p.click('.tab[data-tab="now"]');
  await p.click('[data-log="solids"]');
  await p.fill('[data-tag-input]', 'egg');
  await p.click('.sheet-actions button[type="submit"]');
  await p.click('.tab[data-tab="home"]');
  ok('a first allergen puts a watch on Home', await hasAlert(p, /Watching for a reaction/));
  ok('with a time to watch until', /until about/.test(await p.textContent('#homeAlerts')));
  await ctx.close();
}
{
  // Born exactly five months ago today.
  // (On the 29th–31st that day may not exist five months back; skip then.)
  const born = new Date(); born.setMonth(born.getMonth() - 5);
  if (born.getDate() !== new Date().getDate()) {
    console.log('SKIP — month-birthday check: no matching day five months back');
  } else {
    const { ctx, p } = await phone('birthday', { settings: { dob: iso(born.getTime()) } });
    ok('a month-birthday is celebrated', await hasAlert(p, /^Nayla is 5 months old today/), (await alertTitles(p)).join(' | '));
    ok('with a nudge to add a milestone', (await p.locator('[data-act="log:milestone"]').count()) === 1);
    await p.click('[data-act="log:milestone"]');
    ok('which opens the milestone form', (await p.textContent('#sheetTitle')) === 'Log milestone');
    await ctx.close();
  }
}
{
  const { ctx, p } = await phone('growth-first');
  ok('no measurements yet: invited to add them', await hasAlert(p, /Add her measurements/));
  await p.click('.tab[data-tab="settings"]');
  await p.locator('[data-tracker="growth"]').uncheck();
  await p.click('.tab[data-tab="home"]');
  ok('a tracker turned off brings no alerts', !(await hasAlert(p, /measurements/)));
  await ctx.close();
}

/* ── 3. the last 24 hours ──────────────────────────────────── */
{
  const now = Date.now();
  const recs = [];
  // 6 feeds a day for the past week, 9 in the last 24 hours.
  for (let k = 1; k <= 7; k++) for (let i = 0; i < 6; i++) recs.push({ type: 'feed', at: now - k * D - i * 3 * H - H, data: { method: 'bottle' } });
  for (let i = 0; i < 9; i++) recs.push({ type: 'feed', at: now - i * 2 * H - 30 * 60000, data: { method: 'bottle' } });
  const { ctx, p } = await phone('summary', { records: recs });
  const feeds = await p.textContent('.sum-feed');
  ok('feeds in the last 24 hours', /Feeds\s*9/.test(feeds), feeds.replace(/\s+/g, ' '));
  ok('against her 7-day average', feeds.includes('7-day avg 6'));
  ok('marked as more than usual', (await p.locator('.sum-feed .sum-trend').textContent()) === '↑');
  ok('a tile per tracker that counts', (await p.locator('.sum-tile').count()) === 4);
  await ctx.close();
}

/* ── 4. the header photo stays on this phone ──────────────── */
{
  const code = 'a'.repeat(32);
  const { ctx, p } = await phone('photo', { settings: { syncCode: code, photoKey: 'C'.repeat(43) } });
  ok('no photo yet: an invitation instead', await p.isVisible('.hero-add'));

  const b64 = await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 400;
    const g = c.getContext('2d'); g.fillStyle = '#c97'; g.fillRect(0, 0, 600, 400);
    return c.toDataURL('image/png').split(',')[1];
  });
  await p.setInputFiles('[data-hero-input]', { name: 'h.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await p.waitForSelector('.hero.has-photo .hero-img:not([hidden])', { timeout: 3000 }).catch(() => {});
  ok('picking a photo shows it', await p.locator('.hero-img').evaluate(i => !i.hidden && i.naturalWidth > 0));

  await p.evaluate(async () => { await Sync.run(); await Photos.sync(); });
  await p.waitForTimeout(300);
  ok('the Home photo is never uploaded', !calls.some(c => c.fn.startsWith('nayla_photo_')),
    calls.map(c => c.fn).join());
  ok('…nor swept up as an unused photo',
    await p.evaluate(() => Photos.get(Home.HEADER_ID, false).then(Boolean)));

  await p.reload(); await p.waitForTimeout(500);
  ok('it is still there after a reload', await p.locator('.hero-img').evaluate(i => !i.hidden && i.naturalWidth > 0));

  await p.click('.tab[data-tab="settings"]');
  await p.waitForSelector('#homePhotoRow:not([hidden])', { timeout: 2000 }).catch(() => {});
  await p.click('#homePhotoClear');
  await p.click('.tab[data-tab="home"]');
  await p.waitForTimeout(300);
  ok('Settings can remove it', await p.isVisible('.hero-add'));
  await ctx.close();
}
{
  // No Home photo picked: the newest milestone photo stands in.
  const { ctx, p } = await phone('fallback');
  await p.click('.tab[data-tab="growing"]');
  await p.click('[data-log="milestone"]');
  await p.fill('input[name="title"]', 'First smile');
  const b64 = await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 300;
    const g = c.getContext('2d'); g.fillStyle = '#7ab'; g.fillRect(0, 0, 300, 300);
    return c.toDataURL('image/png').split(',')[1];
  });
  await p.setInputFiles('[data-photo-input]', { name: 's.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await p.waitForSelector('.photo-preview:not([hidden])');
  await p.click('.sheet-actions button[type="submit"]');
  await p.click('.tab[data-tab="home"]');
  await p.waitForSelector('.hero.has-photo', { timeout: 3000 }).catch(() => {});
  ok('the newest milestone photo stands in', await p.locator('.hero').evaluate(h => h.classList.contains('has-photo')));
  await ctx.close();
}

await browser.close();
server.close();

if (errs.length) { console.log('\nconsole errors:'); errs.forEach(e => console.log('  ' + e)); }
else console.log('\nno console errors');
if (fails.length || errs.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log('\nall passed');
