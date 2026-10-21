-- One-shot logging, for things that aren't the app.
--
-- The sync functions take a batch of fully-formed records: ids, timestamps,
-- revisions. That is right for a phone holding its own copy, and far too much
-- for a Siri Shortcut, which should be able to log a feed in a single HTTP
-- call with three fields and no bookkeeping.
--
-- So this generates the id and the timestamp itself. Entries made this way are
-- ordinary rows: the phones pull them on their next sync like any other.

create or replace function public.nayla_quick_log(
  p_code   text,
  p_type   text,
  p_amount numeric default null,
  p_kind   text    default null,
  p_note   text    default ''
)
returns text
language plpgsql
security definer
set search_path = nayla, public
as $$
declare
  v_now  bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_id   text;
  v_data jsonb;
begin
  perform nayla.assert_code(p_code);

  -- "Woke up" closes the sleep that is running rather than adding a row.
  -- The 12-hour bound matches the app: an older open sleep is a missed
  -- "woke up", not a baby still asleep, and should not be closed now.
  if p_type = 'wake' then
    update nayla.records r
       set "end" = v_now, rev = nextval('nayla.records_rev'), updated_at = v_now
     where r.household = p_code
       and r.id = (select id from nayla.records
                    where household = p_code and type = 'sleep'
                      and "end" is null and deleted = false
                      and at > v_now - 12 * 3600 * 1000
                    order by at desc limit 1);
    if not found then
      raise exception 'nothing was asleep';
    end if;
    return 'woke';
  end if;

  if p_type not in ('feed', 'diaper', 'sleep') then
    raise exception 'type must be feed, diaper, sleep or wake';
  end if;

  if p_type = 'feed' then
    if p_amount is not null and (p_amount <= 0 or p_amount > 1000) then
      raise exception 'amount out of range';
    end if;
    v_data := jsonb_build_object('method', 'bottle', 'amount', p_amount);
  elsif p_type = 'diaper' then
    if coalesce(p_kind, 'wet') not in ('wet', 'dirty', 'both') then
      raise exception 'kind must be wet, dirty or both';
    end if;
    v_data := jsonb_build_object('kind', coalesce(p_kind, 'wet'));
  else
    v_data := '{}'::jsonb;
  end if;

  v_id := 'ql' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')
               || substr(md5(random()::text), 1, 4);

  insert into nayla.records
    (household, id, type, at, "end", note, data, deleted, rev, updated_at)
  values
    (p_code, v_id, p_type, v_now, null, coalesce(p_note, ''), v_data, false,
     nextval('nayla.records_rev'), v_now);

  return v_id;
end;
$$;

revoke all on function public.nayla_quick_log(text, text, numeric, text, text) from public;
grant execute on function public.nayla_quick_log(text, text, numeric, text, text)
  to anon, authenticated;
