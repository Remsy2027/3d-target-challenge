-- ============================================================================
-- 3D Target Challenge — apply the MISSING migrations in one paste
-- ============================================================================
--
-- Use this only when the project already has migrations 1 and 2 applied.
-- Symptom you are fixing:
--   "Could not find the function public.start_round(p_game_mode, p_player_id)
--    in the schema cache"
-- which means the two-argument start_round from migration 3 was never created.
--
-- How to run:
--   1. Open your Supabase project → SQL Editor → New query.
--   2. Paste this ENTIRE file (do not paste only its second half) and run it once.
--   3. Reload the game. No schema reload command is needed; running DDL already
--      tells PostgREST to refresh its cache.
--
-- The most common mistake is running 202609220004_powerups_server_side.sql on its
-- own: it fails with "function public.start_round(uuid, text) does not exist", and
-- because the SQL Editor wraps a script in one transaction, nothing is applied at
-- all. Both migrations must run together, in this order.
--
-- To verify afterwards, run the checks at the bottom of this file.
--
-- GENERATED FROM (keep in sync; edit the numbered migration, not this file):
--   supabase/migrations/202609220003_game_modes_targets_powerups.sql
--   supabase/migrations/202609220004_powerups_server_side.sql
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- From 202609220003_game_modes_targets_powerups.sql
-- ----------------------------------------------------------------------------
-- Migration for new Game Modes, Target Types, and Power-ups

-- 1. Add game_mode to rooms
alter table public.rooms add column if not exists game_mode text not null default 'classic' check (game_mode in ('classic', 'survival', 'blitz'));

-- 2. Update constraints for target types and points
alter table public.round_targets drop constraint if exists round_targets_target_type_check;
alter table public.round_targets add constraint round_targets_target_type_check check (target_type in ('normal', 'bonus', 'decoy', 'speed', 'moving', 'time_freeze', 'double_points', 'shield'));

alter table public.round_targets drop constraint if exists round_targets_points_check;
alter table public.hits drop constraint if exists hits_points_check;

-- 3. Add velocity columns for moving targets
alter table public.round_targets add column if not exists velocity_x real default 0;
alter table public.round_targets add column if not exists velocity_y real default 0;

-- 4. Recreate start_round with mode parameter and advanced target generation
drop function if exists public.start_round(uuid);

create or replace function public.start_round(p_player_id uuid, p_game_mode text default 'classic')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms%rowtype;
  v_round_id uuid;
  v_round_number integer;
  v_starts_at timestamptz := clock_timestamp() + interval '3 seconds';
  v_duration_ms integer;
  v_offset interval;
  v_cumulative_ms integer := 0;
  v_target_count integer := 60;
  v_type text;
  v_points integer;
  v_vel_x real := 0;
  v_vel_y real := 0;
  v_rand real;
begin
  select r.* into v_room from public.rooms r join public.players p on p.room_id = r.id
  where p.id = p_player_id and p.user_id = auth.uid() for update of r;
  
  if not found then raise exception 'Room not found.'; end if;
  if v_room.host_player_id <> p_player_id then raise exception 'Only the host can start.'; end if;
  if v_room.status <> 'lobby' then raise exception 'The room is not in the lobby.'; end if;
  if (select count(*) from public.players where room_id = v_room.id and is_ready) < 2 then raise exception 'At least 2 players must be ready.'; end if;

  update public.rooms set game_mode = p_game_mode where id = v_room.id;

  select coalesce(max(round_number), 0) + 1 into v_round_number from public.rounds where room_id = v_room.id;

  if p_game_mode = 'blitz' then
    v_target_count := 30;
  elsif p_game_mode = 'survival' then
    v_target_count := 100;
  end if;

  -- Calculate total duration first
  v_cumulative_ms := 0;
  for i in 0..(v_target_count - 1) loop
    if p_game_mode = 'blitz' then
      v_duration_ms := 500;
    else
      -- Classic/Survival progressive speed
      v_duration_ms := greatest(600, 1200 - i * (1200 - 600) / v_target_count);
    end if;
    v_cumulative_ms := v_cumulative_ms + v_duration_ms + 100;
  end loop;

  insert into public.rounds (room_id, round_number, starts_at, ends_at)
  values (v_room.id, v_round_number, v_starts_at, v_starts_at + (v_cumulative_ms || ' milliseconds')::interval)
  returning id into v_round_id;

  insert into public.round_players (round_id, player_id)
  select v_round_id, id from public.players where room_id = v_room.id and is_ready;

  v_cumulative_ms := 0;
  for i in 0..(v_target_count - 1) loop
    if p_game_mode = 'blitz' then
      v_duration_ms := 500;
    else
      v_duration_ms := greatest(600, 1200 - i * (1200 - 600) / v_target_count);
    end if;
    
    v_offset := (v_cumulative_ms || ' milliseconds')::interval;
    v_rand := random();
    v_vel_x := 0;
    v_vel_y := 0;
    
    -- Determine Target Type
    if v_rand < 0.05 then
      v_type := 'time_freeze';
      v_points := 0;
    elsif v_rand < 0.10 then
      v_type := 'double_points';
      v_points := 0;
    elsif v_rand < 0.15 then
      v_type := 'shield';
      v_points := 0;
    elsif v_rand < 0.25 then
      v_type := 'decoy';
      v_points := -15;
    elsif v_rand < 0.33 then
      v_type := 'speed';
      v_points := 50;
      v_duration_ms := 400; -- overwrite duration for speed
    elsif v_rand < 0.50 and i > 25 then
      v_type := 'moving';
      v_points := 15;
      v_vel_x := -1.5 + random() * 3.0;
      v_vel_y := -1.0 + random() * 2.0;
    elsif v_rand < 0.70 then
      v_type := 'bonus';
      v_points := 25;
    else
      v_type := 'normal';
      v_points := 10;
    end if;

    insert into public.round_targets (
      round_id, target_index, target_type, points, 
      pos_x, pos_y, pos_z, velocity_x, velocity_y,
      starts_at, ends_at
    )
    values (
      v_round_id,
      i,
      v_type,
      v_points,
      (-3.05 + random() * 6.10)::real,
      (-1.75 + random() * 3.50)::real,
      (-0.45 + random() * 0.90)::real,
      v_vel_x,
      v_vel_y,
      v_starts_at + v_offset,
      v_starts_at + v_offset + (v_duration_ms || ' milliseconds')::interval
    );

    v_cumulative_ms := v_cumulative_ms + v_duration_ms + 100;
  end loop;

  update public.rooms set status = 'active', active_round_id = v_round_id, updated_at = clock_timestamp() where id = v_room.id;
  return jsonb_build_object('round_id', v_round_id, 'starts_at', v_starts_at);
end;
$$;

-- ----------------------------------------------------------------------------
-- From 202609220004_powerups_server_side.sql
-- ----------------------------------------------------------------------------
-- 0. Guard: this half assumes the two-argument start_round above already exists.
--    Pasting only the second half of this file otherwise fails with an opaque
--    "function public.start_round(uuid, text) does not exist" from the GRANT below.
do $$
begin
  if to_regprocedure('public.start_round(uuid, text)') is null then
    raise exception 'Run 202609220003_game_modes_targets_powerups.sql before this migration.'
      using hint = 'Both migrations must be applied together, in numeric order. Paste this entire file, not just its second half.';
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

commit;

-- ============================================================================
-- Verification — this block is read-only and safe to run on its own.
-- Every row should say OK.
-- ============================================================================
select 'rooms.game_mode' as check, exists (
  select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rooms' and column_name = 'game_mode'
) as ok
union all
select 'round_targets.velocity_x', exists (
  select 1 from information_schema.columns where table_schema = 'public' and table_name = 'round_targets' and column_name = 'velocity_x'
)
union all
select 'round_players.current_streak', exists (
  select 1 from information_schema.columns where table_schema = 'public' and table_name = 'round_players' and column_name = 'current_streak'
)
union all
select 'start_round(uuid, text)', exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'start_round' and p.pronargs = 2
)
union all
select 'start_round with 1 arg is gone', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'start_round' and p.pronargs = 1
);
