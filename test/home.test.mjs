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
async function phone(label, { settings = {}, records = [], time = null, context = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...context });
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
/* Her day runs from 6am (a set time here; the others are tested below) to the
 * next 6am, and a sleep counts whole on the day it started. */
{
  // 3pm, so "by now" and "a whole day" differ.
  const now = new Date(2026, 9, 31, 15, 0).getTime();
  const at = (k, h) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - k); return d.getTime() + h * H; };
  const recs = [];
  for (let k = 1; k <= 7; k++) {
    // 6 feeds a day, 3 of them by 3pm — and the 2am feed is the night
    // before's, so it belongs to this day too.
    for (const h of [7, 10, 13, 17, 21, 26]) recs.push({ type: 'feed', at: at(k, h), data: { method: 'bottle' } });
    for (const h of [8, 11, 14, 18, 22, 27]) recs.push({ type: 'diaper', at: at(k, h), data: { kind: 'wet' } });
    // Naps 10–11 and 1–2:30; a night 9pm–3am; and 3:30–6:30am, which starts
    // before 6am, so it is still that night. 11h 30m a day, 2h 30m by 3pm.
    recs.push({ type: 'sleep', at: at(k, 10), end: at(k, 11) });
    recs.push({ type: 'sleep', at: at(k, 13), end: at(k, 14.5) });
    recs.push({ type: 'sleep', at: at(k, 21), end: at(k, 27) });
    recs.push({ type: 'sleep', at: at(k, 27.5), end: at(k, 30.5) });
  }
  // Today: 5 feeds, 3 diapers, and 2h of naps so far.
  for (const h of [7, 9, 11, 13, 14]) recs.push({ type: 'feed', at: at(0, h), data: { method: 'bottle' } });
  for (const h of [8, 11, 14]) recs.push({ type: 'diaper', at: at(0, h), data: { kind: 'wet' } });
  recs.push({ type: 'sleep', at: at(0, 10), end: at(0, 11) });
  recs.push({ type: 'sleep', at: at(0, 13), end: at(0, 14) });

  const { ctx, p } = await phone('today', { records: recs, time: now,
    settings: { dayStartMode: 'fixed', dayStartTime: '06:00' } });
  const text = async sel => (await p.textContent(sel)).replace(/\s+/g, ' ').trim();
  ok('Today says when her day began', (await text('#summaryMeta')) === `since ${await p.evaluate(() => Fmt.clock(new Date(2026, 9, 31, 6)))}`,
    await text('#summaryMeta'));
  const feeds = await text('.sum-feed');
  ok('feeds since her day began — not the 2am one', /Feeds 5\b/.test(feeds), feeds);
  ok('against what she usually has by this time', feeds.includes('Usually 3 by now'));
  ok('…and on a whole day, night feeds included', feeds.includes('Avg 6 a day'));
  ok('more than usual says how many more', (await text('.sum-feed .sum-chip')) === '↑ 2 more');

  const sleep = await text('.sum-sleep');
  ok("last night isn't in today's sleep", /Sleep 2h\b/.test(sleep), sleep);
  ok('a whole day includes its night, unsplit', sleep.includes('Usually 2h 30m by now') && sleep.includes('Avg 11h 30m a day'), sleep);
  ok('less than usual says how much less', (await text('.sum-sleep .sum-chip')) === '↓ 30m less');
  ok('diapers on track', (await text('.sum-diaper .sum-chip')) === 'On track');
  ok('a tracker with no history yet says so',
    (await text('.sum-solids')).includes('Not enough days') && !(await p.isVisible('.sum-solids .sum-chip')));
  ok('a tile per tracker that counts', (await p.locator('.sum-tile').count()) === 4);
  ok('the meter fills to today against a whole day',
    Math.abs(parseFloat(await p.$eval('.sum-feed .sum-meter i', i => i.style.width)) - 83.3) < 0.1);

  // The 7-day charts: one per tracker with something logged.
  ok('a chart each for sleep, feeds and diapers',
    (await p.$$eval('#statsBody .stat-block h3', hs => hs.map(h => h.textContent).join())) === 'Sleep per day,Feeds per day,Diapers per day');
  const feedChart = p.locator('#statsBody .stat-block', { hasText: 'Feeds per day' });
  ok('the chart reads out her usual day', (await feedChart.locator('.chart-readout').textContent()) === 'Usually 6 a day');
  ok("today's column carries its value", (await feedChart.locator('.c-cap').textContent()) === '5');
  ok('seven columns, today last', (await feedChart.locator('.c-day').allTextContents()).at(-1) === 'Today'
    && (await feedChart.locator('.col').count()) === 7);
  const sleepChart = p.locator('#statsBody .stat-block', { hasText: 'Sleep per day' });
  await sleepChart.locator('[data-col="5"]').click();
  ok('yesterday holds its whole night', (await sleepChart.locator('.chart-readout').textContent()) === `${await p.evaluate(() =>
    new Date(2026, 9, 30).toLocaleDateString([], { weekday: 'long' }))} · 11h 30m`, await sleepChart.locator('.chart-readout').textContent());
  await sleepChart.locator('[data-col="5"]').click();
  ok('tapping it again goes back', (await sleepChart.locator('.chart-readout').textContent()) === 'Usually 11h 30m a day');

  // History groups by her day too: the 9pm–3am night sits whole under Yesterday.
  await p.click('.tab[data-tab="history"]');
  const yesterday = (await p.locator('.day-group', { hasText: 'Yesterday' }).locator('.day-head span').textContent());
  ok('History: yesterday is a whole day and night', yesterday.includes('6 feeds') && yesterday.includes('11h 30m sleep'), yesterday);
  const yTimes = await p.locator('.day-group', { hasText: 'Yesterday' }).locator('.entry-time').allTextContents();
  ok('History: the 2am feed is listed under yesterday', yTimes.filter(t => /^2:00\s*AM/.test(t)).length === 1, yTimes.join(' | '));

  ok('the greeting knows the night shift', await p.evaluate(() =>
    Home.greeting(3).text === 'Night shift' && Home.greeting(9).text === 'Good morning' && Home.greeting(15).text === 'Good afternoon'));
  await ctx.close();
}
{
  // 3am: the night so far is still today, and today began yesterday morning.
  const now = new Date(2026, 10, 1, 3, 0).getTime();
  const { ctx, p } = await phone('3am', { time: now, settings: { dayStartMode: 'fixed', dayStartTime: '06:00' },
    records: [{ type: 'sleep', at: now - 6 * H, end: now - H }, { type: 'feed', at: now - 30 * 60000, data: { method: 'bottle' } }] });
  const sleep = (await p.textContent('.sum-sleep')).replace(/\s+/g, ' ');
  ok('at 3am, the 9pm–2am sleep counts toward today', /Sleep 5h\b/.test(sleep), sleep);
  ok('…which began yesterday morning', (await p.textContent('#summaryMeta')).endsWith('yesterday'));
  await p.click('.tab[data-tab="history"]');
  ok('…and History calls it Today', (await p.locator('.day-head h3').allTextContents()).join() === 'Today');
  await ctx.close();
}

/* ── 3b. midnight, sunrise, Subuh ───────────────────────────── */
{
  const melbourne = { timezoneId: 'Australia/Melbourne', geolocation: { latitude: -37.8136, longitude: 144.9631 },
    permissions: ['geolocation'] };
  const now = new Date('2026-11-01T15:00:00+11:00').getTime();
  const { ctx, p } = await phone('day start', { time: now, context: melbourne,
    records: [{ type: 'sleep', at: now - 3 * H, end: now - 2 * H }] });
  const meta = () => p.textContent('#summaryMeta');
  ok('midnight by default', (await meta()) === 'since midnight', await meta());
  ok('no location is asked for by default', !(await p.isVisible('[data-act="locate"]')));

  await p.click('.tab[data-tab="settings"]');
  ok('midnight needs no other settings', !(await p.isVisible('#dayPlaceRow')) && !(await p.isVisible('#dayTimeRow'))
    && !(await p.isVisible('#daySubuhRow')));

  await p.selectOption('#setDayStart', 'fixed');
  ok('a set time shows the time', await p.isVisible('#dayTimeRow') && !(await p.isVisible('#dayPlaceRow')));
  await p.fill('#setDayTime', '05:30');
  await p.dispatchEvent('#setDayTime', 'change');
  ok('and the day starts then', await p.evaluate(() =>
    new Date(Day.today().at).toTimeString().startsWith('05:30') && Day.today().kind === 'fixed'));

  await p.selectOption('#setDayStart', 'sunrise');
  ok('sunrise without a location falls back to the set time',
    (await p.textContent('#daySunrise')).includes('Until then, her day starts at 5:30 AM'));
  await p.click('#dayLocate');
  await p.waitForFunction(() => Store.settings().place, null, { timeout: 3000 }).catch(() => {});
  ok('the location is kept to about a kilometre',
    JSON.stringify(await p.evaluate(() => Store.settings().place)) === '{"lat":-37.81,"lon":144.96}');
  ok('Settings shows sunrise today', /^Sunrise today 6:1\d AM/.test(await p.textContent('#daySunrise')),
    await p.textContent('#daySunrise'));
  // A reference almanac (astral) has Melbourne's sunrise at 6:13:52 that day.
  const rise = await p.evaluate(() => Day.today().at);
  ok("sunrise is within two minutes of the almanac's",
    Math.abs(rise - new Date('2026-11-01T06:13:52+11:00').getTime()) < 2 * 60000, new Date(rise).toISOString());

  await p.selectOption('#setDayStart', 'subuh');
  ok('Subuh offers a calculation method', await p.isVisible('#daySubuhRow')
    && (await p.$$eval('#setSubuhMethod option', o => o.length)) >= 4);
  // astral's dawn at 20° below the horizon: 4:23:13; at 18°: 4:35:49.
  const subuh20 = await p.evaluate(() => Day.today().at);
  ok('Subuh at 20° (Malaysia) by default, within two minutes of the almanac',
    Math.abs(subuh20 - new Date('2026-11-01T04:23:13+11:00').getTime()) < 2 * 60000, new Date(subuh20).toISOString());
  await p.selectOption('#setSubuhMethod', 'mwl');
  const subuh18 = await p.evaluate(() => Day.today().at);
  ok('…and at 18° for the Muslim World League',
    Math.abs(subuh18 - new Date('2026-11-01T04:35:49+11:00').getTime()) < 2 * 60000, new Date(subuh18).toISOString());
  ok('Settings shows Subuh today', /^Subuh today 4:3\d AM/.test(await p.textContent('#daySunrise')));
  await p.click('.tab[data-tab="home"]');
  ok('Home says when her day began', /^since Subuh, 4:3\d AM$/.test(await meta()), await meta());
  ok('the location never goes into a backup', await p.evaluate(() => !('place' in Store.exportData().settings)));
  await ctx.close();
}
{
  // Phones on the first version defaulted to sunrise. Unless someone set a
  // location up, they move to midnight.
  const old = await phone('migrate', { settings: { dayStart: 'sunrise' } });
  ok('an untouched phone moves to midnight', await old.p.evaluate(() => Store.settings().dayStartMode === 'midnight'));
  await old.ctx.close();
  const kept = await phone('migrate-kept', { settings: { dayStart: 'sunrise', place: { lat: -37.81, lon: 144.96 } } });
  ok('one set up for sunrise keeps it', await kept.p.evaluate(() => Store.settings().dayStartMode === 'sunrise'));
  await kept.ctx.close();
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
