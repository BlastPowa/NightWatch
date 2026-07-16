-- Phase 29 acceptance tests: owner-private Library metadata.
--
-- HOW TO RUN. Paste the whole file into the Supabase SQL Editor and run it (or
-- run it against a disposable database). It creates throwaway users, asserts,
-- and ROLLS BACK — nothing is persisted. Any failed assertion aborts with a
-- message naming the case.
--
-- Covers: owner-only CRUD, cross-user isolation in all four verbs, the hard
-- guarantee that a local path / token / lease cannot be stored, source id and
-- status constraints, unique-source upsert behaviour, progress clamping, and
-- owner export/delete.

begin;

-- Both the claims AND the role are switched.
--
-- Setting request.jwt.claims alone is not enough to test RLS: the role running
-- the test (postgres) may hold BYPASSRLS, in which case every policy is skipped
-- and an isolation test passes while proving nothing. Becoming `authenticated`
-- is what makes these assertions real.
create or replace function pg_temp.act_as(p_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.act_as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

create or replace function pg_temp.check(p_condition boolean, p_case text)
returns void
language plpgsql
as $$
begin
  if not p_condition then
    raise exception 'FAILED: %', p_case;
  end if;
end;
$$;

create or replace function pg_temp.expect_raise(p_sql text, p_case text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'FAILED (expected an error): %', p_case;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------

do $$
declare
  v_alice uuid := gen_random_uuid();
  v_bob uuid := gen_random_uuid();
  v_item uuid;
  v_count integer;
  v_progress numeric;
  v_title text;
  v_deleted integer;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (v_alice, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice-p29@test.local'),
    (v_bob,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob-p29@test.local');

  -- -------------------------------------------------------------------------
  -- Owner CRUD.
  -- -------------------------------------------------------------------------

  perform pg_temp.act_as(v_alice);

  select id into v_item from public.save_media_library_item(
    'youtube', 'dQw4w9WgXcQ', 'A saved video'
  );
  perform pg_temp.check(v_item is not null, 'alice can save a youtube item');

  select count(*) into v_count from public.media_library_items where owner_id = v_alice;
  perform pg_temp.check(v_count = 1, 'alice sees her own item');

  -- Upsert: saving the same source again updates rather than duplicating.
  perform public.save_media_library_item('youtube', 'dQw4w9WgXcQ', 'A renamed video');
  select count(*) into v_count from public.media_library_items where owner_id = v_alice;
  perform pg_temp.check(v_count = 1, 'saving the same source twice does not duplicate');

  select title into v_title from public.media_library_items where id = v_item;
  perform pg_temp.check(v_title = 'A renamed video', 'the upsert updated the title');

  -- -------------------------------------------------------------------------
  -- Cross-user isolation: all four verbs.
  -- -------------------------------------------------------------------------

  perform pg_temp.act_as(v_bob);

  select count(*) into v_count from public.media_library_items;
  perform pg_temp.check(v_count = 0, 'bob cannot read alice''s library');

  update public.media_library_items set title = 'hacked' where id = v_item;
  delete from public.media_library_items where id = v_item;

  -- Verified as alice, not as bob. Asking bob whether the update landed proves
  -- nothing: he cannot read her row either way, so the check would pass even if
  -- the write had succeeded.
  perform pg_temp.act_as(v_alice);
  select count(*) into v_count from public.media_library_items where id = v_item;
  perform pg_temp.check(v_count = 1, 'bob cannot delete alice''s item');
  select title into v_title from public.media_library_items where id = v_item;
  perform pg_temp.check(v_title <> 'hacked', 'bob cannot update alice''s item');

  -- Bob cannot insert a row owned by alice.
  perform pg_temp.act_as(v_bob);
  perform pg_temp.expect_raise(
    format(
      'insert into public.media_library_items (owner_id, source_kind, source_id, title)
       values (%L, ''youtube'', ''abcdefghijk'', ''smuggled'')',
      v_alice
    ),
    'bob cannot insert a row owned by alice'
  );

  -- An anonymous caller sees nothing. Either answer is correct here: anon has
  -- no grant on the table (permission denied) and no auth.uid() (no rows). The
  -- test asserts the outcome, not which mechanism produced it.
  perform pg_temp.act_as_anon();
  begin
    select count(*) into v_count from public.media_library_items;
  exception when others then
    v_count := 0;
  end;
  perform pg_temp.check(v_count = 0, 'anon cannot read any library');

  -- -------------------------------------------------------------------------
  -- The three things that must never be stored.
  -- -------------------------------------------------------------------------

  perform pg_temp.act_as(v_alice);

  -- A local source has no place in the cloud at all.
  perform pg_temp.expect_raise(
    format(
      'insert into public.media_library_items (owner_id, source_kind, source_id, title)
       values (%L, ''local'', ''abcdefghijk'', ''my file'')',
      v_alice
    ),
    'a local source kind is rejected'
  );

  -- A path cannot masquerade as a source id.
  perform pg_temp.expect_raise(
    format(
      'insert into public.media_library_items (owner_id, source_kind, source_id, title)
       values (%L, ''drive'', ''C:\Users\alice\holiday.mp4'', ''my file'')',
      v_alice
    ),
    'a windows path is not a valid drive source id'
  );
  perform pg_temp.expect_raise(
    format(
      'insert into public.media_library_items (owner_id, source_kind, source_id, title)
       values (%L, ''drive'', ''/home/alice/holiday.mp4'', ''my file'')',
      v_alice
    ),
    'a posix path is not a valid drive source id'
  );

  -- A token or a lease url cannot be smuggled through artwork_url.
  perform pg_temp.expect_raise(
    format(
      'insert into public.media_library_items (owner_id, source_kind, source_id, title, artwork_url)
       values (%L, ''youtube'', ''abcdefghijk'', ''x'', ''nightwatch-media://stream/deadbeef'')',
      v_alice
    ),
    'a lease url is not a valid artwork url'
  );

  -- There is no column for a token, a path, or a lease. If someone adds one,
  -- this fails and they have to explain why.
  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'media_library_items'
     and (
       column_name ilike '%token%'
       or column_name ilike '%path%'
       or column_name ilike '%lease%'
       or column_name ilike '%secret%'
       or column_name ilike '%credential%'
     );
  perform pg_temp.check(v_count = 0, 'no token/path/lease/credential column exists');

  -- -------------------------------------------------------------------------
  -- Constraints.
  -- -------------------------------------------------------------------------

  perform pg_temp.expect_raise(
    format(
      'insert into public.media_library_items (owner_id, source_kind, source_id, title)
       values (%L, ''youtube'', ''too-short'', ''x'')',
      v_alice
    ),
    'a malformed youtube id is rejected'
  );

  perform pg_temp.expect_raise(
    format(
      'insert into public.media_library_items (owner_id, source_kind, source_id, title, status)
       values (%L, ''youtube'', ''abcdefghijk'', ''x'', ''pirated'')',
      v_alice
    ),
    'an unknown status is rejected'
  );

  perform pg_temp.expect_raise(
    format(
      'insert into public.media_library_items (owner_id, source_kind, source_id, title, fingerprint)
       values (%L, ''drive'', ''1AbCdEfGhIjKlMnOpQrSt'', ''x'', ''md5:abc'')',
      v_alice
    ),
    'a non-sha256 fingerprint is rejected'
  );

  perform pg_temp.expect_raise(
    format(
      'insert into public.media_library_items (owner_id, source_kind, source_id, title, fingerprint)
       values (%L, ''youtube'', ''abcdefghijk'', ''x'', ''sha256:%s'')',
      v_alice, repeat('a', 64)
    ),
    'a youtube item may not carry a fingerprint'
  );

  perform pg_temp.expect_raise(
    format(
      'insert into public.media_library_items (owner_id, source_kind, source_id, title, size_bytes)
       values (%L, ''drive'', ''1AbCdEfGhIjKlMnOpQrSt'', ''x'', 0)',
      v_alice
    ),
    'a zero size is rejected'
  );

  perform pg_temp.expect_raise(
    format(
      'insert into public.media_library_items (owner_id, source_kind, source_id, title, mime_type)
       values (%L, ''drive'', ''1AbCdEfGhIjKlMnOpQrSt'', ''x'', ''video/x-matroska'')',
      v_alice
    ),
    'an unsupported mime type is rejected'
  );

  -- -------------------------------------------------------------------------
  -- Progress clamping.
  -- -------------------------------------------------------------------------

  perform public.save_media_library_item(
    'drive', '1AbCdEfGhIjKlMnOpQrSt', 'A drive video',
    'sha256:' || repeat('b', 64), null, 'video/mp4', 1048576, 120
  );
  select id into v_item
    from public.media_library_items
   where owner_id = v_alice and source_kind = 'drive';

  -- Progress past the end would make "resume" jump past the end forever.
  select progress_seconds into v_progress
    from public.set_media_library_progress(v_item, 500);
  perform pg_temp.check(v_progress = 120, 'progress is clamped to duration');

  select progress_seconds into v_progress
    from public.set_media_library_progress(v_item, -5);
  perform pg_temp.check(v_progress = 0, 'negative progress is clamped to zero');

  select progress_seconds into v_progress
    from public.set_media_library_progress(v_item, 60);
  perform pg_temp.check(v_progress = 60, 'ordinary progress is stored as-is');

  perform pg_temp.expect_raise(
    format('select public.set_media_library_progress(%L, 10, ''bogus'')', v_item),
    'an invalid status is rejected by the progress rpc'
  );

  -- Bob cannot move alice's progress: RLS makes her row invisible, so the rpc
  -- reports not found rather than silently doing nothing.
  perform pg_temp.act_as(v_bob);
  perform pg_temp.expect_raise(
    format('select public.set_media_library_progress(%L, 10)', v_item),
    'bob cannot set progress on alice''s item'
  );

  -- -------------------------------------------------------------------------
  -- Export and delete.
  -- -------------------------------------------------------------------------

  perform pg_temp.act_as(v_alice);
  select count(*) into v_count from public.export_media_library();
  perform pg_temp.check(v_count = 2, 'alice exports exactly her two items');

  perform pg_temp.act_as(v_bob);
  select count(*) into v_count from public.export_media_library();
  perform pg_temp.check(v_count = 0, 'bob''s export contains none of alice''s items');

  -- Bob deleting his library must not touch alice's.
  select public.delete_media_library() into v_deleted;
  perform pg_temp.check(v_deleted = 0, 'bob deletes nothing');

  perform pg_temp.act_as(v_alice);
  select count(*) into v_count from public.media_library_items where owner_id = v_alice;
  perform pg_temp.check(v_count = 2, 'alice''s items survived bob''s delete-all');

  select public.delete_media_library() into v_deleted;
  perform pg_temp.check(v_deleted = 2, 'alice deletes her own two items');
  select count(*) into v_count from public.media_library_items where owner_id = v_alice;
  perform pg_temp.check(v_count = 0, 'alice''s library is empty after delete-all');

  raise notice 'Phase 29 media library tests: ALL PASSED';
end;
$$;

rollback;
