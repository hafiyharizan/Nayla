-- Shared photos are encrypted on the phone.
--
-- 0003 stored photos as plain images. Now a photo stays on the phone that
-- took it unless its milestone is marked as shared, and a shared photo is
-- encrypted on the phone (AES-GCM) with a key that only ever travels inside
-- the pairing QR code — never to this server. So this table should only
-- ever hold ciphertext, and from here on it refuses anything else.
--
-- The payload is "enc1:<iv>:<ciphertext>", both base64. Apply after 0003.

-- Nothing readable may stay behind from before.
delete from nayla.photos where data not like 'enc1:%';

comment on column nayla.photos.data is
  'enc1:<iv>:<ciphertext> — encrypted on the phone; the key never reaches the server';

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

  if length(p_data) > 3000000 then
    raise exception 'photo too large';
  end if;
  if p_data not like 'enc1:%' then
    raise exception 'photos must be encrypted on the phone';
  end if;

  insert into nayla.photos (household, id, data, updated_at)
  values (p_code, p_id, p_data, (extract(epoch from clock_timestamp()) * 1000)::bigint)
  on conflict (household, id) do update set
    data = excluded.data,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.nayla_photo_put(text, text, text) from public;
grant execute on function public.nayla_photo_put(text, text, text) to anon, authenticated;
