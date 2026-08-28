# Nayla

A small web app for tracking a baby's **feeds, diaper changes, sleep, and wake windows**.

Built to be used one-handed on a phone at 3am: big tap targets, a live wake-window
timer on the home screen, and one tap to start or end a sleep.

## Running it

There's no build step and no dependencies. Serve the folder with any static server:

```sh
python3 -m http.server 8080
# then open http://localhost:8080
```

Opening `index.html` directly works too, but a server is needed for the offline
service worker and for "Add to Home Screen" to behave like an app.

To use it on a phone, host the folder anywhere static (GitHub Pages, Netlify,
Vercel, a Raspberry Pi) and open it in the phone's browser → **Add to Home Screen**.
It then launches full-screen and works with no signal.

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
in the header), ml/oz, and backup/restore.

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

## Your data

Everything is stored in `localStorage` in the browser you use it in. Nothing is sent
anywhere — there's no server, no account, no analytics. That also means the log lives
on one device, so use **Settings → Export JSON** for backups (and **Export CSV** if you
want to look at the numbers in a spreadsheet). **Import** restores a JSON backup, which
is also how you move the log to a new phone.

Clearing the browser's site data deletes the log, so keep a backup if it matters.

## Layout

```
index.html            markup for all four views plus the entry sheet
styles.css            design tokens, light + dark, mobile-first
js/store.js           entries + settings, persisted to localStorage
js/format.js          durations, clock times, day labels, ml/oz
js/wake.js            wake-window ranges and current awake/asleep state
js/sheet.js           the add/edit bottom sheet
js/app.js             views, live timers, stats, import/export
sw.js                 offline caching
```
