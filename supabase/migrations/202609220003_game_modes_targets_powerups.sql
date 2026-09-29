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
