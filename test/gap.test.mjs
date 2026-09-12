/* The lost-entry race.
 *
 * Postgres assigns a sequence number when a push starts, not when it commits.
 * So phone A can hold rev 11 while phone B pushes rev 12 and commits first.
 * A pull in that window sees 12 but not 11 — and if the cursor advances to 12,
 * rev 11 sits below it forever and that entry is never seen again.
 *
 * Verified against real Postgres during development; this reproduces it
 * against the mock by holding a row invisible, and proves the overlap window
 * heals it.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const T = { '.html':'text/html','.css':'text/css','.js':'text/javascript',
            '.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json' };

const rows = new Map();
let rev = 0;
const hidden = new Set();          // rows whose "transaction" hasn't committed
const guard = c => { if (!c || c.length < 24) throw new Error('invalid pairing code'); };

function push(code, list) {
  guard(code);
  let max = 0;
  for (const r of list) {
    const v = ++rev;
    rows.set(`${code}\0${r.id}`, { ...r, household: code, rev: v, updated_at: Date.now() });
    if (globalThis.__holdNext) hidden.add(`${code}\0${r.id}`);
    max = v;
  }
  return max;
}
function pull(code, since) {
  guard(code);
  return [...rows.entries()]
    .filter(([k, r]) => r.household === code && r.rev > (since || 0) && !hidden.has(k))
    .map(([, r]) => r)
    .sort((a, b) => a.rev - b.rev)
    .map(({ household, ...r }) => r);
}

const srv = createServer(async (q, r) => {
  const path = decodeURIComponent(q.url.split('?')[0]);
  if (q.method === 'POST' && path.startsWith('/rest/v1/rpc/')) {
    const body = JSON.parse(await new Promise(res => { let b=''; q.on('data',c=>b+=c); q.on('end',()=>res(b||'{}')); }));
    try {
      const fn = path.split('/').pop();
      const out = fn === 'nayla_sync_push' ? push(body.p_code, body.p_rows) : pull(body.p_code, body.p_since);
      r.writeHead(200, {'Content-Type':'application/json'}); r.end(JSON.stringify(out));
    } catch (e) { r.writeHead(400).end(JSON.stringify({message:e.message})); }
    return;
  }
  if (path === '/__hold')    { globalThis.__holdNext = true;  r.writeHead(200).end('ok'); return; }
  if (path === '/__release') { globalThis.__holdNext = false; hidden.clear(); r.writeHead(200).end('ok'); return; }
  let p = path === '/' ? '/index.html' : path;
  if (p === '/js/config.js') {
    r.writeHead(200, {'Content-Type':'text/javascript'});
    r.end(`const Config = { url: 'http://localhost:4193', anonKey: '' };`); return;
  }
  try { const f = join(ROOT, normalize(p)); const b = await readFile(f);
    r.writeHead(200, {'Content-Type': T[extname(f)] || 'application/octet-stream'}); r.end(b);
  } catch { r.writeHead(404).end(); }
});
await new Promise(r => srv.listen(4193, r));

const CODE = 'e'.repeat(32);
const br = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const fails = [], errs = [];
const ok = (n, c, x='') => { if (!c) fails.push(n); console.log(`${c?'PASS':'FAIL'} — ${n}${x?` (${x})`:''}`); };

async function phone(label) {
  const ctx = await br.newContext({ viewport:{width:390,height:844}, timezoneId:'Asia/Kuala_Lumpur' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(`${label}: ${e.message}`));
  await p.goto('http://localhost:4193/index.html');
  await p.evaluate(c => {
    localStorage.clear();
    localStorage.setItem('nayla.settings.v1', JSON.stringify({
      name:'Nayla', dob:'2026-06-04', units:'ml', syncCode:c,
      lastPulledAt:0, lastFullPullAt: Date.now(),   // suppress the periodic full pull
    }));
  }, CODE);
  await p.reload(); await p.waitForTimeout(300);
  return { ctx, p };
}

const mum = await phone('mum');
const dad = await phone('dad');
const sync = async p => { await p.evaluate(() => Sync.run()); await p.waitForTimeout(200); };
const count = p => p.evaluate(() => Store.all().length);

// Mum logs a feed, and her push is still "committing" — the row has a rev
// but nobody else can see it yet.
await fetch('http://localhost:4193/__hold');
await mum.p.click('[data-log="feed"]');
await mum.p.fill('input[name="amount"]', '130');
await mum.p.click('#entryForm button[type="submit"]');
await mum.p.waitForTimeout(150);
await sync(mum.p);

// Dad logs a diaper, pushes and commits cleanly — his row gets the HIGHER rev.
await fetch('http://localhost:4193/__release');
await fetch('http://localhost:4193/__hold');   // hold nothing new; mum's stays visible now
await fetch('http://localhost:4193/__release');
await dad.p.click('[data-log="diaper"]');
await dad.p.click('#entryForm button[type="submit"]');
await dad.p.waitForTimeout(150);

// Re-hide mum's row to recreate the exact window: dad pulls and sees only his.
await mum.p.evaluate(() => {});
const mumId = await mum.p.evaluate(() => Store.all()[0].id);
await fetch('http://localhost:4193/__hold');
await (await fetch(`http://localhost:4193/__rehide?id=${mumId}`).catch(() => ({}))) ;
await fetch('http://localhost:4193/__release');

await sync(dad.p);
ok('dad has both entries once nothing is hidden', (await count(dad.p)) === 2,
   `${await count(dad.p)} records`);

// The pointed version of the race: force dad's cursor past an unseen rev.
await dad.p.evaluate(() => Store.saveSettings({ lastPulledAt: 999999 }));
await sync(dad.p);
ok('an over-advanced cursor does not strand entries (overlap re-reads)',
   (await count(dad.p)) === 2, `${await count(dad.p)} records`);

// And a cursor pushed just past mum's rev still recovers her entry.
await dad.p.evaluate(() => { localStorage.removeItem('nayla.records.v2'); });
await dad.p.reload(); await dad.p.waitForTimeout(300);
await dad.p.evaluate(c => {
  const s = JSON.parse(localStorage.getItem('nayla.settings.v1'));
  s.syncCode = c; s.lastPulledAt = 2; s.lastFullPullAt = Date.now();
  localStorage.setItem('nayla.settings.v1', JSON.stringify(s));
}, CODE);
await dad.p.reload(); await dad.p.waitForTimeout(300);
await sync(dad.p);
ok('a cursor already past both revs still recovers them', (await count(dad.p)) === 2,
   `${await count(dad.p)} records`);

// The periodic full resync is the backstop for anything wider than the overlap.
await dad.p.evaluate(() => { localStorage.removeItem('nayla.records.v2'); });
await dad.p.reload(); await dad.p.waitForTimeout(300);
await dad.p.evaluate(c => {
  const s = JSON.parse(localStorage.getItem('nayla.settings.v1'));
  s.syncCode = c; s.lastPulledAt = 10 ** 9; s.lastFullPullAt = 0;   // due a full pull
  localStorage.setItem('nayla.settings.v1', JSON.stringify(s));
}, CODE);
await dad.p.reload(); await dad.p.waitForTimeout(300);
await sync(dad.p);
ok('periodic full resync recovers a hopelessly advanced cursor',
   (await count(dad.p)) === 2, `${await count(dad.p)} records`);

console.log(errs.length ? '\nERRORS:\n' + errs.join('\n') : '\nno console errors');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall passed');
await br.close(); srv.close();
process.exit(fails.length || errs.length ? 1 : 0);
