/* A deploy reaches a phone whole, never half old and half new.
 *
 * GitHub Pages sends every file with "Cache-Control: max-age=600". The
 * service worker fetches fresh copies first, but a plain fetch() is happy
 * with the browser's ten-minute copy — so right after a deploy a phone
 * could get the new index.html with the old home.js, and Home stopped
 * drawing after the photo. This serves the app with that same header,
 * "deploys" a change, and checks the next load gets it.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4197;
const T = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript',
  '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };

let deployed = 1;                  // which "deploy" the server is on
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('null'); return; }
  if (path === '/js/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'max-age=600' });
    res.end(`const Config = { url: '', anonKey: '' };`);
    return;
  }
  try {
    const file = join(ROOT, normalize(path === '/' ? '/index.html' : path));
    let body = await readFile(file, 'utf8').catch(() => readFile(file));
    // The marker a deploy changes: a line at the end of home.js.
    if (path === '/js/home.js') body += `\nwindow.DEPLOYED = ${deployed};\n`;
    res.writeHead(200, {
      'Content-Type': T[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'max-age=600',             // as GitHub Pages sends it
      'ETag': `"${path}-${path === '/js/home.js' ? deployed : 0}"`,
    });
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

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });

/** Opening the app afresh, as tapping its icon does: a new page each time,
 *  so nothing comes from the old page's memory. */
async function open() {
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.waitForTimeout(400);
  return p;
}

let p = await open();
await p.evaluate(() => navigator.serviceWorker.ready);
await p.close();
p = await open();                                    // now under the worker
ok('the service worker controls the page', await p.evaluate(() => Boolean(navigator.serviceWorker.controller)));
ok('first load has the first deploy', (await p.evaluate(() => window.DEPLOYED)) === 1);
await p.close();

deployed = 2;                                        // a new version goes live
p = await open();
ok('the next open has the new deploy, not a ten-minute-old copy',
  (await p.evaluate(() => window.DEPLOYED)) === 2, `got deploy ${await p.evaluate(() => window.DEPLOYED)}`);
ok('Home draws its Today tiles', (await p.locator('#homeSummary .sum-tile').count()) > 0);
await p.close();

// Offline, the copy it last fetched opens — the new deploy, not the one the
// worker cached when it installed.
await ctx.setOffline(true);
p = await open();
ok('offline, the last copy still opens', (await p.evaluate(() => window.DEPLOYED)) === 2
  && (await p.locator('#homeSummary .sum-tile').count()) > 0);
await ctx.setOffline(false);

await browser.close();
server.close();

if (errs.length) { console.log('\nconsole errors:'); errs.forEach(e => console.log('  ' + e)); }
else console.log('\nno console errors');
if (fails.length || errs.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log('\nall passed');
