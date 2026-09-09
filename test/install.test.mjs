import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const ROOT=new URL('..', import.meta.url).pathname;
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const srv=createServer(async(q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';
 try{const f=join(ROOT,normalize(p));const b=await readFile(f);r.writeHead(200,{'Content-Type':T[extname(f)]||'application/octet-stream'});r.end(b);}catch{r.writeHead(404).end();}});
await new Promise(r=>srv.listen(4181,r));

const UA = {
  iphone:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
  ioschrome:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1',
  android:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};
const br=await chromium.launch(
  process.env.PW_CHROMIUM ? {executablePath:process.env.PW_CHROMIUM} : {});
const errs=[];
const fails=[];
const ok=(n,c,x='')=>{ if(!c) fails.push(n); console.log(`${c?'PASS':'FAIL'} — ${n}${x?` (${x})`:''}`); };

async function open(kind, {installed=false, dismissed=false}={}) {
  const ctx=await br.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,
    userAgent:UA[kind], timezoneId:'Asia/Kuala_Lumpur'});
  const p=await ctx.newPage();
  p.on('pageerror',e=>errs.push(`${kind}: ${e.message}`));
  p.on('console',m=>{if(m.type()==='error')errs.push(`${kind}: ${m.text()}`);});
  if (installed) await p.addInitScript(()=>{ window.matchMedia = (q)=>({matches:q.includes('standalone'),addEventListener(){},removeEventListener(){}}); });
  await p.goto('http://localhost:4181/index.html');
  if (dismissed) { await p.evaluate(()=>localStorage.setItem('nayla.install.dismissed','1')); await p.reload(); }
  return {ctx,p};
}

/* ── iPhone Safari: no API, must get illustrated steps ── */
{
  const {ctx,p}=await open('iphone');
  await p.waitForTimeout(3200);
  ok('iPhone: banner appears on its own', await p.isVisible('#installBanner'));
  await p.screenshot({path:`${process.env.SHOT_DIR||'/tmp'}/install-ios-banner.png`});
  await p.click('#installAdd');
  await p.waitForTimeout(400);
  ok('iPhone: tapping Add opens the guide', await p.isVisible('#installGuide'));
  const txt=await p.textContent('#installSteps');
  ok('iPhone: names the Share button', /Share/.test(txt));
  ok('iPhone: names Add to Home Screen', /Add to Home Screen/.test(txt));
  ok('iPhone: draws the iOS glyphs', (await p.locator('#installSteps svg.ios-glyph').count())===2,
     `${await p.locator('#installSteps svg.ios-glyph').count()} glyphs`);
  await p.screenshot({path:`${process.env.SHOT_DIR||'/tmp'}/install-ios-guide.png`, fullPage:true});
  await ctx.close();
}

/* ── Chrome on iOS: cannot install at all, must say so ── */
{
  const {ctx,p}=await open('ioschrome');
  await p.waitForTimeout(3200);
  await p.click('#installAdd');
  await p.waitForTimeout(300);
  const txt=await p.textContent('#installSteps');
  ok('iOS Chrome: told to use Safari', /Safari/.test(txt) && /can't add|cannot add/i.test(txt), txt.slice(0,70).replace(/\s+/g,' '));
  await ctx.close();
}

/* ── Android: beforeinstallprompt drives a one-tap install ── */
{
  const {ctx,p}=await open('android');
  await p.evaluate(()=>{
    window.__prompted=false;
    const e=new Event('beforeinstallprompt');
    e.prompt=()=>{window.__prompted=true;};
    e.userChoice=Promise.resolve({outcome:'accepted'});
    window.dispatchEvent(e);
  });
  await p.waitForTimeout(300);
  ok('Android: banner appears when Chrome offers install', await p.isVisible('#installBanner'));
  await p.click('#installAdd');
  await p.waitForTimeout(400);
  ok('Android: Add triggers the native prompt', await p.evaluate(()=>window.__prompted===true));
  ok('Android: no guide sheet needed', !(await p.isVisible('#installGuide')));
  ok('Android: banner gone after accepting', !(await p.isVisible('#installBanner')));
  ok('Android: remembered, will not nag', await p.evaluate(()=>localStorage.getItem('nayla.install.dismissed')==='1'));
  await ctx.close();
}

/* ── dismissal and the way back ── */
{
  const {ctx,p}=await open('iphone');
  await p.waitForTimeout(3200);
  await p.click('#installLater');
  ok('Not now hides the banner', !(await p.isVisible('#installBanner')));
  await p.reload(); await p.waitForTimeout(3200);
  ok('stays hidden after reload', !(await p.isVisible('#installBanner')));
  await p.click('[data-tab="settings"]'); await p.waitForTimeout(300);
  ok('Settings still offers it', await p.isVisible('#installHelp'));
  await p.click('#installHelp'); await p.waitForTimeout(300);
  ok('Settings route opens the guide', await p.isVisible('#installGuide'));
  await p.screenshot({path:`${process.env.SHOT_DIR||'/tmp'}/install-settings.png`, fullPage:true});
  await ctx.close();
}

/* ── already installed: never nag ── */
{
  const {ctx,p}=await open('iphone',{installed:true});
  await p.waitForTimeout(3200);
  ok('installed app shows no banner', !(await p.isVisible('#installBanner')));
  await p.click('[data-tab="settings"]'); await p.waitForTimeout(300);
  ok('installed app hides the Settings row', !(await p.isVisible('#installRow')));
  await ctx.close();
}

console.log(errs.length? '\nERRORS:\n'+errs.join('\n') : '\nno console errors');
console.log(fails.length? `\n${fails.length} FAILING` : '\nall passed');
await br.close(); srv.close();
process.exit(fails.length||errs.length?1:0);
