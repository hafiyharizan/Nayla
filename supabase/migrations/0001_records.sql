-- Nayla sync: one table, two functions, no direct table access.
--
-- Every record the app stores lives here, keyed by a household — the pairing
-- code shared between the phones. The table is deliberately unreachable from
-- the client: the anon key alone gets you nothing, because the only entry
-- points are the two security-definer functions below, and both demand the
-- code. That matters because the anon key ships inside the app and is public
-- by design.
--
-- `rev` is a global sequence rather than a clock. It gives a strictly
-- increasing cursor with no ties and no dependence on any device's clock,
-- which is what makes "pull everything since rev N" reliable.

create sequence if not exists public.records_rev;

create table if not exists public.records (
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

create index if not exists records_cursor on public.records (household, rev);

-- No policies are defined, so RLS denies everything reaching the table
-- directly. The functions below run as owner and bypass it.
alter table public.records enable row level security;

revoke all on public.records from anon, authenticated;
revoke all on sequence public.records_rev from anon, authenticated;


-- A short code would be brute-forceable; the app generates 32 hex chars.
create or replace function public.assert_code(p_code text)
returns void
language plpgsql
immutable
as $$
begin
  if p_code is null or length(p_code) < 24 then
    raise exception 'invalid pairing code';
  end if;
end;
$$;


create or replace function public.sync_push(p_code text, p_rows jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_rev bigint;
begin
  perform assert_code(p_code);

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'too many rows in one push';
  end if;

  with upserted as (
    insert into public.records
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
      nextval('public.records_rev'),
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


create or replace function public.sync_pull(p_code text, p_since bigint)
returns table (
  id text, type text, at bigint, "end" bigint,
  note text, data jsonb, deleted boolean, rev bigint, updated_at bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_code(p_code);

  return query
    select r.id, r.type, r.at, r."end", r.note, r.data, r.deleted, r.rev, r.updated_at
    from public.records r
    where r.household = p_code
      and r.rev > coalesce(p_since, 0)
    order by r.rev
    limit 2000;
end;
$$;


revoke all on function public.assert_code(text) from public, anon, authenticated;
revoke all on function public.sync_push(text, jsonb) from public;
revoke all on function public.sync_pull(text, bigint) from public;

grant execute on function public.sync_push(text, jsonb) to anon, authenticated;
grant execute on function public.sync_pull(text, bigint) to anon, authenticated;
