# Nayla

A small web app for tracking a baby's **feeds, diaper changes, sleep and wake windows** —
plus **solid food, growth and milestones** as she gets older.

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

**Home** — where the app opens: an overview to look at, sized to fit one phone
screen. There is nothing to log from here; that's all on **Log**.
- A header photo with her name and age. Tap 📷 to pick one; it stays on that phone
  and is never uploaded. Until one is picked, the newest milestone photo stands in.
  **Settings → Baby → Remove home photo** takes it away again.
- **Since last** — how long she has been awake (or asleep), and the time since her
  last feed and diaper.
- **Today** — feeds, sleep, diapers and solid meals since her day began (see *Her
  day* below), each against what she usually has *by this time of day* over
  the last 7 days (so 9am isn't compared with a whole day), with a badge —
  **↑ 3 more**, **↓ 1h less** or **On track** — and the last 7 days drawn small, with
  a dashed line at her average day. Tap a tile to open its full 7-day chart (feeds
  open bottle volume too): a column per day, today on the right with its value.
  Tap a day to read it out; tap again to go back. Tap the tile again to close it.
- **Growing** — her latest weight, length and head size with their WHO percentiles.
  Tap it to open the Growing tab.

The top of Home says hello by the hour (with a **Night shift** for the 3am feed) and
counts her age in days. Cards rise in when you open the tab.

The app always opens on Home; a reload (such as the one after an update) keeps you on
the tab you were using.

**Log** — everything you tap (it used to be called **Now**).
- A ring showing how long Nayla has been awake, filling toward the age-appropriate
  wake window, with the button to start or end a sleep beside it. It turns blue while
  she's asleep and red once she's past the window.
- One-tap logging for a feed, diaper, sleep, bath, a dose of medicine, or a solid
  meal, and **Say it instead** for voice.
- **Right now** — up to five alerts worked out from the log, most urgent first:
  a sleep left running, a first allergen to watch for the next two hours,
  fewer wet diapers than usual late in the day, a reaction noted, her
  month-birthdays, and gentle suggestions (starting solids around 6 months, common
  allergens not tried yet, measurements due). Each can be dismissed — for the day,
  or a week for suggestions — and only trackers that are on produce alerts. With
  nothing to say it says **All calm**.
- **Next up** — what she probably needs next, most urgent first, marked **Now**,
  **Soon**, or with a time ("Next feed around 4:40 PM"):
  - **Feed** — due once her usual gap between feeds has passed (worked out from the
    last three days), or an age-based one until there's enough history (about every
    2h for a newborn, 3h at 3–6 months). While she sleeps it says *feed her when she
    wakes*.
  - **Sleep** — awake past her wake window: *time for her to sleep*. A daytime nap
    past about 2h (2½h under 3 months): *time to wake her*. Night sleep is left
    alone, except that a newborn who hasn't fed for 4h is woken for a feed.
  - **Diaper** — a check every 2–4h depending on age and her usual rhythm; not while
    she sleeps at night.
  - **Bath** — from her own rhythm once three baths are logged, otherwise every two
    days; only suggested in the daytime while she's awake.

  Each due item has a button to log it, or to start or end the sleep.
- The most recent entries. Tap one to edit it.

While something on Log needs doing now — a warning under **Right now**, or a
**Next up** item marked **Now** — the Log tab carries a red dot, so it shows from Home.

**Growing** — the slow-moving things, looked back on over months.
- **Growth:** latest weight, length and head size, each with its WHO percentile, and
  her line drawn over the WHO growth chart (birth to two years). Tap a tile to switch
  the chart, tap a dot to read it.
- **Milestones:** firsts with a date, her age at the time, and an optional photo.
  A photo stays on the phone that took it unless you switch on **Share photo with
  the other phone** for that milestone — see [Photos](#photos).
- **Foods tried:** every food she has had, when she first had it, how it went, any
  reaction noted — and which of the nine common allergens she has had so far. Logging
  the first taste of one shows a reminder to keep an eye on her for a couple of hours.

**History** — every entry grouped by day, with a per-day summary line, filterable by
type. Tap an entry to edit or delete it.

**Settings** — name, date of birth (which drives the wake-window guidance, the growth
chart and the age in the header), ml/oz, girl/boy chart, kg+cm or lb+in, when her
day starts, which trackers to show, sync, and backup/restore.

### Her day: when a day starts

**Settings → Her day** picks when one day ends and the next begins, per phone:

- **Midnight** — the default: calendar days.
- **A time I choose** — say 6:00am, so the night belongs to the day before it.
- **Sunrise** — worked out each day for where you are.
- **Subuh** — dawn (Fajr), with a choice of calculation: Malaysia, Singapore and
  Indonesia (20°, the default), Muslim World League (18°), Umm al-Qura (18.5°),
  Egypt (19.5°) or ISNA (15°). It can differ from your mosque's timetable by a few
  minutes.

Whichever it is, **an entry counts on the day it started — a sleep in full** — so
10pm to 3am is one sleep on one day, never two hours on one and three on the next.
It applies everywhere a day is added up: Today and the 7-day charts on Home,
History's day groups, and when a dismissed alert comes back. Home's Today header says
when her day began ("since midnight", "since Subuh, 4:37 AM").

Sunrise and Subuh are worked out on the phone (the NOAA formulas, within a minute or
two of an almanac) from a location shared once with **Use my location**. It is rounded
to about a kilometre, kept on that phone only, and left out of backups. Until a phone
has it — or on a day the sun never gets that low — the day starts at the set time.

### Turning trackers on and off

**Settings → Trackers** has a switch for each of the eight. Turning one off hides it
everywhere on that phone — its button, its Today total, its History filter, its
section of Growing — but deletes nothing: the entries stay, keep syncing, and come
back the moment it's turned on again. Turning sleep off also hides the wake-window
ring, which depends on it. The switches are per phone, so each parent can keep their
own screen as simple as they like. At least one has to stay on.

### What gets recorded

| Type | Fields |
| --- | --- |
| Feed | bottle / left / right, amount, duration, time, note |
| Diaper | wet / dirty / both, time, note |
| Sleep | fell asleep, woke up (leave empty while still asleep), note |
| Solids | foods, how much, how it went, signs of a reaction, time, note |
| Growth | weight, length, head circumference (any of them), date, note |
| Milestone | what happened, date, photo, note |

Feeds logged as "Solids" before the solids tracker existed keep their label. The
option reappears on the feed form whenever the solids tracker is switched off.

### Growth percentiles

Percentiles come from the [WHO Child Growth Standards](https://www.who.int/tools/child-growth-standards)
— the charts most clinic health books use — via the published L, M, S parameters
for each month of age (`js/who.js`), interpolated between months. They cover birth to
24 months. Below the 3rd or above the 97th the app says so in words rather than
printing a number. A percentile describes, it doesn't diagnose: the shape of her
line over several visits says far more than any single dot.

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

Any number of phones can share one log — the pairing code names a household,
and the server keys every row by that household, so a third or fourth phone is
the same scan as the second. Setup is one scan. On the first phone, **Settings → Sync → Start sharing this
log** shows a QR code; point the second phone's camera at it and tap the link
that appears. That's the whole thing — the second phone configures itself and
pulls the history down immediately.

The pairing code rides in the URL's `#fragment`, which browsers never send to
the server, so the secret stays between the two phones even though the page
itself is public. It's stripped from the address bar the moment it's used, so
it doesn't linger in history or in a screenshot. Anyone apart can use **Send the
link instead**, with the obvious caveat that whoever receives it can read and
write the log.

After that, entries appear on the other phone on their own — nobody presses
anything. A phone uploads what you log about two seconds later, and pulls when
it's opened, when it comes back to the foreground, and on a timer while it sits
open: every 10 seconds for the first couple of minutes, then once a minute once
it's clear nobody is watching it.

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
- Changing the pairing code moves the whole log across to the new household,
  rather than leaving it stranded under the old one. The same path carries a
  phone's own entries into a shared log the first time it pairs.
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

## Medicine

**Medicine** logs a dose: the medicine, the dose ("2.5 ml"), optionally her temperature,
and when. On Home, Next up then says when another dose would be within the usual
label limits — for paracetamol (Panadol, Calpol, Uphamol) at least 4 hours apart and no
more than 4 doses in 24 hours, for ibuprofen (Nurofen, Brufen) 6 hours and 3 doses —
counting Panadol and Calpol as the same medicine. It never tells you to give a dose,
only when one would be allowed; anything else is shown as "given 3h ago". The label
and your doctor come first.

## Babysitter access

**Settings → Babysitter → Give a babysitter access** makes a link for someone looking
after her for a while: their name, how long (until tonight, 24 hours, or until you
remove it) and whether they can log too. They scan the QR or open the link, and their
phone shows her log — Home, Log, Growing and History, with a strip across the top
saying whose log it is and until when, and no Settings.

- They never get the pairing code. The link carries a token of its own, so removing
  them never means re-pairing your phones.
- If they can log, their entries show up on your phones marked **by Kak Ani**. They can
  change only what they logged — and end a sleep that was running when you handed her
  over — but never your entries. The server enforces this, not the app.
- While someone has access, Home reminds you, with a **Remove access** button.
  Removing them (or the time running out) is checked by the server on every sync; the
  next time their phone connects, it wipes the log and says access has ended. A phone
  that was offline also wipes itself once the end time passes.
- What they've already seen can't be un-seen — a screenshot is a screenshot — so
  this is about not leaving access open, not about secrecy.
- The link refuses to open on a phone that already has a log in this app (a family
  phone, or a babysitter tracking her own baby), so two families' entries never mix.

This needs `supabase/migrations/0005_guests.sql` applied on the server.

## Your data

With sync off, everything lives in `localStorage` in the browser you use it in, and
nothing is sent anywhere — no server, no account, no analytics.

With sync on, the log is also stored on whichever server you point it at. The pairing
code is a bearer secret: anyone holding it can read and write the log, so share it
directly between the phones. Backups deliberately omit it.

Either way, keep backups. **Settings → Export JSON** is a full backup and **Import**
restores it (also how you move to a new phone); **Export CSV** is for looking at the
numbers in a spreadsheet. Clearing the browser's site data deletes the local log.

### Photos

Milestone photos are private by default: they stay on the phone that took them, in
IndexedDB, shrunk to 1280px (150–300 KB each). The other phone sees the milestone,
with "On the other phone" where the photo would be.

Switch on **Share photo with the other phone** on a milestone and that one photo is
encrypted on the phone (AES-GCM, 256-bit) before it uploads. The key is not the
pairing code — the pairing code goes to the server on every sync — but a separate
random key that only ever travels inside the pairing QR code, in the URL fragment
browsers never send anywhere. So the server, and whoever runs it, holds only
scrambled data; and since `0004_encrypted_photos.sql` the server refuses anything
that isn't encrypted.

Phones paired before this existed have no key yet: open **Settings → Sync → Add
another phone** on one and scan it with the other, once.

Which photos are on the server follows the milestones themselves. Unsharing a
photo, replacing it, deleting the milestone, **Delete all**, and a new pairing code
all take the old copy off the server, and the other phone drops its copy once a
photo is no longer shared. **Send…** on a photo hands it to the phone's own share
sheet (WhatsApp, AirDrop) for sending without the server at all.

A JSON backup holds the milestones but not the photos, nor the photo key.

## Layout

```
index.html            markup for the five tabs plus the entry sheet
styles.css            design tokens, light + dark, mobile-first
js/config.js          where to sync to (empty = local only)
js/format.js          durations, clock times, day labels, ml/oz, kg/lb, cm/in
js/who.js             WHO growth standards (0–24 months) and percentile maths
js/features.js        the feature registry — what a feed, a meal or a milestone IS
js/store.js           records + settings, persisted to localStorage
js/day.js             when her day starts (midnight/time/sunrise/Subuh), adding a day up
js/sync.js            push/pull/merge against the backend
js/guest.js           babysitter access: guest links, and the guest's view
js/photos.js          milestone photos: kept on the phone; shared ones encrypted
js/qr.js              a small QR encoder, for the pairing code
js/pair.js            pairing by scan or link
js/wake.js            wake-window ranges and current awake/asleep state
js/sheet.js           the add/edit sheet, rendered from a feature's fields
js/growing.js         the Growing tab: growth chart, milestones, foods tried
js/next.js            Next up: when to feed, sleep, wake, change, bathe; next dose
js/home.js            the Home tab: header photo, alerts, Today, the 7-day charts
js/app.js             views, live timers, stats, import/export
sw.js                 offline caching
supabase/             the sync backend: records, photos and guests
deploy/               that same backend on a VPS, behind Caddy
test/                 browser tests (npm test)
```

### Adding a feature

Everything the app records — feeds, meals, measurements, milestones — is one record
shape: `{ id, type, at, end, note, data, updatedAt, rev, dirty, deleted }`. A
feature declares its icon, its form fields, and how to describe and tally itself
in `js/features.js`; the history list, the edit sheet, the daily summaries,
export and sync all pick it up without changes, because none of them know what a
feed is.

Sync in particular is type-agnostic, so a new feature arrives already syncing.

## Logging by voice

Tap **Say it instead** on the Log screen and speak plainly — "feed 130 ml",
"wet nappy", "she's asleep", "woke up", "dirty nappy 20 minutes ago". It shows
what it heard and what it's about to write, and waits to be told yes; speech
recognition misfires, and a silently invented feed is worse than one extra tap.
**Change it** hands the entry to the normal editor instead.

The parser is in `js/voice.js` and has no dependencies, so it is tested
exhaustively without a microphone — including the phrases that would quietly
corrupt a log, like "feed 130 ml 20 minutes ago" needing to keep 130 as the
amount and 20 as the minutes.

Browsers without speech recognition simply don't show the button.

### Hey Siri

Siri can log without opening the app at all, via a Shortcut that posts straight
to the database. See [`docs/siri-shortcuts.md`](docs/siri-shortcuts.md).

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
