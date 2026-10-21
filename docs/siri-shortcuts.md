# "Hey Siri, log a feed"

The app can't register itself with Siri — only native apps can do that, and
Nayla is a web app. But the Shortcuts app can, and it can send the log entry
straight to the database. So this works **without opening the app at all**:
you say it, Siri confirms, and it appears on every phone on the next sync.

Each shortcut is one action. You make them once.

## What every shortcut needs

In the **Shortcuts** app → **+** → add the action **Get Contents of URL**, and
set it up like this:

| Field | Value |
| --- | --- |
| URL | `https://ekkysohguyginzjojxft.supabase.co/rest/v1/rpc/nayla_quick_log` |
| Method | `POST` |
| Headers | `apikey` → *the anon key* |
| | `Authorization` → `Bearer ` *+ the anon key* |
| | `Content-Type` → `application/json` |
| Request Body | **JSON** (the fields differ per shortcut, below) |

Both values come from the app: **Settings → Sync → Advanced**. The pairing code
is the one that matters — treat it like a password, and don't paste it into
anything you'd not trust with the whole log.

Then rename the shortcut. **The name is the Siri phrase**, so name it the way
you'd say it.

## The five shortcuts

**"Log a feed"** — JSON body:

| Key | Type | Value |
| --- | --- | --- |
| `p_code` | Text | *your pairing code* |
| `p_type` | Text | `feed` |
| `p_amount` | Number | **Ask Each Time** |

`Ask Each Time` is what makes this good out loud: *"Hey Siri, log a feed"* →
Siri asks how much → you say *"130"* → done, hands free.

**"Log a wet nappy"** — `p_code`, `p_type` = `diaper`, `p_kind` = `wet`.

**"Log a dirty nappy"** — `p_code`, `p_type` = `diaper`, `p_kind` = `dirty`.

**"Nayla is asleep"** — `p_code`, `p_type` = `sleep`.

**"Nayla woke up"** — `p_code`, `p_type` = `wake`. This closes the sleep that's
running rather than adding anything. If nothing was asleep it answers
`nothing was asleep`, and if the sleep has been running over 12 hours it leaves
it alone — an old one is a missed "woke up", not a baby still asleep, and the
app has its own prompt for fixing those.

## Worth knowing

**It doesn't go through the app, so the app's own checks don't apply.** The
database does its own: the amount must be 1–1000, the nappy type must be wet,
dirty or both, and the pairing code must be right. A bad value comes back as a
plain error rather than a wrong entry.

**It always logs "now".** There's no "20 minutes ago" over Siri — for that, use
the microphone button in the app, which understands it.

**Android**: the same URL works from Google Assistant routines or Tasker, with
the same body. The table above is the whole contract.

## Checking it works

From a terminal, with your own code pasted in:

```sh
curl -sS -X POST \
  'https://ekkysohguyginzjojxft.supabase.co/rest/v1/rpc/nayla_quick_log' \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"p_code":"YOUR_PAIRING_CODE","p_type":"feed","p_amount":130}'
```

A quoted id like `"ql2026..."` means it logged. Open the app and it'll be
there within a few seconds.
