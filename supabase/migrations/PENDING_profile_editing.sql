-- =====================================================================
-- Profile editing (AUTH-05) + User table hardening
--   * avatars bucket: public read, each user writes only their own folder
--   * usernames (User.name) are unique, ignoring case
--   * update_profile(): change username / photo with validation
--   * new sign-ups get a free username (registration's username first)
--   * clients can no longer write User columns directly except the
--     email-notification switches (email, userCode, name, avatarUrl were
--     editable straight from the browser before, bypassing validation)
-- =====================================================================

-- ---------- avatars bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Files live at avatars/<userId>/<file>; only that user may add, replace or delete them.
drop policy if exists "Users read own avatar files" on storage.objects;
drop policy if exists "Users upload own avatar" on storage.objects;
drop policy if exists "Users replace own avatar" on storage.objects;
drop policy if exists "Users delete own avatar" on storage.objects;
create policy "Users read own avatar files" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users upload own avatar" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users replace own avatar" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users delete own avatar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- usernames are unique (case-insensitive) ----------
create unique index if not exists "User_name_lower_key" on public."User" (lower(btrim(name)));

-- A free username based on `wanted`: "ana" -> "ana", then "ana2", "ana3", ...
create or replace function public._free_username(wanted text, p_user_id uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base text := left(regexp_replace(btrim(coalesce(wanted, '')), '\s+', ' ', 'g'), 26);
  candidate text;
  n int := 1;
begin
  if length(base) < 3 then base := rpad(coalesce(nullif(base, ''), 'user'), 3, '0'); end if;
  candidate := base;
  while exists (select 1 from public."User" u
                where lower(btrim(u.name)) = lower(candidate)
                  and (p_user_id is null or u."userId" <> p_user_id)) loop
    n := n + 1;
    candidate := base || n::text;
  end loop;
  return candidate;
end;
$$;
revoke all on function public._free_username(text, uuid) from public, anon, authenticated;

-- New accounts: the username typed at registration, else the full name, else the email's first part.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public."User" ("userId", email, name, "avatarUrl")
  values (
    new.id,
    new.email,
    public._free_username(coalesce(
      nullif(btrim(new.raw_user_meta_data->>'username'), ''),
      nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
      split_part(new.email, '@', 1)
    )),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

-- ---------- AUTH-05: edit your profile ----------
-- p_name: new username (null = keep). p_avatar_url: new photo (null = keep).
-- p_remove_avatar: clear the photo.
create or replace function public.update_profile(
  p_name text default null,
  p_avatar_url text default null,
  p_remove_avatar boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_name text;
  v_row  public."User";
begin
  if v_me is null then raise exception 'FORBIDDEN: Sign in first'; end if;
  select * into v_row from public."User" where "userId" = v_me for update;
  if not found then raise exception 'NOT_FOUND: Profile not found'; end if;

  if p_name is not null then
    v_name := regexp_replace(btrim(p_name), '\s+', ' ', 'g');
    if length(v_name) < 3 then raise exception 'INVALID: Usernames need at least 3 characters'; end if;
    if length(v_name) > 30 then raise exception 'INVALID: Usernames can be up to 30 characters'; end if;
    if v_name !~ '^[[:alnum:]][[:alnum:] ._''-]*$' then
      raise exception 'INVALID: Use letters, numbers, spaces, dots, dashes, underscores or apostrophes, starting with a letter or number';
    end if;
    if exists (select 1 from public."User" u
               where lower(btrim(u.name)) = lower(v_name) and u."userId" <> v_me) then
      raise exception 'CONFLICT: "%" is already taken. Try another username', v_name;
    end if;
    v_row.name := v_name;
  end if;

  if coalesce(p_remove_avatar, false) then
    v_row."avatarUrl" := null;
  elsif p_avatar_url is not null then
    -- Only a photo in your own folder of the avatars bucket.
    if p_avatar_url !~ ('^https?://[^/]+/storage/v1/object/public/avatars/' || v_me::text || '/[A-Za-z0-9._-]+$') then
      raise exception 'INVALID: Upload the photo again';
    end if;
    v_row."avatarUrl" := p_avatar_url;
  end if;

  update public."User" set name = v_row.name, "avatarUrl" = v_row."avatarUrl" where "userId" = v_me;
  return jsonb_build_object('userId', v_me, 'name', v_row.name, 'avatarUrl', v_row."avatarUrl");
end;
$$;
revoke all on function public.update_profile(text, text, boolean) from public, anon;
grant execute on function public.update_profile(text, text, boolean) to authenticated;

-- ---------- lock down direct writes to User ----------
revoke insert, update, delete, truncate on public."User" from anon, authenticated;
grant update ("notifyExpense", "notifySettlement", "notifyGroupJoin") on public."User" to authenticated;
