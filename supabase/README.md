# Sync backend

One table and two functions. Nothing here is specific to hosted Supabase — the
same migration runs against a Supabase instance you host yourself, or any plain
Postgres with PostgREST in front of it. That is the point: moving later is a URL
change, not a rewrite.

Everything lives in its own `nayla` schema, and the two functions are prefixed
`nayla_sync_push` / `nayla_sync_pull`, so the migration is safe to apply into a
project that already hosts something else. Removing it again is:

```sql
drop schema nayla cascade;
drop function if exists public.nayla_sync_push(text, jsonb);
drop function if exists public.nayla_sync_pull(text, bigint);
```

The functions sit in `public` rather than in `nayla` because `public` is the
schema PostgREST exposes by default — putting them elsewhere would mean editing
the API settings, which is one more thing to remember when standing up a second
instance.

## Hosted Supabase

The `Nayla` project is already set up and the migration applied, and
`js/config.js` carries its URL and anon key. So on each phone there is exactly
one thing to do:

**Settings → Sync → New code** on the first phone, then type that same code into
the second phone's **Pairing code** field. Leave Server URL and Anon key alone.

Both phones then share one log. To check it worked, log something on one and
watch it appear on the other within a minute (or tap **Sync now**).

### Setting up a different project from scratch

1. Create a project (the free tier is ample — the log is kilobytes).
2. Run `migrations/0001_records.sql` in the SQL editor, or
   `supabase db push` if you use the CLI.
3. In the app: **Settings → Sync**, and fill in
   - **Server URL** — `https://<project-ref>.supabase.co`
   - **Anon key** — Project Settings → API → anon/public key
   - **Pairing code** — as above.

## Self-hosted

Run the [Supabase Docker stack](https://supabase.com/docs/guides/self-hosting/docker),
apply the same migration, and change **Server URL** to your instance. Everything
else is identical.

A box at home is only reachable from home, which defeats the point if one of you
is out. Don't port-forward Postgres to the internet. Put the server and both
phones on a [Tailscale](https://tailscale.com) tailnet instead — nothing is
publicly exposed, there are no certificates to manage, and the URL then works
from anywhere.

Moving the data across is `pg_dump` on the old side and `psql` on the new one.

## How the schema is meant to be changed

Add a numbered file to `migrations/` and apply it. Never make changes only in
the dashboard: the files in this folder are what makes standing up a second
instance a ten-minute job.

## Design notes

**The table is unreachable.** `anon` has no grant on the `nayla` schema, so a
direct read fails before it reaches the table; RLS is enabled with no policies
behind that as a second line. The only way in is `nayla_sync_push` /
`nayla_sync_pull`, which are `security definer` and demand the pairing code.
This matters because the anon key ships inside the app and is public by design;
on its own it gets you nothing.

**The anon key is not a secret, and is committed.** Supabase designs it to ship
in client-side code, and here it opens nothing on its own: both functions demand
the pairing code before they touch a row, and every other table in the project
has RLS enabled with no policies, which denies everything. The one real cost of
publishing it is that strangers can make requests that count against the
project's quota — not a concern at this scale, but the reason it lives in
`js/config.js` where it can be pulled back out into per-device settings if you
ever want it private.

**The pairing code is a bearer secret.** Anyone holding it can read and write
that household's log. It's 128 bits of randomness, so guessing is out, but treat
it like a password: share it directly between the two phones, and keep it out of
backups (exports deliberately omit it). If it leaks, generate a new one on one
phone and re-enter it on the other; the old household's rows simply stop being
read.

**`rev` is a sequence, not a clock.** Every write takes the next value from one
global sequence, which gives a strictly increasing cursor with no ties and no
dependence on any device's clock. "Pull everything since rev N" is then exactly
correct even if a phone's time is wrong.

**Deletes are tombstones.** A removed row is kept with `deleted = true`, because
otherwise the other phone would helpfully re-upload it on its next sync. The app
drops tombstones locally after 90 days.

**Conflicts are last-write-wins per record.** Records are append-mostly with
unique ids, and two people essentially never edit the same entry, so a CRDT
would be a lot of machinery for a case that doesn't arise. The worst outcome is
one edit of one record losing to a later edit of that same record — never a lost
log. Unpushed local edits are never overwritten by an incoming row.
