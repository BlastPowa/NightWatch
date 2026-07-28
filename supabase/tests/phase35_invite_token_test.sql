-- Phase 35 invite-token test. Run against a DISPOSABLE database with
-- migrations 0001-0029 applied:
--
--   psql "$DISPOSABLE_DB_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/phase35_invite_token_test.sql
--
-- Expected final row:
--   phase35 invite token test: all assertions passed
--
-- Test-design note (v2). The first version of this file wrapped each
-- assertion in `exception when others then if sqlerrm like '%sentinel%' then
-- raise; end if;`, which swallowed EVERY unexpected error — including
-- "function does not exist" when 0029 had not been applied yet. The run then
-- failed at an unrelated later block with a misleading message. This version
-- (a) refuses to start unless 0029 is present, and (b) re-raises anything
-- that is not the specific error the assertion expects.

begin;

create or replace function pg_temp.impersonate(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', p_user, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;

create or replace function pg_temp.as_admin() returns void
language sql as $$
  select set_config('request.jwt.claims', '', true),
         set_config('role', 'postgres', true);
$$;

select pg_temp.as_admin();

-- 0. Preflight: fail loudly and immediately if the migration is missing. -----
do $$
declare
  v_missing text[] := array[]::text[];
  v_signature text;
begin
  foreach v_signature in array array[
    'public.mint_room_invite_token(text, integer)',
    'public.redeem_room_invite_token(text)',
    'public.revoke_room_invite_token(text)'
  ] loop
    if to_regprocedure(v_signature) is null then
      v_missing := v_missing || v_signature;
    end if;
  end loop;

  if to_regclass('public.room_invite_tokens') is null then
    v_missing := v_missing || 'table public.room_invite_tokens';
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception
      'migration 0029_room_invite_tokens.sql is not applied to this database. Missing: %',
      array_to_string(v_missing, ', ');
  end if;
end $$;

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-00000035aa01', 'p35-host@test.local'),
  ('00000000-0000-0000-0000-00000035bb02', 'p35-guest@test.local'),
  ('00000000-0000-0000-0000-00000035cc03', 'p35-outsider@test.local')
on conflict (id) do nothing;

-- The host is a fresh member of room AAAAAA; the others are not.
insert into public.live_room_social_presence (room_key_hash, user_id, presence_id, last_seen_at)
values (public.live_room_key_hash('AAAAAA'),
        '00000000-0000-0000-0000-00000035aa01', 'p-host', now())
on conflict (room_key_hash, user_id) do update set last_seen_at = now();

-- 1. Only a fresh room member may mint --------------------------------------
do $$
declare v_ok boolean := false;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035cc03');
  begin
    perform * from public.mint_room_invite_token('AAAAAA', 900);
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'a non-member minted an invite token';
  end if;
end $$;

-- 2. Mint returns an opaque token; the code is NOT in it ---------------------
do $$
declare
  v_token text;
  v_expires timestamptz;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035aa01');
  select token, expires_at into v_token, v_expires
  from public.mint_room_invite_token('AAAAAA', 900);

  if v_token !~ '^[0-9a-f]{32}$' then
    raise exception 'token is not 32 hex characters: %', v_token;
  end if;
  if position('AAAAAA' in upper(v_token)) > 0 then
    raise exception 'token leaks the room code';
  end if;
  if v_expires <= now() or v_expires > now() + interval '61 minutes' then
    raise exception 'token expiry is out of range';
  end if;
end $$;

-- 2b. TTL is clamped server-side, not trusted from the caller ----------------
do $$
declare v_expires timestamptz;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035aa01');

  -- Absurdly long request clamps to one hour.
  select expires_at into v_expires
  from public.mint_room_invite_token('AAAAAA', 999999);
  if v_expires > now() + interval '61 minutes' then
    raise exception 'a long TTL was not clamped';
  end if;

  -- Zero/negative request clamps up to the 60s floor rather than minting a
  -- token that is already dead.
  select expires_at into v_expires
  from public.mint_room_invite_token('AAAAAA', 0);
  if v_expires <= now() then
    raise exception 'a zero TTL produced an already-expired token';
  end if;
end $$;

-- 3. Redemption returns the code exactly once --------------------------------
do $$
declare
  v_token text;
  v_code text;
  v_ok boolean := false;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035aa01');
  select token into v_token from public.mint_room_invite_token('AAAAAA', 900);

  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035bb02');
  v_code := public.redeem_room_invite_token(v_token);
  if v_code <> 'AAAAAA' then
    raise exception 'redemption returned the wrong room code: %', v_code;
  end if;

  -- Second use must fail: single-use is the whole point.
  begin
    perform public.redeem_room_invite_token(v_token);
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'a spent token was redeemed twice';
  end if;
end $$;

-- 4. Expired tokens are refused ---------------------------------------------
do $$
declare
  v_token text;
  v_ok boolean := false;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035aa01');
  select token into v_token from public.mint_room_invite_token('AAAAAA', 900);

  perform pg_temp.as_admin();
  update public.room_invite_tokens
  set expires_at = now() - interval '1 second'
  where token = v_token;

  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035bb02');
  begin
    perform public.redeem_room_invite_token(v_token);
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'an expired token was redeemed';
  end if;
end $$;

-- 5. Revocation works and is issuer-only -------------------------------------
do $$
declare
  v_token text;
  v_ok boolean := false;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035aa01');
  select token into v_token from public.mint_room_invite_token('AAAAAA', 900);

  -- A non-issuer revoke is a silent no-op, never an error that confirms the
  -- token exists.
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035cc03');
  perform public.revoke_room_invite_token(v_token);

  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035bb02');
  if public.redeem_room_invite_token(v_token) <> 'AAAAAA' then
    raise exception 'a non-issuer revoke wrongly killed the token';
  end if;

  -- The issuer's own revoke does take effect.
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035aa01');
  select token into v_token from public.mint_room_invite_token('AAAAAA', 900);
  perform public.revoke_room_invite_token(v_token);

  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035bb02');
  begin
    perform public.redeem_room_invite_token(v_token);
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'a revoked token was redeemed';
  end if;
end $$;

-- 6. Blocks stop redemption ---------------------------------------------------
do $$
declare
  v_token text;
  v_ok boolean := false;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035aa01');
  select token into v_token from public.mint_room_invite_token('AAAAAA', 900);

  perform pg_temp.as_admin();
  insert into public.user_blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-00000035bb02',
          '00000000-0000-0000-0000-00000035aa01')
  on conflict do nothing;

  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035bb02');
  begin
    perform public.redeem_room_invite_token(v_token);
  exception when others then
    if sqlerrm <> 'blocked' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'a blocked pair redeemed an invite';
  end if;

  perform pg_temp.as_admin();
  delete from public.user_blocks
  where blocker_id = '00000000-0000-0000-0000-00000035bb02';
end $$;

-- 7. A garbage/unknown token is indistinguishable from a spent one -----------
do $$
declare v_ok boolean;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035bb02');

  v_ok := false;
  begin
    perform public.redeem_room_invite_token(repeat('f', 32));
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'an unknown token was redeemed'; end if;

  v_ok := false;
  begin
    perform public.redeem_room_invite_token('not-a-token');
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'a malformed token was accepted'; end if;

  v_ok := false;
  begin
    perform public.redeem_room_invite_token(null);
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'a null token was accepted'; end if;
end $$;

-- 8. Clients cannot read the token table directly ----------------------------
do $$
declare v_ok boolean := false;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035aa01');
  begin
    perform * from public.room_invite_tokens;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'a client read room_invite_tokens directly';
  end if;
end $$;

-- 9. The internal rate-limit helper is not callable by clients ---------------
do $$
declare v_ok boolean := false;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000035aa01');
  begin
    perform public.under_limit_invite_tokens('00000000-0000-0000-0000-00000035aa01');
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'under_limit_invite_tokens is exposed to clients';
  end if;
end $$;

select 'phase35 invite token test: all assertions passed' as result;

rollback;
