/* A "Start sleep" that never got its "Woke up".
 *
 * Seen in the wild: the Now screen read "Asleep for 99h 40m" four days after
 * someone tapped Start sleep and forgot. The ring counted up indefinitely,
 * the wake window was unusable, and today's totals read 0m sleep at the same
 * time — because an open record was being treated as zero-length when
 * deciding which day it belonged to.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const T = { '.html':'text/html','.css':'text/css','.js':'text/javascript',
            '.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json' };
const srv = createServer(async (q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/js/config.js') {
    r.writeHead(200, {'Content-Type':'text/javascript'});
    r.end('const Config = { url: "", anonKey: "" };'); return;
  }
  try { const f = join(ROOT, normalize(p)); const b = await readFile(f);
    r.writeHead(200, {'Content-Type': T[extname(f)] || 'application/octet-stream'}); r.end(b);
  } catch { r.writeHead(404).end(); }
});
await new Promise(r => srv.listen(4195, r));

const br = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await br.newContext({ viewport:{width:390,height:844}, timezoneId:'Asia/Kuala_Lumpur' });
const page = await ctx.newPage();
const errs = [], fails = [];
page.on('pageerror', e => errs.push(e.message));
const ok = (n,c,x='') => { if(!c) fails.push(n); console.log(`${c?'PASS':'FAIL'} — ${n}${x?` (${x})`:''}`); };

await page.goto('http://localhost:4195/index.html');

// Four days ago: a sleep started and never closed. Plus a real completed
// sleep and a feed just before it, as the real log had.
await page.evaluate(() => {
  const H = 3600000, now = Date.now();
  localStorage.clear();
  localStorage.setItem('nayla.settings.v1', JSON.stringify({
    name:'Nayla', dob:'2026-06-04', units:'ml', syncCode:'', lastPulledAt:0 }));
  localStorage.setItem('nayla.records.v2', JSON.stringify([
    { id:'openSleep', type:'sleep', at: now - 99*H, end: null, note:'', data:{},
      updatedAt: now, rev:1, dirty:false, deleted:false },
    { id:'goodSleep', type:'sleep', at: now - 105*H, end: now - 102*H, note:'', data:{},
      updatedAt: now, rev:2, dirty:false, deleted:false },
    { id:'feed1', type:'feed', at: now - 100*H, end:null, note:'',
      data:{ method:'bottle', amount:130 }, updatedAt: now, rev:3, dirty:false, deleted:false },
  ]));
});
await page.reload(); await page.waitForTimeout(500);

const value = await page.textContent('#wakeValue');
const label = await page.textContent('#wakeLabel');
ok('does not claim she is still asleep', label.trim() !== 'Asleep for', `${label.trim()}`);
ok('no absurd duration on the ring', !/\d{2,}h/.test(value), `showed "${value.trim()}"`);
ok('the stuck sleep is surfaced', await page.isVisible('#fixSleep'));
const fixText = await page.textContent('#fixSleep');
ok('it says which sleep and when', /never closed/.test(fixText) && /\d/.test(fixText), fixText.trim());

// Tapping it opens that record so the wake time can be set or it can be deleted
await page.click('#fixSleep'); await page.waitForTimeout(300);
ok('tapping it opens the entry to fix', await page.isVisible('#sheetBackdrop'));
ok('it opened the right record', (await page.inputValue('input[name="at"]')).length > 0);
await page.click('#sheetClose'); await page.waitForTimeout(200);

// The sleep button must not close a four-day-old sleep
await page.click('#sleepToggle'); await page.waitForTimeout(300);
const openCount = await page.evaluate(() =>
  Store.all().filter(r => r.type === 'sleep' && r.end == null).length);
ok('Start sleep begins a NEW sleep, not closing the stale one',
   openCount === 2, `${openCount} open sleeps`);
const stillOpen = await page.evaluate(() => Store.get('openSleep')?.end === null);
ok('the four-day-old sleep was left untouched', stillOpen);

// Deleting it restores a sane screen
await page.evaluate(() => Store.remove('openSleep'));
await page.evaluate(() => Store.remove(Store.all().find(r => r.type==='sleep' && r.end==null)?.id));
await page.waitForTimeout(300);
ok('prompt disappears once fixed', !(await page.isVisible('#fixSleep')));

// And the day-totals bug: a nap running since before midnight counts today
await page.evaluate(() => {
  const now = Date.now();
  const midnight = new Date(); midnight.setHours(0,0,0,0);
  Store.add({ type:'sleep', at: midnight.getTime() - 2*3600000, end: null, data:{} });
});
await page.waitForTimeout(300);
// Read the Sleep cell itself rather than regex-matching the whole summary —
// "0m" is a substring of "30m", which made this pass or fail by the minute.
const sleepCell = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('#todaySummary .today-cell')];
  const cell = cells.find(c => c.querySelector('span')?.textContent === 'Sleep');
  return cell ? cell.querySelector('b').textContent.trim() : null;
});
ok('an in-progress overnight nap counts toward today',
   sleepCell !== null && sleepCell !== '0m', `Sleep cell showed "${sleepCell}"`);

console.log(errs.length ? '\nERRORS:\n' + errs.join('\n') : '\nno console errors');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall passed');
await br.close(); srv.close();
process.exit(fails.length || errs.length ? 1 : 0);
