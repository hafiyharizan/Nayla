/* First run: a new phone asks for the baby's name, birthday and growth chart
 * before anything else — and a phone already in use never sees it. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4199;
const T = { '.html':'text/html','.css':'text/css','.js':'text/javascript',
            '.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json' };

const srv = createServer(async (q, r) => {
  const path = decodeURIComponent(q.url.split('?')[0]);
  if (q.method === 'POST') { r.writeHead(200, {'Content-Type':'application/json'}); r.end('[]'); return; }
  const p = path === '/' ? '/index.html' : path;
  if (p === '/js/config.js') {        // local-only: no backend
    r.writeHead(200, {'Content-Type':'text/javascript'});
    r.end(`const Config = { url: '', anonKey: '' };`);
    return;
  }
  try {
    const body = await readFile(join(ROOT, normalize(p)));
    r.writeHead(200, {'Content-Type': T[extname(p)] || 'application/octet-stream'}); r.end(body);
  } catch { r.writeHead(404); r.end(); }
}).listen(PORT);

const fails = [], errs = [];
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} — ${name}${extra && !cond ? ` (${extra})` : ''}`);
  if (!cond) fails.push(name);
};

const br = await chromium.launch();
async function phone(seed) {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  if (seed) await ctx.addInitScript(s => {
    if (!sessionStorage.getItem('seeded')) {
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v));
      sessionStorage.setItem('seeded', '1');
    }
  }, seed);
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.waitForTimeout(200);
  return { ctx, p };
}
const visible = (p, sel) => p.locator(sel).isVisible();

/* ── a brand-new phone ─────────────────────────────────────── */
{
  const { ctx, p } = await phone();
  ok('a new phone opens on the setup screen', await visible(p, '#setup'));
  ok('no one\'s baby is built in', (await p.evaluate(() => Store.settings().name)) === '' &&
     (await p.evaluate(() => Store.settings().dob)) === '');

  await p.click('#setupForm button[type="submit"]');
  ok('a birthday is required', (await p.textContent('#setupError')).includes('date of birth'));
  ok('…and the screen stays', await visible(p, '#setup'));

  await p.fill('#setupDob', '2099-01-01');
  await p.click('#setupForm button[type="submit"]');
  ok('a birthday in the future is refused', (await p.textContent('#setupError')).includes('future'));

  const d = new Date(Date.now() - 40 * 86400000);
  const dob = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await p.fill('#setupDob', dob);
  await p.click('#setupForm button[type="submit"]');
  ok('a growth chart is required', (await p.textContent('#setupError')).includes('girl or boy'));

  await p.fill('#setupName', '  Adam  ');
  await p.click('#setupSex button[data-value="boy"]');
  ok('the chosen chart is marked', (await p.getAttribute('#setupSex button[data-value="boy"]', 'aria-checked')) === 'true');
  await p.click('#setupForm button[type="submit"]');

  ok('setup closes once answered', !(await visible(p, '#setup')));
  const s = await p.evaluate(() => Store.settings());
  ok('name, birthday and chart are saved', s.name === 'Adam' && s.dob === dob && s.sex === 'boy' && s.setupDone === true,
     JSON.stringify({ name: s.name, dob: s.dob, sex: s.sex, setupDone: s.setupDone }));
  ok('the header shows the name', (await p.textContent('#babyName')).trim() === 'Adam');
  ok('…and an age', /week|month|day/.test(await p.textContent('#babyAge')));

  await p.reload(); await p.waitForTimeout(200);
  ok('it does not ask again after a reload', !(await visible(p, '#setup')));
  await ctx.close();
}

/* ── a name is optional ────────────────────────────────────── */
{
  const { ctx, p } = await phone();
  await p.fill('#setupDob', '2026-01-15');
  await p.click('#setupSex button[data-value="girl"]');
  await p.click('#setupForm button[type="submit"]');
  ok('no name is fine — it says Baby', !(await visible(p, '#setup')) &&
     (await p.textContent('#babyName')).trim() === 'Baby');
  await ctx.close();
}

/* ── phones already in use, from before this screen existed ── */
{
  const { ctx, p } = await phone({ 'nayla.settings.v1': { name: 'Nayla', dob: '2026-06-04', units: 'ml' } });
  ok('a phone with her details already is not asked', !(await visible(p, '#setup')));
  ok('…and keeps them', (await p.evaluate(() => Store.settings().name)) === 'Nayla');
  await ctx.close();
}
{
  const { ctx, p } = await phone({ 'nayla.records.v2': [
    { id: 'a1', type: 'diaper', at: Date.now() - 3600000, end: null, note: '', data: { kind: 'wet' },
      updatedAt: Date.now(), rev: 0, dirty: true, deleted: false },
  ] });
  ok('a phone with a log but no settings is not asked', !(await visible(p, '#setup')));
  await ctx.close();
}

/* ── a babysitter's phone gets the family's details instead ── */
{
  const { ctx, p } = await phone({ 'nayla.settings.v1': { guestToken: 'g'.repeat(32), guestLabel: 'Kak Ani', name: 'Nayla' } });
  ok('a guest phone is not asked', !(await visible(p, '#setup')));
  await ctx.close();
}

console.log(errs.length ? '\nERRORS:\n' + errs.join('\n') : '\nno console errors');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall passed');
await br.close(); srv.close();
process.exit(fails.length || errs.length ? 1 : 0);
