-- Phase 35: opaque, single-use room invite tokens.
--
-- Problem this solves. Discord Rich Presence "join" requires a joinSecret,
-- and the obvious implementation puts the ROOM CODE in it. A room code is a
-- permanent, reusable credential — anyone who ever sees that presence payload
-- can rejoin forever. That breaks the standing rule that room codes never
-- appear in presence.
--
-- Solution: presence carries a TOKEN, never a code. A token is
--   * opaque (32 random hex characters, unrelated to the room),
--   * short-lived (default 15 minutes),
--   * single-use (redeeming marks it spent),
--   * revocable by its issuer,
--   * block-aware at redemption time.
-- An intercepted token is therefore already dead, or dies on first use by its
-- intended recipient. This is strictly safer than the status quo of pasting a
-- permanent room code into a Discord channel that keeps history forever.
--
-- Depends on: 0006 (user_blocks/is_blocked), 0007 (require_auth), 0020
-- (social_audit), 0023 (live_room_key_hash + live_room_social_presence).

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- Table. RPC-only: RLS forced, zero client privileges. The room code is
-- stored so redemption can return it, which is exactly why no client may read
-- this table directly.
-- ---------------------------------------------------------------------------

create table if not exists public.room_invite_tokens (
  token text primary key check (token ~ '^[0-9a-f]{32}$'),
  room_code text not null
    check (room_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'),
  issuer_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);

create index if not exists room_invite_tokens_issuer_idx
  on public.room_invite_tokens (issuer_id, created_at desc);
create index if not exists room_invite_tokens_expiry_idx
  on public.room_invite_tokens (expires_at);

alter table public.room_invite_tokens enable row level security;
alter table public.room_invite_tokens force row level security;
revoke all on public.room_invite_tokens from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Issuance rate limit (internal).
-- ---------------------------------------------------------------------------

create or replace function public.under_limit_invite_tokens(p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select count(*) < 30
  from room_invite_tokens
  where issuer_id = p_user and created_at > now() - interval '1 hour';
$$;

revoke execute on function public.under_limit_invite_tokens(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Mint. The caller must currently BE in the room (fresh heartbeat), so a
-- token cannot be minted for a room you merely know the code of.
-- ---------------------------------------------------------------------------

create or replace function public.mint_room_invite_token(
  p_room_code text,
  p_ttl_seconds integer default 900
)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := public.require_auth();
  v_code text := upper(trim(coalesce(p_room_code, '')));
  v_hash text := public.live_room_key_hash(p_room_code);
  v_ttl integer := least(greatest(coalesce(p_ttl_seconds, 900), 60), 3600);
  v_token text;
  v_expires timestamptz;
begin
  if not public.is_live_room_member_hash(v_user, v_hash) then
    raise exception 'forbidden';
  end if;
  if not public.under_limit_invite_tokens(v_user) then
    raise exception 'rate-limited';
  end if;

  v_token := encode(extensions.gen_random_bytes(16), 'hex');
  v_expires := now() + make_interval(secs => v_ttl);

  insert into room_invite_tokens (token, room_code, issuer_id, expires_at)
  values (v_token, v_code, v_user, v_expires);

  -- Opportunistic cleanup: dead tokens are worthless, keep the table small.
  --
  -- The alias is load-bearing. This function's RETURNS TABLE declares OUT
  -- variables named `token` and `expires_at`, so an unqualified `expires_at`
  -- here is ambiguous between the variable and the column (42702). Every
  -- statement in this function that touches those two columns must qualify
  -- them through an alias.
  delete from room_invite_tokens t
  where t.expires_at < now() - interval '1 day';

  return query select v_token, v_expires;
end;
$$;

-- ---------------------------------------------------------------------------
-- Redeem. Single-use, expiry-checked, block-aware. Returns the room code ONLY
-- on a successful redemption — this is the one place a code leaves the server
-- via this path, and it goes to one authenticated redeemer, once.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_room_invite_token(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_auth();
  v_row room_invite_tokens%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    raise exception 'forbidden';
  end if;

  -- Lock the row so two simultaneous redemptions cannot both succeed.
  select * into v_row
  from room_invite_tokens
  where token = p_token
  for update;

  if not found
     or v_row.revoked_at is not null
     or v_row.redeemed_at is not null
     or v_row.expires_at <= now() then
    -- One indistinguishable answer for missing/spent/expired/revoked: a
    -- redeemer must not be able to probe which tokens ever existed.
    raise exception 'forbidden';
  end if;

  if public.is_blocked(v_row.issuer_id, v_user)
     or public.is_blocked(v_user, v_row.issuer_id) then
    raise exception 'blocked';
  end if;

  update room_invite_tokens
  set redeemed_at = now(), redeemed_by = v_user
  where token = p_token;

  return v_row.room_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Revoke. The issuer may kill an outstanding token (they stopped sharing, or
-- posted it somewhere they regret).
-- ---------------------------------------------------------------------------

create or replace function public.revoke_room_invite_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_auth();
begin
  update room_invite_tokens
  set revoked_at = now()
  where token = p_token
    and issuer_id = v_user
    and redeemed_at is null
    and revoked_at is null;
end;
$$;

grant execute on function public.mint_room_invite_token(text, integer) to authenticated;
grant execute on function public.redeem_room_invite_token(text) to authenticated;
grant execute on function public.revoke_room_invite_token(text) to authenticated;
revoke execute on function public.mint_room_invite_token(text, integer) from public, anon;
revoke execute on function public.redeem_room_invite_token(text) from public, anon;
revoke execute on function public.revoke_room_invite_token(text) from public, anon;

-- Rollback (manual):
--   drop function if exists public.revoke_room_invite_token(text);
--   drop function if exists public.redeem_room_invite_token(text);
--   drop function if exists public.mint_room_invite_token(text, integer);
--   drop function if exists public.under_limit_invite_tokens(uuid);
--   drop table if exists public.room_invite_tokens;
