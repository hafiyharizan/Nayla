-- Nayla sync: one table, two functions, no direct table access.
--
-- Everything lives in its own `nayla` schema so this migration is safe to
-- apply into a project that already hosts something else, and so removing it
-- again is `drop schema nayla cascade` plus the two functions. The functions
-- themselves sit in `public` because that is the schema PostgREST exposes by
-- default; they are prefixed to avoid colliding with whatever else is there.
--
-- Records are keyed by a household — the pairing code shared between the
-- phones. The table is deliberately unreachable from the client: the anon key
-- alone gets you nothing, because the only entry points are the two
-- security-definer functions below and both demand the code. That matters
-- because the anon key ships inside the app and is public by design.
--
-- `rev` is a sequence rather than a clock. It gives a strictly increasing
-- cursor with no ties and no dependence on any device's clock, which is what
-- makes "pull everything since rev N" reliable.

-- Supabase provisions `anon` and `authenticated`; a plain Postgres behind
-- PostgREST does not. Create them if absent so this file applies unchanged
-- either place.
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end
$$;

create schema if not exists nayla;

create sequence if not exists nayla.records_rev;

create table if not exists nayla.records (
  household  text    not null,
  id         text    not null,
  type       text    not null,
  at         bigint  not null,
  "end"      bigint,
  note       text    not null default '',
  data       jsonb   not null default '{}'::jsonb,
  deleted    boolean not null default false,
  rev        bigint  not null,
  updated_at bigint  not null,
  primary key (household, id)
);

create index if not exists records_cursor on nayla.records (household, rev);

-- Belt and braces: the schema is not exposed to PostgREST and anon holds no
-- grants on it, and RLS with no policies denies anything that reaches the
-- table directly anyway. The security-definer functions run as owner.
alter table nayla.records enable row level security;

revoke all on schema nayla from anon, authenticated;
revoke all on nayla.records from anon, authenticated;
revoke all on sequence nayla.records_rev from anon, authenticated;


-- A short code would be brute-forceable; the app generates 32 hex chars.
create or replace function nayla.assert_code(p_code text)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_code is null or length(p_code) < 24 then
    raise exception 'invalid pairing code';
  end if;
end;
$$;


create or replace function public.nayla_sync_push(p_code text, p_rows jsonb)
returns bigint
language plpgsql
security definer
set search_path = nayla, public
as $$
declare
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_rev bigint;
begin
  perform nayla.assert_code(p_code);

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'too many rows in one push';
  end if;

  with upserted as (
    insert into nayla.records
      (household, id, type, at, "end", note, data, deleted, rev, updated_at)
    select
      p_code,
      r->>'id',
      r->>'type',
      (r->>'at')::bigint,
      nullif(r->>'end', '')::bigint,
      coalesce(r->>'note', ''),
      coalesce(r->'data', '{}'::jsonb),
      coalesce((r->>'deleted')::boolean, false),
      nextval('nayla.records_rev'),
      v_now
    from jsonb_array_elements(p_rows) r
    where r->>'id' is not null and r->>'type' is not null
    on conflict (household, id) do update set
      type       = excluded.type,
      at         = excluded.at,
      "end"      = excluded."end",
      note       = excluded.note,
      data       = excluded.data,
      deleted    = excluded.deleted,
      rev        = excluded.rev,
      updated_at = excluded.updated_at
    returning rev
  )
  select coalesce(max(rev), 0) into v_rev from upserted;

  return v_rev;
end;
$$;


create or replace function public.nayla_sync_pull(p_code text, p_since bigint)
returns table (
  id text, type text, at bigint, "end" bigint,
  note text, data jsonb, deleted boolean, rev bigint, updated_at bigint
)
language plpgsql
security definer
set search_path = nayla, public
as $$
begin
  perform nayla.assert_code(p_code);

  return query
    select r.id, r.type, r.at, r."end", r.note, r.data, r.deleted, r.rev, r.updated_at
    from nayla.records r
    where r.household = p_code
      and r.rev > coalesce(p_since, 0)
    order by r.rev
    limit 2000;
end;
$$;


revoke all on function nayla.assert_code(text) from public, anon, authenticated;
revoke all on function public.nayla_sync_push(text, jsonb) from public;
revoke all on function public.nayla_sync_pull(text, bigint) from public;

grant execute on function public.nayla_sync_push(text, jsonb) to anon, authenticated;
grant execute on function public.nayla_sync_pull(text, bigint) to anon, authenticated;
