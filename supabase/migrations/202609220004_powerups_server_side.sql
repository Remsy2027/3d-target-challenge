-- Migration 4: server-authoritative powerups + survival target-count fix.
-- Run AFTER 202609220003_game_modes_targets_powerups.sql.
--
-- Before this migration the client "computed" streak multipliers, double points,
-- shield, and time freeze locally while submit_hit awarded flat target points, so
-- the server leaderboard ignored powerups entirely, and hitting a decoy at a score
-- of 0 crashed the score update against the score >= 0 check constraint. This
-- migration makes submit_hit the single source of truth and fixes the survival
-- constraint crash.

-- 0. This migration assumes migration 3 already created the two-argument
--    start_round and the game_mode/velocity columns. Running it first otherwise
--    fails deep inside with the opaque "function public.start_round(uuid, text)
--    does not exist" from the GRANT at the bottom, and because the SQL Editor runs
--    a script in one transaction the whole migration silently rolls back.
do $$
begin
  if to_regprocedure('public.start_round(uuid, text)') is null then
    raise exception 'Run 202609220003_game_modes_targets_powerups.sql before this migration.'
      using hint = 'Migration 4 rewrites submit_hit and widens constraints; it relies on migration 3 having created the two-argument start_round. Migrations must be applied in numeric order.';
  end if;
end;
$$;

-- 1. Survival mode generates 100 targets, but the original check capped indexes at
--    59, which made start_round fail with a constraint violation at target 60.
alter table public.round_targets drop constraint if exists round_targets_target_index_check;
alter table public.round_targets add constraint round_targets_target_index_check check (target_index between 0 and 199);

-- 2. Per-player round state for streaks and powerups (fresh rows every round).
alter table public.round_players
  add column if not exists current_streak integer not null default 0,
  add column if not exists double_hits_remaining integer not null default 0,
  add column if not exists shield_charges integer not null default 0,
  add column if not exists freeze_charges integer not null default 0;

-- 3. submit_hit becomes the single source of truth for scoring.
create or replace function public.submit_hit(p_player_id uuid, p_round_id uuid, p_target_index integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.round_targets%rowtype;
  v_rp public.round_players%rowtype;
  v_now timestamptz := clock_timestamp();
  v_window_ms integer := 400;
  v_inserted integer;
  v_score integer;
  v_awarded integer := 0;
  v_streak integer := 0;
  v_multiplier numeric := 1;
  v_effective_points numeric;
begin
  -- Must be an active participant in an active round. Lock the row so two
  -- near-simultaneous submissions cannot double-apply powerup state.
  select rp.* into v_rp
  from public.round_players rp
  join public.players p on p.id = rp.player_id
  join public.rounds r on r.id = rp.round_id
  where rp.round_id = p_round_id and rp.player_id = p_player_id and p.user_id = auth.uid() and r.status = 'active'
  for update of rp;
  if not found then raise exception 'You are not an active player in this round.'; end if;

  select * into v_target from public.round_targets where round_id = p_round_id and target_index = p_target_index;
  if not found then raise exception 'Target not found.'; end if;

  -- Time freeze: a held charge widens this target's acceptance window by 400 ms.
  if v_rp.freeze_charges > 0 then
    v_window_ms := v_window_ms + 400;
  end if;

  if v_now < v_target.starts_at - interval '100 milliseconds' or v_now > v_target.ends_at + (v_window_ms || ' milliseconds')::interval then
    raise exception 'Target is no longer active.';
  end if;

  -- Idempotent duplicate-hit guard (unique key on round/player/target).
  insert into public.hits (round_id, player_id, target_index, points)
  values (p_round_id, p_player_id, p_target_index, v_target.points)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select score into v_score from public.round_players where round_id = p_round_id and player_id = p_player_id;
    return jsonb_build_object('accepted', false, 'score', v_score, 'awarded', 0, 'streak', v_rp.current_streak, 'multiplier', 1);
  end if;

  -- Server-side streak: targets appear strictly sequentially, so the streak is the
  -- count of consecutive non-decoy hits ending at the previous index. A held shield
  -- charge bridges exactly one unshot miss (never a deliberately shot decoy).
  -- This mirrors getMultiplier() in lib/game-types.ts — keep the two tables in sync.
  if v_target.target_type <> 'decoy' then
    v_streak := 1;
    loop
      if exists (
        select 1
        from public.hits h
        join public.round_targets t on t.round_id = h.round_id and t.target_index = h.target_index
        where h.round_id = p_round_id and h.player_id = p_player_id
          and h.target_index = v_target.target_index - v_streak
          and t.target_type <> 'decoy'
      ) then
        v_streak := v_streak + 1;
      elsif v_rp.shield_charges > 0
        and not exists (select 1 from public.hits where round_id = p_round_id and player_id = p_player_id and target_index = v_target.target_index - v_streak)
        and exists (
          select 1
          from public.hits h
          join public.round_targets t on t.round_id = h.round_id and t.target_index = h.target_index
          where h.round_id = p_round_id and h.player_id = p_player_id
            and h.target_index = v_target.target_index - v_streak - 1
            and t.target_type <> 'decoy'
        ) then
        v_rp.shield_charges := v_rp.shield_charges - 1;
        v_streak := v_streak + 1;
      else
        exit;
      end if;
    end loop;
  end if;

  v_multiplier := case
    when v_streak >= 10 then 3
    when v_streak >= 5 then 2
    when v_streak >= 3 then 1.5
    else 1
  end;

  if v_target.target_type = 'decoy' then
    -- Applied with greatest(0, ...) below so the score >= 0 check can never fire.
    v_awarded := -15;
  elsif v_target.target_type in ('time_freeze', 'double_points', 'shield') then
    v_awarded := 0;
  else
    v_effective_points := v_target.points * v_multiplier;
    if v_rp.double_hits_remaining > 0 then
      v_effective_points := v_effective_points * 2;
    end if;
    v_awarded := round(v_effective_points)::integer;
  end if;

  update public.round_players set
    score = greatest(0, score + v_awarded),
    current_streak = v_streak,
    last_hit_at = v_now,
    double_hits_remaining = case
      when v_target.target_type = 'double_points' then 5
      when v_awarded > 0 and v_rp.double_hits_remaining > 0 then v_rp.double_hits_remaining - 1
      else v_rp.double_hits_remaining
    end,
    shield_charges = case
      when v_target.target_type = 'shield' then v_rp.shield_charges + 1
      else v_rp.shield_charges
    end,
    freeze_charges = case
      when v_target.target_type = 'time_freeze' then v_rp.freeze_charges + 1
      when v_target.target_type <> 'decoy' and v_window_ms > 400 then v_rp.freeze_charges - 1
      else v_rp.freeze_charges
    end
  where round_id = p_round_id and player_id = p_player_id
  returning score into v_score;

  return jsonb_build_object(
    'accepted', true,
    'score', v_score,
    'awarded', v_awarded,
    'streak', v_streak,
    'multiplier', v_multiplier
  );
end;
$$;

-- Migration 3 replaced start_round with a two-argument overload but never re-applied
-- the hardened grants from migration 1, leaving the security-definer function
-- executable by the public role. Restore the migration 1 posture.
revoke all on function public.start_round(uuid, text) from public;
grant execute on function public.start_round(uuid, text) to authenticated;
