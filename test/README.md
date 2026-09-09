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

Set `PW_CHROMIUM` to a browser path if Playwright shouldn't download its own.

The mock mirrors `supabase/migrations/0001_records.sql`; if you change the SQL,
change the mock. The SQL itself is checked against a real Postgres — create a
scratch database, apply the migration, and exercise the functions as the `anon`
role (it must be refused direct access to the `records` table).
