import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript',
  '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };

/* A mock of the two SQL functions, mirroring supabase/migrations/0001_records.sql.
 * The SQL itself is verified separately against a real Postgres; this stands in
 * so the client-side merge, cursor and offline-queue logic can be tested without
 * needing a database. Keep the two in step. */
const rows = new Map();          // `${household}\0${id}` -> row
let revCounter = 0;

function push(code, incoming) {
  if (!code || code.length < 24) throw new Error('invalid pairing code');
  let max = 0;
  for (const r of incoming) {
    const rev = ++revCounter;
    rows.set(`${code}\0${r.id}`, { ...r, household: code, rev, updated_at: Date.now() });
    max = rev;
  }
  return max;
}

function pull(code, since) {
  if (!code || code.length < 24) throw new Error('invalid pairing code');
  return [...rows.values()]
    .filter(r => r.household === code && r.rev > (since || 0))
    .sort((a, b) => a.rev - b.rev)
    .map(({ household, ...r }) => r);
}

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);

  if (req.method === 'POST' && path.startsWith('/rest/v1/rpc/')) {
    const body = JSON.parse(await new Promise(r => {
      let b = ''; req.on('data', c => b += c); req.on('end', () => r(b || '{}'));
    }));
    try {
      const fn = path.split('/').pop();
      const out = fn === 'nayla_sync_push' ? push(body.p_code, body.p_rows) : pull(body.p_code, body.p_since);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: err.message }));
    }
    return;
  }

  let p = path === '/' ? '/index.html' : path;
  try {
    const file = join(ROOT, normalize(p));
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('nope'); }
});
await new Promise(r => server.listen(4173, r));

// PW_CHROMIUM lets a sandbox point at a preinstalled browser; otherwise
// Playwright resolves its own.
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const problems = [];
const fails = [];
const ok = (name, cond, extra='') => { (cond ? console.log : (m)=>{fails.push(m);console.log(m);})(`${cond?'PASS':'FAIL'} — ${name}${extra?` (${extra})`:''}`); };

async function newPhone(label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push(`${label} pageerror: ${e.message}`));
  page.on('console', m => {
    // The rejected-pairing-code case deliberately provokes a 400.
    if (m.type() === 'error' && !/status of 400/.test(m.text())) {
      problems.push(`${label} console: ${m.text()}`);
    }
  });
  await page.goto('http://localhost:4173/index.html');
  return { ctx, page };
}

/* ── 1. migration from the v1 storage format ───────────────── */
{
  const { ctx, page } = await newPhone('migrate');
  await page.evaluate(() => {
    const H = 3600000, now = Date.now();
    localStorage.removeItem('nayla.records.v2');
    localStorage.setItem('nayla.entries.v1', JSON.stringify([
      { id:'v1a', type:'feed', method:'bottle', amount:120, start: now-2*H, end:null, note:'old note' },
      { id:'v1b', type:'diaper', kind:'both', start: now-1*H, end:null, note:'' },
      { id:'v1c', type:'sleep', start: now-6*H, end: now-4*H, note:'' },
      { id:'junk', type:'nonsense', start: now, end:null },
    ]));
  });
  await page.reload();
  await page.waitForTimeout(300);

  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('nayla.records.v2')));
  ok('v1 records migrate', migrated.length === 3, `${migrated.length} of 3 valid rows`);
  const feed = migrated.find(r => r.id === 'v1a');
  ok('v1 feed payload moves into data', feed.data.amount === 120 && feed.data.method === 'bottle');
  ok('v1 start becomes at', Number.isFinite(feed.at) && feed.at === feed.updatedAt);
  ok('v1 note survives', feed.note === 'old note');
  ok('unknown types dropped', !migrated.some(r => r.type === 'nonsense'));
  ok('v1 key left intact', await page.evaluate(() => !!localStorage.getItem('nayla.entries.v1')));
  ok('migrated rows render', (await page.locator('#recentList .entry').count()) === 3);
  await ctx.close();
}

/* ── 2. the UI, against the registry ───────────────────────── */
{
  const { ctx, page } = await newPhone('ui');
  await page.evaluate(() => {
    localStorage.removeItem('nayla.entries.v1');
    localStorage.removeItem('nayla.records.v2');
  });
  await page.reload();
  await page.waitForTimeout(200);

  ok('quick buttons built from registry', (await page.locator('#quickGrid .quick').count()) === 3);
  ok('status cards built from registry', (await page.locator('#statusRow .stat').count()) === 3);
  ok('filters built from registry', (await page.locator('#historyFilters .chip').count()) === 4);
  ok('dob defaults to real birthday', (await page.textContent('#babyAge')).includes('week'),
     await page.textContent('#babyAge'));

  await page.click('[data-log="feed"]');
  await page.fill('input[name="amount"]', '150');
  await page.fill('input[name="minutes"]', '20');
  await page.click('#entryForm button[type="submit"]');
  await page.waitForTimeout(200);
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('nayla.records.v2'))[0]);
  ok('feed saves into data payload', rec.data.amount === 150 && rec.type === 'feed', JSON.stringify(rec.data));
  ok('duration becomes end', rec.end - rec.at === 20 * 60000);
  ok('new record is dirty', rec.dirty === true && rec.rev === 0);

  await page.click('#sleepToggle');
  await page.waitForTimeout(150);
  ok('sleep starts', (await page.textContent('#wakeLabel')) === 'Asleep for');
  await page.click('#sleepToggle');
  await page.waitForTimeout(150);
  ok('sleep ends', (await page.textContent('#wakeLabel')) === 'Awake for');

  // sleep validation: wake-up before falling asleep must be refused
  await page.click('[data-log="sleep"]');
  const at = await page.inputValue('input[name="at"]');
  await page.fill('input[name="end"]', at.slice(0, 11) + '00:00');
  await page.click('#entryForm button[type="submit"]');
  await page.waitForTimeout(200);
  ok('backwards sleep refused', await page.isVisible('#toast') && !(await page.isHidden('#sheetBackdrop')),
     await page.textContent('#toast'));
  await page.click('#sheetClose');

  for (const tab of ['history', 'stats', 'settings']) {
    await page.click(`[data-tab="${tab}"]`);
    await page.waitForTimeout(200);
  }
  ok('settings shows local-only copy',
     (await page.textContent('#dataScope')).includes('this device only'));
  await ctx.close();
}

/* ── 3. two phones sharing one log ─────────────────────────── */
{
  const CODE = 'a'.repeat(32);
  const setup = async (page, label) => {
    await page.evaluate(([code]) => {
      localStorage.removeItem('nayla.entries.v1');
      localStorage.removeItem('nayla.records.v2');
      localStorage.setItem('nayla.settings.v1', JSON.stringify({
        name: 'Nayla', dob: '2026-06-04', units: 'ml',
        syncUrl: 'http://localhost:4173', syncKey: 'test-anon-key', syncCode: code,
        lastPulledAt: 0,
      }));
    }, [CODE]);
    await page.reload();
    await page.waitForTimeout(300);
  };

  const mum = await newPhone('mum');
  const dad = await newPhone('dad');
  await setup(mum.page, 'mum');
  await setup(dad.page, 'dad');

  const count = p => p.evaluate(() => Store.all().length);
  const sync = async p => { await p.evaluate(() => Sync.run()); await p.waitForTimeout(150); };

  // mum logs a feed at home
  await mum.page.click('[data-log="feed"]');
  await mum.page.fill('input[name="amount"]', '95');
  await mum.page.click('#entryForm button[type="submit"]');
  await mum.page.waitForTimeout(150);
  await sync(mum.page);

  const mumRec = await mum.page.evaluate(() => Store.all()[0]);
  ok('push clears dirty and pull assigns rev', mumRec.dirty === false && mumRec.rev > 0,
     `dirty=${mumRec.dirty} rev=${mumRec.rev}`);

  // dad, at work, pulls it
  await sync(dad.page);
  ok('dad receives mum\'s feed', (await count(dad.page)) === 1);
  const dadRec = await dad.page.evaluate(() => Store.all()[0]);
  ok('payload survives the round trip', dadRec.data.amount === 95, JSON.stringify(dadRec.data));
  ok('dad\'s copy is not dirty', dadRec.dirty === false);

  // dad logs a diaper; mum picks it up
  await dad.page.click('[data-log="diaper"]');
  await dad.page.click('#entryForm button[type="submit"]');
  await dad.page.waitForTimeout(150);
  await sync(dad.page);
  await sync(mum.page);
  ok('mum receives dad\'s diaper', (await count(mum.page)) === 2);

  // an edit propagates
  await mum.page.evaluate(() => {
    const feed = Store.all().find(r => r.type === 'feed');
    Store.update(feed.id, { note: 'took it all' });
  });
  await sync(mum.page);
  await sync(dad.page);
  ok('edit propagates', await dad.page.evaluate(
    () => Store.all().find(r => r.type === 'feed').note) === 'took it all');

  // a delete propagates as a tombstone
  await dad.page.evaluate(() => {
    Store.remove(Store.all().find(r => r.type === 'diaper').id);
  });
  await sync(dad.page);
  await sync(mum.page);
  ok('delete propagates', (await count(mum.page)) === 1);

  // offline queue: three entries with no network, then reconnect
  await mum.ctx.setOffline(true);
  for (const type of ['feed', 'diaper', 'feed']) {
    await mum.page.click(`[data-log="${type}"]`);
    await mum.page.click('#entryForm button[type="submit"]');
    await mum.page.waitForTimeout(120);
  }
  await sync(mum.page);
  ok('offline writes stay queued', (await mum.page.evaluate(() => Store.pending().length)) === 3);
  await mum.ctx.setOffline(false);
  await sync(mum.page);
  ok('queue drains on reconnect', (await mum.page.evaluate(() => Store.pending().length)) === 0);
  await sync(dad.page);
  ok('dad catches up after mum reconnects', (await count(dad.page)) === 4, `${await count(dad.page)}`);

  // local unpushed edits must win over an incoming older row
  await dad.page.evaluate(() => {
    const feed = Store.all().find(r => r.note === 'took it all');
    Store.update(feed.id, { note: 'local edit wins' });
  });
  await mum.page.evaluate(() => {
    const feed = Store.all().find(r => r.note === 'took it all');
    Store.update(feed.id, { note: 'mum edit' });
  });
  await sync(mum.page);
  await dad.page.evaluate(() => Sync.run());   // dad pulls while his edit is dirty
  await dad.page.waitForTimeout(200);
  ok('unpushed local edit is not clobbered', await dad.page.evaluate(
    () => Store.all().some(r => r.note === 'local edit wins')));

  // self-hosted PostgREST needs no anon key; the pairing code is the secret
  await dad.page.evaluate(() => Store.saveSettings({ syncKey: '' }));
  ok('sync stays enabled with no anon key', await dad.page.evaluate(() => Sync.enabled()));
  await mum.page.click('[data-log="diaper"]');
  await mum.page.click('#entryForm button[type="submit"]');
  await mum.page.waitForTimeout(120);
  await sync(mum.page);
  await sync(dad.page);
  ok('keyless client still syncs', (await count(dad.page)) === 5, `${await count(dad.page)}`);

  // a wrong pairing code must fail loudly, not silently corrupt
  await dad.page.evaluate(() => Store.saveSettings({ syncCode: 'short' }));
  const st = await dad.page.evaluate(() => Sync.run());
  ok('short code rejected', Boolean(st.error), st.error || 'no error surfaced');

  await mum.page.click('[data-tab="settings"]');
  await mum.page.waitForTimeout(200);
  ok('settings warns data leaves the device',
     (await mum.page.textContent('#dataScope')).includes('synced to your server'));

  await mum.ctx.close(); await dad.ctx.close();
}

console.log(problems.length ? '\nJS ERRORS:\n' + problems.join('\n') : '\nno console errors');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall assertions passed');
await browser.close();
server.close();
process.exit(fails.length || problems.length ? 1 : 0);
