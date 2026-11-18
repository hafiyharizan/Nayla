/* Babysitter access, end to end: a family phone makes a guest link, the
 * babysitter's phone opens it, sees the log, logs a feed of her own, can't
 * change the family's entries, and loses everything the moment the family
 * removes her.
 *
 * The mock server follows the rules in supabase/migrations/0005_guests.sql
 * (which is checked separately against a real Postgres): guests read the
 * household, add rows tagged with their name, change only their own rows —
 * bar ending a sleep that was running — and stop working when revoked or
 * expired.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4199;
const T = { '.html':'text/html','.css':'text/css','.js':'text/javascript',
            '.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json' };

/* ── the mock server ── */
const rows = new Map();          // household\0id → row
const guests = new Map();        // token → guest
let rev = 0;
const guard = c => { if (!c || c.length < 24) throw new Error('invalid pairing code'); };
const guestRow = t => {
  guard(t);
  const g = guests.get(t);
  if (!g || g.revoked || (g.expires_at != null && g.expires_at <= Date.now())) throw new Error('guest access ended');
  return g;
};
const pullRows = (h, since) => [...rows.values()].filter(r => r.household === h && r.rev > (since || 0))
  .sort((a, b) => a.rev - b.rev).map(({ household, guest, ...r }) => r);

const fns = {
  nayla_sync_push({ p_code, p_rows }) {
    guard(p_code); let m = 0;
    for (const r of p_rows) {
      const key = `${p_code}\0${r.id}`;
      const old = rows.get(key);
      rows.set(key, { ...r, household: p_code, guest: old?.guest ?? null, rev: m = ++rev, updated_at: Date.now() });
    }
    return m;
  },
  nayla_sync_pull({ p_code, p_since }) { guard(p_code); return pullRows(p_code, p_since); },
  nayla_guest_create({ p_code, p_token, p_label, p_baby, p_can_log, p_expires_at }) {
    guard(p_code); guard(p_token);
    guests.set(p_token, { token: p_token, household: p_code, label: p_label, baby: p_baby,
      can_log: p_can_log, created_at: Date.now(), expires_at: p_expires_at, revoked: false });
    return null;
  },
  nayla_guest_list({ p_code }) {
    guard(p_code);
    return [...guests.values()].filter(g => g.household === p_code && !g.revoked &&
      (g.expires_at == null || g.expires_at > Date.now()))
      .map(({ token, label, can_log, created_at, expires_at }) => ({ token, label, can_log, created_at, expires_at }));
  },
  nayla_guest_revoke({ p_code, p_token }) {
    guard(p_code);
    const g = guests.get(p_token);
    if (g && g.household === p_code) g.revoked = true;
    return null;
  },
  nayla_guest_info({ p_token }) {
    const g = guestRow(p_token);
    return { label: g.label, baby: g.baby, can_log: g.can_log, expires_at: g.expires_at };
  },
  nayla_guest_pull({ p_token, p_since }) { return pullRows(guestRow(p_token).household, p_since); },
  nayla_guest_push({ p_token, p_rows }) {
    const g = guestRow(p_token);
    if (!g.can_log) throw new Error('this guest can only view');
    let m = 0;
    for (const r of p_rows) {
      const key = `${g.household}\0${r.id}`;
      const old = rows.get(key);
      const data = { ...(r.data || {}), by: g.label };
      if (!old) {
        rows.set(key, { ...r, data, household: g.household, guest: g.token, rev: m = ++rev, updated_at: Date.now() });
      } else if (old.guest === g.token) {
        rows.set(key, { ...old, ...r, data, rev: m = ++rev, updated_at: Date.now() });
      } else if (old.type === 'sleep' && old.end == null && r.end != null && r.end > old.at) {
        rows.set(key, { ...old, end: r.end, rev: m = ++rev, updated_at: Date.now() });
      }
    }
    return m;
  },
};

const srv = createServer(async (q, res) => {
  const path = decodeURIComponent(q.url.split('?')[0]);
  if (q.method === 'POST' && path.startsWith('/rest/v1/rpc/')) {
    let b = ''; for await (const c of q) b += c;
    const fn = path.split('/').pop();
    try {
      const out = fns[fn](JSON.parse(b || '{}'));
      // PostgREST answers a `returns void` function with 204 and no body.
      if (out == null) { res.writeHead(204); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
    } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: e.message })); }
    return;
  }
  if (path === '/js/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(`const Config = { url: 'http://localhost:${PORT}', anonKey: '' };`); return;
  }
  try { const f = join(ROOT, normalize(path === '/' ? '/index.html' : path)); const body = await readFile(f);
    res.writeHead(200, { 'Content-Type': T[extname(f)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => srv.listen(PORT, r));

const br = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const fails = [], errs = [];
const ok = (n, c, x = '') => { if (!c) fails.push(n); console.log(`${c ? 'PASS' : 'FAIL'} — ${n}${x ? ` (${x})` : ''}`); };

async function phone(label) {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(`${label}: ${e.message}`));
  p.on('dialog', d => d.accept());
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await p.reload(); await p.waitForTimeout(300);
  return { ctx, p, label };
}
const sync = async ph => { await ph.p.evaluate(() => Sync.run()); await ph.p.waitForTimeout(250); };
const tab = async (ph, name) => { await ph.p.click(`.tab[data-tab="${name}"]`); await ph.p.waitForTimeout(200); };
const toastText = ph => ph.p.textContent('#toast');

/* ── the family phone, with a little history ── */
const mum = await phone('mum');
await mum.p.evaluate(() => {
  Store.saveSettings({ name: 'Nayla', dob: '2026-06-04' });
  Store.add({ type: 'feed', at: Date.now() - 2 * 3600000, data: { method: 'bottle', amount: 120 } });
  Store.add({ type: 'sleep', at: Date.now() - 30 * 60000, end: null, data: {} });   // asleep at hand-over
});

await tab(mum, 'settings');
ok('Settings has a Babysitter section', await mum.p.isVisible('#guestAdd'));
await mum.p.click('#guestAdd');
ok('the sheet opens', await mum.p.isVisible('#guestSheet'));
await mum.p.click('#guestCreate');
ok('a name is required', /Add their name/.test(await toastText(mum)) && await mum.p.isVisible('#guestForm'));
await mum.p.fill('#guestForm [name="label"]', 'Kak Ani');
await mum.p.click('[data-until="open"]');
await mum.p.click('#guestCreate');
await mum.p.waitForTimeout(500);
ok('a QR and link appear', await mum.p.isVisible('#guestQr svg'));
const link = await mum.p.evaluate(() => Guest.link(Guest.cached()[0].token));
ok('the link carries a guest token, not the pairing code',
  /#guest=[0-9a-f]{32}$/.test(link) && !link.includes(await mum.p.evaluate(() => Store.settings().syncCode)));
await mum.p.click('#guestClose');
ok('Kak Ani is listed with a Remove button',
  (await mum.p.textContent('#guestList')).includes('Kak Ani') && await mum.p.isVisible('[data-unguest]'));
await sync(mum);

/* ── the babysitter's phone ── */
const ani = await phone('ani');
await ani.p.goto(link); await ani.p.waitForTimeout(1200);
ok('the link is stripped from the address bar', !ani.p.url().includes('guest='));
ok('she sees the family log', (await ani.p.evaluate(() => Store.all().length)) === 2,
  `${await ani.p.evaluate(() => Store.all().length)} records`);
ok('…with the baby\'s name from the family', (await ani.p.evaluate(() => Store.settings().name)) === 'Nayla');
ok('a strip says whose log it is', /Nayla's log, shared with Kak Ani/.test(await ani.p.textContent('#guestBar')));
ok('no Settings tab for a guest', !(await ani.p.isVisible('.tab[data-tab="settings"]')));

// She logs a diaper of her own.
await tab(ani, 'log');
await ani.p.click('[data-log="diaper"]');
await ani.p.click('#entryForm button[type="submit"]');
await ani.p.waitForTimeout(150);
await sync(ani);
await sync(mum);
const fromAni = await mum.p.evaluate(() => Store.byType('diaper')[0]);
ok('the family sees her entry', Boolean(fromAni));
ok('…marked as hers', fromAni?.data.by === 'Kak Ani', JSON.stringify(fromAni?.data));
await tab(mum, 'history');
ok('History says who logged it', (await mum.p.textContent('#historyList')).includes('Kak Ani'));

// She can't change the family's feed.
await tab(ani, 'history');
const feedId = await ani.p.evaluate(() => Store.byType('feed')[0].id);
await ani.p.click(`#historyList [data-entry="${feedId}"]`);
ok('the family\'s entries can\'t be opened to edit', !(await ani.p.isVisible('#sheetBackdrop')) &&
  /only they can change it/.test(await toastText(ani)));
// Even if her phone tried, the server keeps the family's version.
await ani.p.evaluate(id => Store.update(id, { note: 'changed by the sitter' }), feedId);
await sync(ani); await sync(mum);
ok('…and the server refuses it anyway',
  (await mum.p.evaluate(id => Store.get(id).note, feedId)) === '');

// She can end the sleep that was running when she arrived.
await tab(ani, 'log');
await ani.p.click('#sleepToggle');
await sync(ani); await sync(mum);
ok('ending the family\'s running sleep reaches them', await mum.p.evaluate(() => !Store.activeSleep()));

/* ── the family removes her ── */
await tab(mum, 'log');
ok('Log reminds the family she still has access',
  (await mum.p.textContent('#logAlerts')).includes('Kak Ani can see Nayla\'s log'));
await mum.p.click('#logAlerts [data-act^="unguest:"]');
await mum.p.waitForTimeout(400);
ok('"Remove access" ends it', (await mum.p.evaluate(() => Guest.cached().length)) === 0 &&
  !(await mum.p.textContent('#logAlerts')).includes('Kak Ani'));

await ani.p.evaluate(() => Sync.run());
await ani.p.waitForLoadState('load'); await ani.p.waitForTimeout(800);
ok('her phone forgets the log', (await ani.p.evaluate(() => Store.all().length)) === 0);
ok('…and is no longer a guest', !(await ani.p.evaluate(() => Guest.on())));
ok('…and says access ended', await ani.p.isVisible('#guestEnded'));
await ani.p.click('#guestEndedOk');
ok('…which can be dismissed', !(await ani.p.isVisible('#guestEnded')));

/* ── a view-only guest, and an expired one ── */
await mum.p.evaluate(() => Guest.create({ label: 'Grandma', canLog: false, until: null }));
const gLink = await mum.p.evaluate(() => Guest.link(Guest.cached().find(g => g.label === 'Grandma').token));
const gran = await phone('gran');
await gran.p.goto(gLink); await gran.p.waitForTimeout(1200);
await tab(gran, 'log');
ok('view-only: nothing to log with', !(await gran.p.isVisible('#quickGrid')) && !(await gran.p.isVisible('#sleepToggle')));
ok('view-only: the strip says so', /view only/.test(await gran.p.textContent('#guestBar')));

await mum.p.evaluate(() => Guest.create({ label: 'Short', canLog: true, until: Date.now() + 1500 }));
const sLink = await mum.p.evaluate(() => Guest.link(Guest.cached().find(g => g.label === 'Short').token));
const short = await phone('short');
await short.p.goto(sLink); await short.p.waitForTimeout(900);
ok('a timed guest gets in', await short.p.evaluate(() => Guest.on()));
await short.p.waitForTimeout(1200);
await short.p.evaluate(() => Sync.run().catch(() => {}));
await short.p.waitForLoadState('load'); await short.p.waitForTimeout(800);
ok('…and is out once the time is up', !(await short.p.evaluate(() => Guest.on())) &&
  (await short.p.evaluate(() => Store.all().length)) === 0);

/* ── a phone that already has its own log is never mixed in ── */
await mum.p.evaluate(() => Guest.create({ label: 'Other', canLog: true, until: null }));
const oLink = await mum.p.evaluate(() => Guest.link(Guest.cached().find(g => g.label === 'Other').token));
const other = await phone('other');
await other.p.evaluate(() => Store.add({ type: 'feed', at: Date.now(), data: { method: 'left' } }));
await other.p.goto(oLink); await other.p.waitForTimeout(900);
ok('a phone with its own log refuses the link', !(await other.p.evaluate(() => Guest.on())) &&
  /already has a log/.test(await toastText(other)));

console.log(errs.length ? `\npage errors:\n${errs.join('\n')}` : '\nno page errors');
await br.close(); srv.close();
if (fails.length || errs.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log('\nall passed');
