/* Three phones on one log.
 *
 * Nothing in the design counts devices — the pairing code names a household,
 * and the server keys every row by (household, id). So a third phone is the
 * same scan as the second, and an Nth phone is the same again. This proves
 * that, and covers re-keying, which is the one way to strand the history.
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
  for (const r of list) { const v = ++rev; rows.set(`${c}\0${r.id}`, { ...r, household: c, rev: v, updated_at: Date.now() }); m = v; }
  return m; };
const pull = (c, since) => { guard(c);
  return [...rows.values()].filter(r => r.household === c && r.rev > (since || 0))
    .sort((a,b) => a.rev - b.rev).map(({ household, ...r }) => r); };

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
  let p = path === '/' ? '/index.html' : path;
  if (p === '/js/config.js') {
    r.writeHead(200, {'Content-Type':'text/javascript'});
    r.end(`const Config = { url: 'http://localhost:4194', anonKey: '' };`); return;
  }
  try { const f = join(ROOT, normalize(p)); const b = await readFile(f);
    r.writeHead(200, {'Content-Type': T[extname(f)] || 'application/octet-stream'}); r.end(b);
  } catch { r.writeHead(404).end(); }
});
await new Promise(r => srv.listen(4194, r));

const br = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const fails = [], errs = [];
const ok = (n,c,x='') => { if(!c) fails.push(n); console.log(`${c?'PASS':'FAIL'} — ${n}${x?` (${x})`:''}`); };

async function phone(label) {
  const ctx = await br.newContext({ viewport:{width:390,height:844}, timezoneId:'Asia/Kuala_Lumpur' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(`${label}: ${e.message}`));
  await p.goto('http://localhost:4194/index.html');
  await p.evaluate(() => localStorage.clear());
  await p.reload(); await p.waitForTimeout(250);
  return { ctx, p, label };
}
const sync  = async ph => { await ph.p.evaluate(() => Sync.run()); await ph.p.waitForTimeout(200); };
const count = ph => ph.p.evaluate(() => Store.all().length);
const log   = async (ph, type) => {
  await ph.p.click(`[data-log="${type}"]`);
  await ph.p.click('#entryForm button[type="submit"]');
  await ph.p.waitForTimeout(150);
};

// ── phone 1 starts the log ──
const dad = await phone('dad');
await dad.p.click('[data-tab="settings"]'); await dad.p.waitForTimeout(200);
await dad.p.click('#pairBtn'); await dad.p.waitForTimeout(300);
const code = await dad.p.evaluate(() => Store.settings().syncCode);
const link = await dad.p.evaluate(() => Pair.link(Store.settings().syncCode));
await dad.p.click('#pairClose');
await dad.p.click('[data-tab="now"]'); await dad.p.waitForTimeout(200);
await log(dad, 'feed');
await sync(dad);

// ── phone 2 joins by the link ──
const mum = await phone('mum');
await mum.p.goto(link); await mum.p.waitForTimeout(900);
ok('phone 2 joined and pulled the history', (await count(mum)) === 1, `${await count(mum)} records`);

// ── phone 3 joins by the SAME link ──
const nanny = await phone('nanny');
await nanny.p.goto(link); await nanny.p.waitForTimeout(900);
ok('phone 3 joined with the same code', (await count(nanny)) === 1, `${await count(nanny)} records`);
ok('all three share one household',
   (await nanny.p.evaluate(() => Store.settings().syncCode)) === code &&
   (await mum.p.evaluate(() => Store.settings().syncCode)) === code);

// ── each logs something; everything reaches everyone ──
await log(mum, 'diaper');   await sync(mum);
await log(nanny, 'sleep');  await sync(nanny);
await sync(dad); await sync(mum); await sync(nanny);

for (const ph of [dad, mum, nanny]) {
  ok(`${ph.label} sees all three entries`, (await count(ph)) === 3, `${await count(ph)} records`);
}

// an edit on phone 3 reaches phones 1 and 2
await nanny.p.evaluate(() => {
  const f = Store.all().find(r => r.type === 'feed');
  Store.update(f.id, { note: 'from the third phone' });
});
await sync(nanny); await sync(dad); await sync(mum);
for (const ph of [dad, mum]) {
  ok(`${ph.label} got phone 3's edit`,
     (await ph.p.evaluate(() => Store.all().some(r => r.note === 'from the third phone'))));
}

// a delete on phone 1 reaches phones 2 and 3
await dad.p.evaluate(() => Store.remove(Store.all().find(r => r.type === 'diaper').id));
await sync(dad); await sync(mum); await sync(nanny);
for (const ph of [mum, nanny]) {
  ok(`${ph.label} got the delete`, (await count(ph)) === 2, `${await count(ph)} records`);
}

// ── re-keying: does the history follow the new code? ──
await dad.p.click('[data-tab="settings"]'); await dad.p.waitForTimeout(200);
dad.p.on('dialog', d => d.accept());
await dad.p.evaluate(() => document.querySelector('.advanced').open = true);
await dad.p.click('#genCode'); await dad.p.waitForTimeout(300);
const newCode = await dad.p.evaluate(() => Store.settings().syncCode);
ok('a new code really is different', newCode !== code);
await sync(dad);

const stranded = await phone('joiner');
await stranded.p.evaluate(c => {
  localStorage.setItem('nayla.settings.v1', JSON.stringify({
    name:'Nayla', dob:'2026-06-04', units:'ml', syncCode:c, lastPulledAt:0, lastFullPullAt:0 }));
}, newCode);
await stranded.p.reload(); await stranded.p.waitForTimeout(400);
await sync(stranded);
ok('history follows a re-keyed household', (await count(stranded)) === 2,
   `${await count(stranded)} of 2 records reached the new code`);

console.log(errs.length ? '\nERRORS:\n' + errs.join('\n') : '\nno console errors');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall passed');
await br.close(); srv.close();
process.exit(fails.length || errs.length ? 1 : 0);
