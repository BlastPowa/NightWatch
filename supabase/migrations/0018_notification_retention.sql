-- Phase 21: notification retention and dismissal.
-- Apply AFTER 0017_fix_border_achievement_id.sql. Rollback notes at the bottom.
--
-- 0013 gave notifications a writer but no way out. Two consequences that only
-- show up at scale, which is exactly when they are hardest to fix:
--
--   1. The table grows without bound. Every bounty opened in a busy club writes
--      one row per member, forever. Nothing ever deletes one.
--   2. A user cannot dismiss a notification. `notifications` has SELECT and
--      UPDATE policies and no DELETE policy, so mark-as-read is the only
--      disposal there has ever been, and the bell's history is permanent.
--
-- Both are fixed here. Retention is deliberately generous — losing a
-- notification someone had not read yet is worse than storing it a while
-- longer.

-- ---------------------------------------------------------------------------
-- Dismissal. Your bell, your rows.
-- ---------------------------------------------------------------------------

create policy notifications_own_delete on public.notifications
  for delete using (auth.uid() = user_id);

create or replace function public.dismiss_notification(p_notification uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  delete from notifications where id = p_notification and user_id = me;
  return 'ok';  -- Idempotent: dismissing what is already gone is not an error.
end;
$$;

/** Clear the ones you have already read. Never touches unread. */
create or replace function public.clear_read_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  removed integer;
begin
  delete from notifications
  where user_id = me and read_at is not null;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

grant execute on function public.dismiss_notification(uuid) to authenticated;
grant execute on function public.clear_read_notifications() to authenticated;

-- ---------------------------------------------------------------------------
-- Retention.
--
-- Read notifications are transient — you have seen it, it has done its job, and
-- 30 days is long past the point anyone scrolls back. Unread ones are kept far
-- longer (90 days) because deleting something a user never saw is destroying
-- information, not tidying up.
--
-- NOT granted to `authenticated`. A user pruning the whole table is not a thing
-- that should be possible, and a mass DELETE is not something a client should
-- be able to trigger at all. This runs as the service role — from a scheduled
-- Edge Function, or from pg_cron if it is enabled on the project:
--
--   select cron.schedule('prune-notifications', '0 4 * * *',
--                        'select public.prune_notifications()');
--
-- If it is never scheduled, nothing breaks — the table simply keeps growing, as
-- it does today. This makes the cleanup possible, not automatic.
-- ---------------------------------------------------------------------------

create or replace function public.prune_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from notifications
  where (read_at is not null and read_at < now() - interval '30 days')
     or (read_at is null and created_at < now() - interval '90 days');
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_notifications() from public;
revoke all on function public.prune_notifications() from authenticated;
grant execute on function public.prune_notifications() to service_role;

-- The prune scans by age, and the existing index is partial on unread only.
create index if not exists notifications_created_at
  on public.notifications (created_at);

-- ---------------------------------------------------------------------------
-- ROLLBACK (run before 0017's rollback)
-- ---------------------------------------------------------------------------
--   drop index if exists public.notifications_created_at;
--   drop function if exists public.prune_notifications();
--   drop function if exists public.clear_read_notifications();
--   drop function if exists public.dismiss_notification(uuid);
--   drop policy if exists notifications_own_delete on public.notifications;
