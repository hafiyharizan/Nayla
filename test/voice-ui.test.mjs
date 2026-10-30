/* The microphone flow, with speech recognition stubbed so no mic is needed. */
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
await new Promise(r => srv.listen(4198, r));

const br = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const fails = [], errs = [];
const ok = (n,c,x='') => { if(!c) fails.push(n); console.log(`${c?'PASS':'FAIL'} — ${n}${x?` (${x})`:''}`); };

// A stand-in for the browser's recogniser: whatever we queue, it "hears".
const stub = `
  window.__say = null; window.__fail = null;
  window.SpeechRecognition = class {
    start() {
      setTimeout(() => {
        if (window.__fail) { this.onerror?.({ error: window.__fail }); this.onend?.(); }
        else if (window.__say) { this.onresult?.({ results: [[{ transcript: window.__say }]] }); }
        else this.onend?.();
      }, 20);
    }
    abort() {}
  };
`;

async function phone() {
  const ctx = await br.newContext({ viewport:{width:390,height:844}, timezoneId:'Asia/Kuala_Lumpur' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(stub);
  await p.goto('http://localhost:4198/index.html');
  await p.click('.tab[data-tab="now"]');   // the app opens on Home
  await p.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('nayla.settings.v1', JSON.stringify({
      name:'Nayla', dob:'2026-06-04', units:'ml', syncCode:'', lastPulledAt:0 }));
  });
  await p.reload(); await p.waitForTimeout(400);
  return { ctx, p };
}
const say = async (p, phrase) => {
  await p.evaluate(s => { window.__say = s; window.__fail = null; }, phrase);
  await p.click('#micBtn');
  await p.waitForTimeout(350);
};

const { ctx, p } = await phone();
ok('the mic button shows when the browser supports it', await p.isVisible('#micBtn'));

/* speak a feed → confirm → saved */
await say(p, 'feed 130 ml');
ok('it asks before saving', await p.isVisible('#voiceSheet'));
ok('it repeats what it heard', (await p.textContent('#voiceHeard')).includes('feed 130 ml'));
ok('it says what it will log', (await p.textContent('#voiceSummary')).includes('130 ml'));
ok('nothing saved until confirmed', (await p.evaluate(() => Store.all().length)) === 0);

await p.click('#voiceSave'); await p.waitForTimeout(300);
const rec = await p.evaluate(() => Store.all()[0]);
ok('confirming logs the feed', rec?.type === 'feed' && rec.data.amount === 130,
   JSON.stringify(rec?.data));
ok('sheet closes after saving', !(await p.isVisible('#voiceSheet')));

/* closing without confirming saves nothing */
await say(p, 'wet nappy');
await p.click('#voiceClose'); await p.waitForTimeout(250);
ok('dismissing saves nothing', (await p.evaluate(() => Store.all().length)) === 1);

/* a phrase it cannot read is refused, not guessed */
await say(p, 'what is the weather today');
ok('gibberish is refused rather than guessed', !(await p.isVisible('#voiceSheet')));
ok('and it says so', (await p.textContent('#toast')).includes("Didn't understand"));
ok('still nothing extra saved', (await p.evaluate(() => Store.all().length)) === 1);

/* sleep, then waking by voice closes it */
await say(p, 'she is asleep'); await p.click('#voiceSave'); await p.waitForTimeout(300);
ok('"she is asleep" starts a sleep',
   (await p.evaluate(() => Store.all().some(r => r.type==='sleep' && r.end===null))));
await say(p, 'she woke up');
ok('waking is offered as waking, not a new sleep',
   (await p.textContent('#voiceSummary')).includes('Woke up'));
await p.click('#voiceSave'); await p.waitForTimeout(300);
ok('confirming closes the running sleep',
   !(await p.evaluate(() => Store.all().some(r => r.type==='sleep' && r.end===null))));

/* "Change it" hands over to the normal editor */
await say(p, 'feed 90');
await p.click('#voiceEdit'); await p.waitForTimeout(350);
ok('"Change it" opens the normal editor', await p.isVisible('#sheetBackdrop'));
ok('prefilled with what was heard', (await p.inputValue('input[name="amount"]')) === '90');
await p.click('#sheetClose');

/* a denied microphone is explained */
await p.evaluate(() => { window.__say = null; window.__fail = 'not-allowed'; });
await p.click('#micBtn'); await p.waitForTimeout(350);
ok('a blocked microphone is explained',
   (await p.textContent('#toast')).toLowerCase().includes('microphone'),
   await p.textContent('#toast'));
await ctx.close();

/* no support → no button at all */
const ctx2 = await br.newContext({ viewport:{width:390,height:844} });
const p2 = await ctx2.newPage();
p2.on('pageerror', e => errs.push(e.message));
await p2.addInitScript(`delete window.SpeechRecognition; delete window.webkitSpeechRecognition;`);
await p2.goto('http://localhost:4198/index.html');
await p2.click('.tab[data-tab="now"]');   // the app opens on Home
await p2.waitForTimeout(400);
ok('no button where the browser cannot do voice', !(await p2.isVisible('#micBtn')));
await ctx2.close();

console.log(errs.length ? '\nERRORS:\n' + errs.join('\n') : '\nno console errors');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall passed');
await br.close(); srv.close();
process.exit(fails.length || errs.length ? 1 : 0);
