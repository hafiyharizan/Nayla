# Nayla

A small web app for tracking a baby's **feeds, diaper changes, sleep, and wake windows**.

Built to be used one-handed on a phone at 3am: big tap targets, a live wake-window
timer on the home screen, and one tap to start or end a sleep.

## Running it

The app has no build step and no dependencies. Serve the folder with any static
server:

```sh
python3 -m http.server 8080
# then open http://localhost:8080
```

Opening `index.html` directly works too, but a server is needed for the offline
service worker and for "Add to Home Screen" to behave like an app.

To use it on a phone, host the folder anywhere static (GitHub Pages, Netlify,
Vercel, a Raspberry Pi) and open it in the phone's browser. The app offers to add
itself to the Home Screen, so nobody has to know how — on Android that's one tap
via Chrome's install prompt, and on iPhone it shows illustrated steps for the
Share menu, since Safari has no install API. It then launches full-screen and
works with no signal.

Anyone who taps "Not now" can find it again under **Settings → This phone**.

## What it does

**Now** — the home screen.
- A ring showing how long Nayla has been awake, filling toward the age-appropriate
  wake window. It turns blue while she's asleep and red once she's past the window.
- Time since the last feed, last diaper, and the length of the last sleep. Tap any
  of them to edit that entry.
- One-tap logging for a feed, diaper, or sleep.
- Today's running totals and the most recent entries.

**History** — every entry grouped by day, with a per-day summary line, filterable by
type. Tap an entry to edit or delete it.

**Stats** — sleep, feeds, diapers, and bottle volume per day over the last 7 days,
with 7-day averages.

**Settings** — name, date of birth (which drives the wake-window guidance and the age
in the header), ml/oz, sync, and backup/restore.

### What gets recorded

| Type | Fields |
| --- | --- |
| Feed | bottle / left / right / solids, amount, duration, time, note |
| Diaper | wet / dirty / both, time, note |
| Sleep | fell asleep, woke up (leave empty while still asleep), note |

## Wake windows

The suggested range comes from Nayla's age:

| Age | Wake window |
| --- | --- |
| 0–1 month | 45–60 min |
| 1–2 months | 60–90 min |
| 2–3 months | 75–105 min |
| 3–4 months | 90–120 min |
| 4–6 months | 2–2.5 hr |
| 6–9 months | 2.5–3 hr |
| 9–12 months | 3–4 hr |
| 12–18 months | 4–5 hr |
| 18+ months | 5–6 hr |

These are the commonly cited ranges, meant as a starting point — not medical advice.
Follow your baby's cues, and take any concerns to your paediatrician.

## Sharing one log between two phones

Setup is one scan. On the first phone, **Settings → Sync → Start sharing this
log** shows a QR code; point the second phone's camera at it and tap the link
that appears. That's the whole thing — the second phone configures itself and
pulls the history down immediately.

The pairing code rides in the URL's `#fragment`, which browsers never send to
the server, so the secret stays between the two phones even though the page
itself is public. It's stripped from the address bar the moment it's used, so
it doesn't linger in history or in a screenshot. Anyone apart can use **Send the
link instead**, with the obvious caveat that whoever receives it can read and
write the log.

After that, entries appear on the other phone on their own: each phone syncs
when it's opened, when it comes back to the foreground, a couple of seconds
after anything is logged, and once a minute while it's open.

### How it works


Sync is off by default, and the app is fully usable without it. Turn it on and both
parents' phones keep the same log — one logs a feed at home, the other sees it at work.

Setup is a migration to run once and a few fields under **Settings → Sync**. Two ways
to host it:

- **Hosted Supabase** — see [`supabase/README.md`](supabase/README.md).
- **Your own VPS** — Postgres, PostgREST and Caddy on a small box, about $5–7/month.
  See [`deploy/README.md`](deploy/README.md).

The app is identical either way: it speaks plain PostgREST, so moving between them is
a URL change and a `pg_dump`.

How it behaves:

- `localStorage` stays the source of truth, so the app never waits on the network.
  Everything works offline exactly as before.
- Changes made with no signal queue up and drain when the phone reconnects.
- The server assigns every record a revision from one sequence, so ordering doesn't
  depend on either phone's clock being right.
- Merging is per entry, keyed by a unique id, so entries made on the two phones never
  overwrite each other — they both survive. Last-write-wins applies only when the same
  entry is edited in both places, and the worst case there is one edit of one entry
  losing to a later one.
- Every pull re-reads a window of recent revisions rather than trusting the cursor
  exactly. Postgres assigns a revision number when a push starts, not when it commits,
  so a pull can see revision 12 while 11 is still in flight; advancing the cursor to 12
  would strand that entry permanently. The overlap closes that, and a full resync every
  12 hours is the backstop for anything wider.
- Deletes travel as tombstones, so removing an entry on one phone removes it on both.

## Your data

With sync off, everything lives in `localStorage` in the browser you use it in, and
nothing is sent anywhere — no server, no account, no analytics.

With sync on, the log is also stored on whichever server you point it at. The pairing
code is a bearer secret: anyone holding it can read and write the log, so share it
directly between the phones. Backups deliberately omit it.

Either way, keep backups. **Settings → Export JSON** is a full backup and **Import**
restores it (also how you move to a new phone); **Export CSV** is for looking at the
numbers in a spreadsheet. Clearing the browser's site data deletes the local log.

## Layout

```
index.html            markup for all four views plus the entry sheet
styles.css            design tokens, light + dark, mobile-first
js/config.js          where to sync to (empty = local only)
js/format.js          durations, clock times, day labels, ml/oz
js/features.js        the feature registry — what a feed, diaper or sleep IS
js/store.js           records + settings, persisted to localStorage
js/sync.js            push/pull/merge against the backend
js/qr.js              a small QR encoder, for the pairing code
js/pair.js            pairing by scan or link
js/wake.js            wake-window ranges and current awake/asleep state
js/sheet.js           the add/edit sheet, rendered from a feature's fields
js/app.js             views, live timers, stats, import/export
sw.js                 offline caching
supabase/             the sync backend: one table, two functions
deploy/               that same backend on a VPS, behind Caddy
test/                 browser tests (npm test)
```

### Adding a feature

Everything the app records — feeds now, growth and photos later — is one record
shape: `{ id, type, at, end, note, data, updatedAt, rev, dirty, deleted }`. A
feature declares its icon, its form fields, and how to describe and tally itself
in `js/features.js`; the history list, the edit sheet, the daily summaries,
export and sync all pick it up without changes, because none of them know what a
feed is.

Sync in particular is type-agnostic, so a new feature arrives already syncing.

## Importing an existing log

If you tracked feeds in a WhatsApp group before this app existed,
`tools/import-whatsapp.py` reads an exported chat and produces a backup file
you can load with **Settings → Data → Import**:

```sh
python3 tools/import-whatsapp.py _chat.txt -o nayla-import.json
```

It understands the shorthand two tired parents actually use — `7.30 pm - nappy
change`, `10.15 pm feed 100ml`, bare `🍼 130 mls`, `💤` and `🌅`, Malay
(`berak`, `bangun`), amounts arriving in a later message (`^100ml`, `+ 80 mls`),
and times written after the fact. It pairs each `💤` with the wake that follows
it, and where no wake was written down it closes the sleep at the next entry and
says so in that record's note.

It prints a report of everything it could not read, so nothing disappears
silently, and it never invents a value it did not see: a feed logged without an
amount stays without one. Read the report before importing — **Import replaces
the whole log**, so export a backup first if you already have entries.

## Tests

```sh
npm install && npm test
```

See [`test/README.md`](test/README.md) for what's covered.
