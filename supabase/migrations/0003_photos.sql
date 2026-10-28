-- Milestone photos.
--
-- A photo is too big to ride inside a record — records go up and down in
-- every sync, and a phone keeps all of them in a few MB of localStorage. So
-- a milestone stores only a photo id, and the image lives here, fetched
-- once by each phone that needs to show it.
--
-- Same rules as the records table: unreachable directly, and the pairing
-- code is the only way in. Apply after 0001. The app works without this —
-- photos then stay on the phone that took them, and upload once it exists.

create table if not exists nayla.photos (
  household  text   not null,
  id         text   not null,
  data       text   not null,      -- a data:image/jpeg;base64,… URL
  updated_at bigint not null,
  primary key (household, id)
);

alter table nayla.photos enable row level security;
revoke all on nayla.photos from anon, authenticated;


-- Store a photo, or delete it when p_data is null.
create or replace function public.nayla_photo_put(p_code text, p_id text, p_data text)
returns void
language plpgsql
security definer
set search_path = nayla, public
as $$
begin
  perform nayla.assert_code(p_code);

  if p_id is null or length(p_id) = 0 or length(p_id) > 64 then
    raise exception 'invalid photo id';
  end if;

  if p_data is null then
    delete from nayla.photos where household = p_code and id = p_id;
    return;
  end if;

  -- The app sends ~150–300 KB; this cap is for anything that isn't the app.
  if length(p_data) > 3000000 then
    raise exception 'photo too large';
  end if;
  if p_data not like 'data:image/%' then
    raise exception 'not an image';
  end if;

  insert into nayla.photos (household, id, data, updated_at)
  values (p_code, p_id, p_data, (extract(epoch from clock_timestamp()) * 1000)::bigint)
  on conflict (household, id) do update set
    data = excluded.data,
    updated_at = excluded.updated_at;
end;
$$;


create or replace function public.nayla_photo_get(p_code text, p_id text)
returns text
language plpgsql
stable
security definer
set search_path = nayla, public
as $$
declare
  v_data text;
begin
  perform nayla.assert_code(p_code);
  select data into v_data from nayla.photos where household = p_code and id = p_id;
  return v_data;
end;
$$;


revoke all on function public.nayla_photo_put(text, text, text) from public;
revoke all on function public.nayla_photo_get(text, text) from public;

grant execute on function public.nayla_photo_put(text, text, text) to anon, authenticated;
grant execute on function public.nayla_photo_get(text, text) to anon, authenticated;
