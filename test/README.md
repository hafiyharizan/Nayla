# Tests

```sh
npm install          # playwright, for the browser tests only
npm test
```

`sync.test.mjs` starts a static server for the app plus an in-process mock of
the two sync functions, then drives real Chromium pages against it. It covers:

- migrating the v1 storage format to v2 records without losing entries
- the Now / History / Stats / Settings views building themselves from the
  feature registry
- logging, editing, and the sleep start/stop round trip
- two "phones" sharing a log: propagation of adds, edits and deletes
- writes made offline queueing and draining on reconnect
- an unpushed local edit surviving an incoming server row
- a rejected pairing code failing loudly rather than corrupting anything

`install.test.mjs` drives the Add-to-Home-Screen flow under three spoofed
user agents, because the platforms diverge:

- iPhone Safari gets illustrated steps with the real iOS glyphs (there is no
  install API on iOS)
- Chrome on iOS is told to reopen in Safari, since it cannot install at all
- Android gets a one-tap install driven by `beforeinstallprompt`

It also covers dismissal persisting, Settings still offering it afterwards, and
an already-installed app never nagging.

`pair.test.mjs` runs the two-phone pairing flow against a mock backend: one
phone generates a code and renders a QR, the other opens the link and ends up
configured and synced with nothing typed. It also covers the secret being
stripped from the address bar and a malformed link being ignored.

`qr.test.mjs` round-trips the QR encoder: encode, render to an image, and
decode with zxing — the same engine behind most phone cameras. It sweeps
versions 1-10 and both sides of every version boundary, which is where a
padding bug hid during development. Byte-comparing against another encoder is
deliberately not the test; the spec permits legal variation (error-correction
boosting, final-codeword padding, mask tie-breaks) and reference encoders
disagree with each other as readily as with us. Needs
`pip install zxing-cpp pillow`; skipped with a message if absent.

Set `PW_CHROMIUM` to a browser path if Playwright shouldn't download its own.

The mock mirrors `supabase/migrations/0001_records.sql`; if you change the SQL,
change the mock. The SQL itself is checked against a real Postgres — create a
scratch database, apply the migration, and exercise the functions as the `anon`
role (it must be refused direct access to the `records` table).
