-- Phase 21: fix an unwinnable border.
-- Apply AFTER 0016_highlights.sql. Rollback notes at the bottom.
--
-- Found by the frontend lane during Phase 20 integration.
--
-- The "First Night" border requires achievement id 'first-room'. No such
-- achievement exists: the tracker (AchievementTracker.ts) has always called it
-- 'first-night', and player_achievements therefore only ever contains
-- 'first-night'. unlock_border compares the catalog's required id against what
-- is recorded, so the requirement could never be satisfied by anyone, ever.
-- The border was decorative and permanently unreachable, and nothing errored —
-- it just silently refused, which is why it survived to now.
--
-- The BORDER id stays 'first-room'. Only the requirement is corrected. Renaming
-- the border id would break player_stats.selected_border_id and
-- player_border_unlocks, both of which reference it — and would cost anyone who
-- somehow holds it their selection. The achievement id is the wrong one, so the
-- achievement id is what changes.
--
-- The other three borders (streak-3/7/30) already match real achievement ids
-- and are left alone. This was the only broken row; the whole catalog was
-- checked.

update public.profile_borders
set required_achievement_id = 'first-night'
where id = 'first-room'
  and required_achievement_id = 'first-room';

-- Guard: if a future migration seeds a border against an achievement the client
-- never awards, it is unwinnable in exactly the same silent way. This makes the
-- next one fail loudly at migration time instead.
do $$
declare
  known_achievements constant text[] := array[
    'first-night', 'regular', 'veteran', 'marathon', 'binge-lord',
    'reactor', 'chatterbox', 'curator', 'streak-3', 'streak-7', 'streak-30'
  ];
  orphan text;
begin
  select b.required_achievement_id into orphan
  from profile_borders b
  where b.required_achievement_id is not null
    and not (b.required_achievement_id = any (known_achievements))
  limit 1;

  if orphan is not null then
    raise exception
      'Border requires achievement "%", which the client never awards — it would be unwinnable',
      orphan;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run before 0016's rollback)
-- ---------------------------------------------------------------------------
--   update public.profile_borders
--   set required_achievement_id = 'first-room'
--   where id = 'first-room';
--   -- (Restores the unwinnable state. There is no reason to want this.)
