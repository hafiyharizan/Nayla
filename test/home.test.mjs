/* The Home screen: where the app opens, its header photo, its alerts, and
 * today's numbers against a usual day, and the 7-day charts.
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
async function phone(label, { settings = {}, records = [], time = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  if (time) await p.clock.install({ time });     // a fixed "now" that still ticks
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

/* ── 3. today, against a usual day ────────────────────────── */
{
  // 3pm, so "by now" and "a whole day" differ.
  const now = new Date(2026, 9, 31, 15, 0).getTime();
  const mid = k => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - k); return d.getTime(); };
  const recs = [];
  for (let k = 1; k <= 7; k++) {
    // 6 feeds a day, 4 of them before 3pm; 6 diapers, 4 before 3pm.
    for (const h of [1, 5, 9, 13, 17, 21]) recs.push({ type: 'feed', at: mid(k) + h * H, data: { method: 'bottle' } });
    for (const h of [2, 6, 10, 14, 18, 22]) recs.push({ type: 'diaper', at: mid(k) + h * H, data: { kind: 'wet' } });
  }
  // Nights from 10pm to 6am: 8h a whole day, 6h of it before 3pm.
  for (let k = 0; k <= 8; k++) recs.push({ type: 'sleep', at: mid(k) - 2 * H, end: mid(k) + 6 * H });
  // Today: 7 feeds and 4 diapers so far.
  for (const h of [1, 3, 5, 7, 9, 11, 13]) recs.push({ type: 'feed', at: mid(0) + h * H, data: { method: 'bottle' } });
  for (const h of [2, 6, 10, 14]) recs.push({ type: 'diaper', at: mid(0) + h * H, data: { kind: 'wet' } });

  const { ctx, p } = await phone('today', { records: recs, time: now });
  const text = async sel => (await p.textContent(sel)).replace(/\s+/g, ' ').trim();
  const feeds = await text('.sum-feed');
  ok('feeds since midnight', /Feeds 7\b/.test(feeds), feeds);
  ok('against what she usually has by this time', feeds.includes('Usually 4 by now'));
  ok('…and on a whole day', feeds.includes('Avg 6 a day'));
  ok('more than usual says how many more', (await text('.sum-feed .sum-chip')) === '↑ 3 more');

  const sleep = await text('.sum-sleep');
  ok('a night across midnight counts its share of today', /Sleep 6h\b/.test(sleep), sleep);
  ok('sleep against the same hours on other days', sleep.includes('Usually 6h by now') && sleep.includes('Avg 8h a day'));
  ok('same as usual is "On track"', (await text('.sum-sleep .sum-chip')) === 'On track');
  ok('diapers on track too', (await text('.sum-diaper .sum-chip')) === 'On track');
  ok('a tracker with no history yet says so',
    (await text('.sum-solids')).includes('Not enough days') && !(await p.isVisible('.sum-solids .sum-chip')));
  ok('a tile per tracker that counts', (await p.locator('.sum-tile').count()) === 4);
  ok('the meter fills to today against a whole day',
    parseFloat(await p.$eval('.sum-feed .sum-meter i', i => i.style.width)) === 100);

  // The 7-day charts: one per tracker with something logged.
  ok('a chart each for sleep, feeds and diapers',
    (await p.$$eval('#statsBody .stat-block h3', hs => hs.map(h => h.textContent).join())) === 'Sleep per day,Feeds per day,Diapers per day');
  const feedChart = p.locator('#statsBody .stat-block', { hasText: 'Feeds per day' });
  ok('the chart reads out her usual day', (await feedChart.locator('.chart-readout').textContent()) === 'Usually 6 a day');
  ok("today's column carries its value", (await feedChart.locator('.c-cap').textContent()) === '7');
  ok('seven columns, today last', (await feedChart.locator('.c-day').allTextContents()).at(-1) === 'Today'
    && (await feedChart.locator('.col').count()) === 7);
  await feedChart.locator('[data-col="0"]').click();
  const sevenAgo = new Date(mid(6)).toLocaleDateString([], { weekday: 'long' });
  ok('tapping a day reads it out', (await feedChart.locator('.chart-readout').textContent()) === `${sevenAgo} · 6`,
    await feedChart.locator('.chart-readout').textContent());
  await feedChart.locator('[data-col="0"]').click();
  ok('tapping it again goes back', (await feedChart.locator('.chart-readout').textContent()) === 'Usually 6 a day');

  ok('the greeting knows the night shift', await p.evaluate(() =>
    Home.greeting(3).text === 'Night shift' && Home.greeting(9).text === 'Good morning' && Home.greeting(15).text === 'Good afternoon'));
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
