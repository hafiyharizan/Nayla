# Running the sync backend on a VPS

Postgres, PostgREST and Caddy on one small box. A 1GB VPS is enough; anything
with 2GB+ is comfortable. This runs the same `supabase/migrations/0001_records.sql`
as the hosted setup, and the app talks to it with no code change — only the
Server URL in Settings differs.

## Before you start

You need a hostname pointing at the VPS. Caddy gets its TLS certificate
automatically, but only if DNS already resolves and ports 80 and 443 are open.
A subdomain of a domain you own is ideal; a free dynamic-DNS hostname works too.

## 1. Harden the box first

Do this before anything is listening. As root on a fresh Ubuntu:

```sh
adduser nayla && usermod -aG sudo nayla
rsync --archive --chown=nayla:nayla ~/.ssh /home/nayla    # copy your key over

# Disable password logins — key-only from here on.
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh

ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# Security updates without you remembering to apply them.
apt update && apt install -y unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
```

Open a second SSH session and confirm you can still get in *before* closing the
first one.

Then install Docker via [the official instructions](https://docs.docker.com/engine/install/ubuntu/).

## 2. Deploy

As the `nayla` user:

```sh
git clone https://github.com/hafiyharizan/Nayla.git && cd Nayla/deploy
cp .env.example .env
openssl rand -base64 32     # paste into POSTGRES_PASSWORD
openssl rand -base64 32     # paste into AUTHENTICATOR_PASSWORD
nano .env                   # and set DOMAIN

docker compose up -d
docker compose logs -f caddy   # watch the certificate get issued, then ctrl-C
```

## 3. Apply the migration

Deliberately a separate step, not something that happens on boot:

```sh
docker compose exec -T db psql -U postgres -d nayla -v ON_ERROR_STOP=1 \
  < ../supabase/migrations/0001_records.sql
```

Re-running it is safe. Future schema changes are another numbered file in
`supabase/migrations/`, applied the same way.

## 4. Point the app at it

In **Settings → Sync** on both phones:

- **Server URL** — `https://your.domain`
- **Anon key** — leave empty. That field is only for Supabase, whose gateway
  demands one. Here PostgREST maps unauthenticated requests to the `anon` role.
- **Pairing code** — tap **New code** on the first phone, type the same code
  into the second.

Check it works:

```sh
curl -sS https://your.domain/rest/v1/rpc/nayla_sync_pull \
  -H 'Content-Type: application/json' \
  -d '{"p_code":"<your pairing code>","p_since":0}'
```

An empty `[]` means everything is wired up. `invalid pairing code` means the
code is under 24 characters. A 404 means Caddy didn't match the path.

## 5. Back it up — do not skip this

`backup.sh` dumps nightly and keeps 14 days:

```sh
chmod +x backup.sh
(crontab -l 2>/dev/null; echo "15 3 * * * cd $HOME/Nayla/deploy && ./backup.sh >> backup.log 2>&1") | crontab -
```

But those dumps sit on the same machine as the database, so they protect you
from mistakes, not from losing the box. Get them somewhere else — `rsync` to
your laptop on a schedule, or `rclone` to any object storage. A VPS with no
off-box backup is genuinely worse than the hosted free tier, because nobody
else is keeping a copy of Nayla's first year.

Restoring:

```sh
docker compose exec -T db pg_restore -U postgres -d nayla --clean --if-exists < backups/nayla-<stamp>.dump
```

## What is exposed, and what isn't

Only Caddy is on the internet. It forwards exactly two paths —
`/rest/v1/rpc/nayla_sync_push` and `/rest/v1/rpc/nayla_sync_pull` — and answers
404 to everything else, so PostgREST's table routes and OpenAPI description are
never reachable.

Postgres publishes no ports at all; it exists only on the private compose
network. **Don't add a `ports:` entry to the `db` service.** An exposed Postgres
gets credential-stuffed within hours.

PostgREST logs in as `authenticator`, a role with no rights of its own, and
switches to `anon` per request. Both are refused the `nayla` schema outright, so
the only thing either can do is call the two functions — and those demand the
pairing code. That's three independent layers between the internet and the data:
Caddy's path allowlist, the role grants, and the code check inside the
functions.

For extra safety you can put SSH on a Tailscale tailnet and drop port 22 from
the firewall entirely. Then administration is private and only 80/443 face the
world.

## Moving here from hosted Supabase

```sh
pg_dump "postgres://...supabase-connection-string..." \
  --schema=nayla --format=custom --file=nayla.dump
docker compose exec -T db pg_restore -U postgres -d nayla < nayla.dump
```

Then change Server URL on both phones and clear the Anon key. The pairing code
stays the same, so nothing else has to change.
