/* Pairing: one phone shows a QR, the other opens the link and is configured
 * without anyone typing a 32-character secret. */
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
    .sort((a, b) => a.rev - b.rev).map(({ household, ...r }) => r); };

const srv = createServer(async (q, r) => {
  const path = decodeURIComponent(q.url.split('?')[0]);
  if (q.method === 'POST' && path.startsWith('/rest/v1/rpc/')) {
    const body = JSON.parse(await new Promise(res => { let b=''; q.on('data',c=>b+=c); q.on('end',()=>res(b||'{}')); }));
    try {
      const fn = path.split('/').pop();
      const out = fn === 'nayla_sync_push' ? push(body.p_code, body.p_rows) : pull(body.p_code, body.p_since);
      r.writeHead(200, {'Content-Type':'application/json'}); r.end(JSON.stringify(out));
    } catch (e) { r.writeHead(400, {'Content-Type':'application/json'}); r.end(JSON.stringify({message:e.message})); }
    return;
  }
  let p = path === '/' ? '/index.html' : path;
  // Point config.js at this mock, so both phones reach the fake backend the
  // same way the real app reaches Supabase — through the Config fallback.
  if (p === '/js/config.js') {
    r.writeHead(200, {'Content-Type':'text/javascript'});
    r.end(`const Config = { url: 'http://localhost:4191', anonKey: '' };`);
    return;
  }
  try { const f = join(ROOT, normalize(p)); const b = await readFile(f);
    r.writeHead(200, {'Content-Type': T[extname(f)] || 'application/octet-stream'}); r.end(b);
  } catch { r.writeHead(404).end(); }
});
await new Promise(r => srv.listen(4191, r));

const br = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const fails = [], errs = [];
const ok = (n, c, x='') => { if (!c) fails.push(n); console.log(`${c?'PASS':'FAIL'} — ${n}${x?` (${x})`:''}`); };

async function phone(label) {
  const ctx = await br.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, timezoneId:'Asia/Kuala_Lumpur' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(`${label}: ${e.message}`));
  p.on('console', m => { if (m.type()==='error' && !/status of 400/.test(m.text())) errs.push(`${label}: ${m.text()}`); });
  await p.goto('http://localhost:4191/index.html');
  await p.evaluate(() => localStorage.clear());
  await p.reload(); await p.waitForTimeout(300);
  return { ctx, p };
}

// ── Phone 1: tap once, get a code and a QR ──
const dad = await phone('dad');
await dad.p.click('[data-tab="settings"]'); await dad.p.waitForTimeout(200);
ok('starts unpaired', (await dad.p.textContent('#syncStatus')).includes('Not paired'));
ok('button invites sharing', (await dad.p.textContent('#pairBtn')).includes('Start sharing'));

await dad.p.click('#pairBtn'); await dad.p.waitForTimeout(400);
ok('pairing sheet opens', await dad.p.isVisible('#pairSheet'));
ok('a QR is drawn', (await dad.p.locator('#pairQr svg').count()) === 1);

const code = await dad.p.evaluate(() => Store.settings().syncCode);
ok('a code was generated', /^[0-9a-f]{32}$/.test(code), code);

const link = await dad.p.evaluate(() => Pair.link(Store.settings().syncCode));
ok('link carries the code in the fragment', link.includes('#pair=' + code));

// the QR must contain exactly that link — decoded for real in qr_roundtrip.py
const svgText = await dad.p.evaluate(() => document.querySelector('#pairQr svg').outerHTML);
ok('QR svg is non-trivial', svgText.length > 500, `${svgText.length} chars`);

await dad.p.click('#pairClose'); await dad.p.waitForTimeout(200);
ok('sheet closes', !(await dad.p.isVisible('#pairSheet')));

// log something to sync over
await dad.p.click('[data-tab="now"]'); await dad.p.waitForTimeout(200);
await dad.p.click('[data-log="feed"]');
await dad.p.fill('input[name="amount"]', '120');
await dad.p.click('#entryForm button[type="submit"]');
await dad.p.waitForTimeout(200);
await dad.p.evaluate(() => Sync.run()); await dad.p.waitForTimeout(300);

// ── Phone 2: open the link, nothing typed ──
const mum = await phone('mum');
await mum.p.goto(link);
await mum.p.waitForTimeout(1200);

ok('opening the link pairs her phone',
   (await mum.p.evaluate(() => Store.settings().syncCode)) === code);
ok('secret is stripped from the address bar',
   !(await mum.p.evaluate(() => location.hash)), await mum.p.evaluate(() => location.hash));
ok('her phone pulled his entry',
   (await mum.p.evaluate(() => Store.all().length)) === 1,
   `${await mum.p.evaluate(() => Store.all().length)} records`);
ok('the entry is his feed',
   (await mum.p.evaluate(() => Store.all()[0]?.data?.amount)) === 120);

await mum.p.click('[data-tab="settings"]'); await mum.p.waitForTimeout(400);
const status = await mum.p.textContent('#syncStatus');
ok('her status shows paired', /Up to date|first sync/.test(status), status);
ok('fields show what sync actually uses (not blank)',
   (await mum.p.inputValue('#setSyncCode')) === code);

// ── it keeps working both ways, on its own ──
await mum.p.click('[data-tab="now"]'); await mum.p.waitForTimeout(200);
await mum.p.click('[data-log="diaper"]');
await mum.p.click('#entryForm button[type="submit"]');
await mum.p.waitForTimeout(200);
await mum.p.evaluate(() => Sync.run()); await mum.p.waitForTimeout(300);
await dad.p.evaluate(() => Sync.run()); await dad.p.waitForTimeout(300);
ok('his phone sees her entry', (await dad.p.evaluate(() => Store.all().length)) === 2);

// a junk link must not wipe an existing pairing
await mum.p.goto('http://localhost:4191/index.html#pair=notavalidcode');
await mum.p.waitForTimeout(600);
ok('a malformed pairing link is ignored',
   (await mum.p.evaluate(() => Store.settings().syncCode)) === code);

await dad.p.screenshot({ path: `${process.env.SHOT_DIR || '/tmp'}/pair-sheet.png`, fullPage: false });

console.log(errs.length ? '\nERRORS:\n' + errs.join('\n') : '\nno console errors');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall passed');
await br.close(); srv.close();
process.exit(fails.length || errs.length ? 1 : 0);
