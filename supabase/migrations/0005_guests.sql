-- Guests: a babysitter (or grandparent) who can see the log for a while,
-- and stops being able to the moment the family says so.
--
-- A pairing code can't do this. Whoever holds it is a full member of the
-- household for good, and taking it back means re-pairing every family
-- phone. So a guest gets a token of their own instead, minted by a family
-- phone and stored here against the household:
--
--   - it reads the household's records, and nothing else — not photos, not
--     the pairing code, not other guests;
--   - it can add entries if the family allowed that, and change or delete
--     only the ones it added — never the family's, except to end a sleep
--     that was already running when the baby was handed over;
--   - it stops working when it is revoked or its time is up, which is
--     checked here on every call, so there is nothing for the guest's phone
--     to get wrong.
--
-- Entries a guest adds carry data.by = the guest's name, set here rather
-- than trusted from the phone, so the family sees who logged what.
--
-- Apply after 0001. Same rules: the tables are unreachable directly, and
-- the only way in is through the functions below.

create table if not exists nayla.guests (
  token      text    primary key,
  household  text    not null,
  label      text    not null,
  baby       jsonb   not null default '{}'::jsonb,   -- name, dob, sex: the guest's phone has no settings of its own
  can_log    boolean not null default true,
  created_at bigint  not null,
  expires_at bigint,                                 -- null: until revoked
  revoked    boolean not null default false
);

create index if not exists guests_household on nayla.guests (household);

alter table nayla.guests enable row level security;
revoke all on nayla.guests from anon, authenticated;

-- Which guest added a record, if any. Only ever set by nayla_guest_push.
alter table nayla.records add column if not exists guest text;


create or replace function nayla.now_ms()
returns bigint
language sql
volatile
set search_path = pg_catalog
as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;


/* The household a guest token currently opens, or an error that the app
 * recognises by its wording ("guest access ended") and acts on by wiping
 * the guest's phone. */
create or replace function nayla.guest_row(p_token text)
returns nayla.guests
language plpgsql
stable
set search_path = nayla, pg_catalog
as $$
declare
  g nayla.guests;
begin
  perform nayla.assert_code(p_token);
  select * into g from nayla.guests where token = p_token;
  if not found or g.revoked or (g.expires_at is not null and g.expires_at <= nayla.now_ms()) then
    raise exception 'guest access ended';
  end if;
  return g;
end;
$$;


/* ── for the family's phones ──────────────────────────────── */

create or replace function public.nayla_guest_create(
  p_code       text,
  p_token      text,
  p_label      text,
  p_baby       jsonb,
  p_can_log    boolean,
  p_expires_at bigint
)
returns void
language plpgsql
security definer
set search_path = nayla, public
as $$
begin
  perform nayla.assert_code(p_code);
  perform nayla.assert_code(p_token);
  if p_token = p_code then
    raise exception 'a guest token must not be the pairing code';
  end if;
  if p_label is null or length(trim(p_label)) = 0 or length(p_label) > 40 then
    raise exception 'give the guest a name of up to 40 characters';
  end if;
  if (select count(*) from nayla.guests where household = p_code and not revoked) >= 20 then
    raise exception 'too many guests — remove some first';
  end if;

  insert into nayla.guests (token, household, label, baby, can_log, created_at, expires_at)
  values (p_token, p_code, trim(p_label), coalesce(p_baby, '{}'::jsonb),
          coalesce(p_can_log, true), nayla.now_ms(), p_expires_at);
end;
$$;


/* Guests that can still get in. Expired and revoked ones drop off. */
create or replace function public.nayla_guest_list(p_code text)
returns table (token text, label text, can_log boolean, created_at bigint, expires_at bigint)
language plpgsql
stable
security definer
set search_path = nayla, public
as $$
begin
  perform nayla.assert_code(p_code);
  return query
    select g.token, g.label, g.can_log, g.created_at, g.expires_at
    from nayla.guests g
    where g.household = p_code
      and not g.revoked
      and (g.expires_at is null or g.expires_at > nayla.now_ms())
    order by g.created_at;
end;
$$;


create or replace function public.nayla_guest_revoke(p_code text, p_token text)
returns void
language plpgsql
security definer
set search_path = nayla, public
as $$
begin
  perform nayla.assert_code(p_code);
  update nayla.guests set revoked = true
  where household = p_code and token = p_token;
end;
$$;


/* ── for the guest's phone ────────────────────────────────── */

create or replace function public.nayla_guest_info(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = nayla, public
as $$
declare
  g nayla.guests := nayla.guest_row(p_token);
begin
  return jsonb_build_object(
    'label', g.label, 'baby', g.baby, 'can_log', g.can_log, 'expires_at', g.expires_at);
end;
$$;


create or replace function public.nayla_guest_pull(p_token text, p_since bigint)
returns table (
  id text, type text, at bigint, "end" bigint,
  note text, data jsonb, deleted boolean, rev bigint, updated_at bigint
)
language plpgsql
stable
security definer
set search_path = nayla, public
as $$
declare
  g nayla.guests := nayla.guest_row(p_token);
begin
  return query
    select r.id, r.type, r.at, r."end", r.note, r.data, r.deleted, r.rev, r.updated_at
    from nayla.records r
    where r.household = g.household
      and r.rev > coalesce(p_since, 0)
    order by r.rev
    limit 2000;
end;
$$;


/* Adds the guest's new entries, and changes the ones it added before. A row
 * that belongs to the family is skipped, not overwritten — whatever the
 * guest's phone sends. */
create or replace function public.nayla_guest_push(p_token text, p_rows jsonb)
returns bigint
language plpgsql
security definer
set search_path = nayla, public
as $$
declare
  g nayla.guests := nayla.guest_row(p_token);
  v_rev bigint;
begin
  if not g.can_log then
    raise exception 'this guest can only view';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'too many rows in one push';
  end if;

  with upserted as (
    insert into nayla.records
      (household, id, type, at, "end", note, data, deleted, rev, updated_at, guest)
    select
      g.household,
      r->>'id',
      r->>'type',
      (r->>'at')::bigint,
      nullif(r->>'end', '')::bigint,
      coalesce(r->>'note', ''),
      (case when jsonb_typeof(r->'data') = 'object' then r->'data' else '{}'::jsonb end)
        || jsonb_build_object('by', g.label),
      coalesce((r->>'deleted')::boolean, false),
      nextval('nayla.records_rev'),
      nayla.now_ms(),
      g.token
    from jsonb_array_elements(p_rows) r
    where r->>'id' is not null and r->>'type' is not null
    on conflict (household, id) do update set
      type       = case when nayla.records.guest = g.token then excluded.type else nayla.records.type end,
      at         = case when nayla.records.guest = g.token then excluded.at   else nayla.records.at end,
      "end"      = excluded."end",
      note       = case when nayla.records.guest = g.token then excluded.note else nayla.records.note end,
      data       = case when nayla.records.guest = g.token then excluded.data else nayla.records.data end,
      deleted    = case when nayla.records.guest = g.token then excluded.deleted else nayla.records.deleted end,
      rev        = excluded.rev,
      updated_at = excluded.updated_at
    where nayla.records.guest = g.token
       -- The one change a guest may make to the family's entries: ending a
       -- sleep that was running when the baby was handed over. Only its end
       -- time is taken.
       or (nayla.records.type = 'sleep' and nayla.records."end" is null
           and excluded."end" is not null and excluded."end" > nayla.records.at)
    returning rev
  )
  select coalesce(max(rev), 0) into v_rev from upserted;

  return v_rev;
end;
$$;


revoke all on function public.nayla_guest_create(text, text, text, jsonb, boolean, bigint) from public;
revoke all on function public.nayla_guest_list(text) from public;
revoke all on function public.nayla_guest_revoke(text, text) from public;
revoke all on function public.nayla_guest_info(text) from public;
revoke all on function public.nayla_guest_pull(text, bigint) from public;
revoke all on function public.nayla_guest_push(text, jsonb) from public;

grant execute on function public.nayla_guest_create(text, text, text, jsonb, boolean, bigint) to anon, authenticated;
grant execute on function public.nayla_guest_list(text) to anon, authenticated;
grant execute on function public.nayla_guest_revoke(text, text) to anon, authenticated;
grant execute on function public.nayla_guest_info(text) to anon, authenticated;
grant execute on function public.nayla_guest_pull(text, bigint) to anon, authenticated;
grant execute on function public.nayla_guest_push(text, jsonb) to anon, authenticated;
