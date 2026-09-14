/* Nobody presses sync.
 *
 * The worry was: "if my wife logs, I can't see it until she presses sync."
 * This proves otherwise — two phones sitting open, no taps on either, and
 * an entry made on one appears on the other on its own.
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
const guard = c => { if (!c || c.length < 24) throw new Error('invalid pairing code'); };
const push = (c, list) => { guard(c); let m = 0;
  for (const r of list) { const v = ++rev; rows.set(`${c}\0${r.id}`, { ...r, household:c, rev:v, updated_at:Date.now() }); m = v; }
  return m; };
const pull = (c, since) => { guard(c);
  return [...rows.values()].filter(r => r.household===c && r.rev > (since||0))
    .sort((a,b)=>a.rev-b.rev).map(({household,...r}) => r); };

const srv = createServer(async (q, r) => {
  const path = decodeURIComponent(q.url.split('?')[0]);
  if (q.method === 'POST' && path.startsWith('/rest/v1/rpc/')) {
    const body = JSON.parse(await new Promise(res => { let b=''; q.on('data',c=>b+=c); q.on('end',()=>res(b||'{}')); }));
    const fn = path.split('/').pop();
    const out = fn === 'nayla_sync_push' ? push(body.p_code, body.p_rows) : pull(body.p_code, body.p_since);
    r.writeHead(200, {'Content-Type':'application/json'}); r.end(JSON.stringify(out));
    return;
  }
  let p = path === '/' ? '/index.html' : path;
  if (p === '/js/config.js') {
    r.writeHead(200, {'Content-Type':'text/javascript'});
    r.end(`const Config = { url: 'http://localhost:4197', anonKey: '' };`); return;
  }
  try { const f = join(ROOT, normalize(p)); const b = await readFile(f);
    r.writeHead(200, {'Content-Type': T[extname(f)] || 'application/octet-stream'}); r.end(b);
  } catch { r.writeHead(404).end(); }
});
await new Promise(r => srv.listen(4197, r));

const CODE = 'b'.repeat(32);
const br = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const fails = [], errs = [];
const ok = (n,c,x='') => { if(!c) fails.push(n); console.log(`${c?'PASS':'FAIL'} — ${n}${x?` (${x})`:''}`); };

async function phone(label) {
  const ctx = await br.newContext({ viewport:{width:390,height:844}, timezoneId:'Asia/Kuala_Lumpur' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(`${label}: ${e.message}`));
  await p.goto('http://localhost:4197/index.html');
  await p.evaluate(c => {
    localStorage.clear();
    localStorage.setItem('nayla.settings.v1', JSON.stringify({
      name:'Nayla', dob:'2026-06-04', units:'ml', syncCode:c,
      lastPulledAt:0, lastFullPullAt: Date.now() }));
  }, CODE);
  await p.reload(); await p.waitForTimeout(400);
  return { ctx, p };
}

const mum = await phone('mum');
const dad = await phone('dad');

// Both phones are open and sitting there. Mum logs a feed. Nobody taps sync
// on either phone — dad's just stays open.
await mum.p.click('[data-log="feed"]');
await mum.p.fill('input[name="amount"]', '130');
await mum.p.click('#entryForm button[type="submit"]');

const started = Date.now();
let sawIt = false;
// Poll the DOM only — never touching Sync, never tapping anything on dad's phone.
for (let i = 0; i < 30 && !sawIt; i++) {
  await dad.p.waitForTimeout(1000);
  sawIt = await dad.p.evaluate(() => Store.all().some(r => r.data?.amount === 130));
}
const seconds = Math.round((Date.now() - started) / 1000);
ok("dad's phone picks it up with no taps at all", sawIt, `after ${seconds}s`);
ok('and fast enough to feel live', sawIt && seconds <= 20, `${seconds}s`);

// It is on screen, not just in storage.
const recent = await dad.p.textContent('#recentList');
ok('it is visible on his Now screen', /130/.test(recent), recent.replace(/\s+/g,' ').slice(0,60));

// Returning to the app pulls straight away, rather than waiting for a tick.
await mum.p.click('[data-log="diaper"]');
await mum.p.click('#entryForm button[type="submit"]');
await mum.p.waitForTimeout(2500);           // her push goes up on its own
await dad.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await dad.p.waitForTimeout(1200);
ok('switching back to the app is current immediately',
   (await dad.p.evaluate(() => Store.all().filter(r => r.type === 'diaper').length)) === 1);

console.log(errs.length ? '\nERRORS:\n' + errs.join('\n') : '\nno console errors');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall passed');
await br.close(); srv.close();
process.exit(fails.length || errs.length ? 1 : 0);
