/* The voice parser, exhaustively — no microphone needed.
 *
 * This is the half worth testing hard: mishearing "forty" as "fourteen"
 * writes a wrong number into a feed log, and nobody notices for weeks.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const Voice = require(join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'voice.js'));

const NOW = new Date('2026-10-21T14:00:00+08:00').getTime();
const fails = [];
const ok = (name, cond, extra = '') => {
  if (!cond) fails.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
};

const p = phrase => Voice.parse(phrase, NOW);
const mins = (at) => Math.round((NOW - at) / 60000);

/* ── feeds ─────────────────────────────────────────────────── */
const feeds = [
  ['feed 130 ml', 130], ['feed 130ml', 130], ['feed 130 mls', 130],
  ['bottle 90', 90], ['gave her 110 ml', 110], ['she drank 75 ml', 75],
  ['130 ml feed', 130], ['fed her 100', 100], ['milk 60 ml', 60],
  ['feed one hundred and thirty', 130], ['bottle forty ml', 40],
  ['feed ninety', 90], ['formula 125', 125],
];
for (const [phrase, amount] of feeds) {
  const r = p(phrase);
  ok(`"${phrase}" → ${amount} ml`,
     r?.record?.type === 'feed' && r.record.data.amount === amount,
     r ? `got ${r.record?.data?.amount}` : 'no match');
}
ok('a feed with no amount stays without one',
   p('feed')?.record?.data?.amount === null);
ok('"left breast" is a feed, not 0 ml',
   p('left breast')?.record?.data?.method === 'left' &&
   p('left breast')?.record?.data?.amount === null);
ok('"right breast" picks the right side',
   p('right breast')?.record?.data?.method === 'right');

/* ── diapers ───────────────────────────────────────────────── */
const diapers = [
  ['wet nappy', 'wet'], ['wet diaper', 'wet'], ['she is wet', 'wet'],
  ['dirty nappy', 'dirty'], ['dirty diaper', 'dirty'], ['poo', 'dirty'],
  ['she pooped', 'dirty'], ['wet and dirty', 'both'],
  ['nappy change wet and dirty', 'both'], ['nappy change', 'wet'],
];
for (const [phrase, kind] of diapers) {
  const r = p(phrase);
  ok(`"${phrase}" → ${kind}`,
     r?.record?.type === 'diaper' && r.record.data.kind === kind,
     r ? `got ${r.record?.data?.kind}` : 'no match');
}

/* ── sleep and waking ──────────────────────────────────────── */
for (const phrase of ['sleep', 'she is asleep', 'going down for a nap', 'put her to bed']) {
  ok(`"${phrase}" starts a sleep`, p(phrase)?.record?.type === 'sleep');
}
for (const phrase of ['woke up', 'she is awake', 'wake up', 'she woke up from her nap']) {
  ok(`"${phrase}" closes a sleep`, p(phrase)?.kind === 'wake');
}
ok('waking wins over the word "nap" in the same phrase',
   p('she woke up from her nap')?.kind === 'wake');

/* ── when ──────────────────────────────────────────────────── */
ok('"10 minutes ago"', mins(p('wet nappy 10 minutes ago').record.at) === 10);
ok('"twenty minutes ago"', mins(p('feed 100 twenty minutes ago').record.at) === 20);
ok('"an hour ago"', mins(p('wet nappy an hour ago').record.at) === 60);
ok('"half an hour ago"', mins(p('wet nappy half an hour ago').record.at) === 30);
ok('no time said means now', mins(p('wet nappy').record.at) === 0);

// The one that would quietly corrupt the log
const tricky = p('feed 130 ml 20 minutes ago');
ok('"feed 130 ml 20 minutes ago" keeps 130 as the amount',
   tricky.record.data.amount === 130, `got ${tricky.record.data.amount}`);
ok('...and 20 as the minutes', mins(tricky.record.at) === 20, `got ${mins(tricky.record.at)}`);

const at730 = p('feed 100 at 7:30 am');
ok('"at 7:30 am" lands at 07:30', new Date(at730.record.at).getHours() === 7 &&
   new Date(at730.record.at).getMinutes() === 30);
const at9pm = p('wet nappy at 9 pm');
ok('a time still ahead today is read as yesterday',
   at9pm.record.at < NOW, new Date(at9pm.record.at).toISOString());

/* ── refusing to guess ─────────────────────────────────────── */
for (const phrase of ['', '   ', 'what is the weather', 'hello there', 'call mum']) {
  ok(`"${phrase.trim() || '(empty)'}" is refused rather than guessed`, p(phrase) === null);
}

/* ── numbers ───────────────────────────────────────────────── */
const numbers = [['forty', 40], ['fourteen', 14], ['one hundred', 100],
                 ['one hundred and five', 105], ['ninety five', 95], ['130', 130]];
for (const [word, n] of numbers) {
  ok(`"${word}" → ${n}`, Voice.toNumber(word) === n, `got ${Voice.toNumber(word)}`);
}

console.log(fails.length ? `\n${fails.length} FAILING` : '\nall passed');
process.exit(fails.length ? 1 : 0);
