-- Migration 5: retention loop — all-time leaderboard, one-tap rematch, daily challenge.
-- Run AFTER 202609220001_core_game.sql, 202609220002_progressive_difficulty.sql,
-- 202609220003_game_modes_targets_powerups.sql and 202609220004_powerups_server_side.sql.
--
-- Three things keep players coming back, and none of them existed before this
-- migration: a reason to replay (a board to climb), no friction between rounds
-- (a rematch that skips the lobby), and a daily ritual (one identical round for
-- every player in the world, once a day).

-- 1. Daily-challenge marker. The daily is classic *rules* — only its target layout
--    (seeded from the date) and its leaderboard scope differ — so it is a flag on the
--    room rather than a fourth game_mode, which would otherwise have to be threaded
--    through every mode branch including the survival elimination check.
alter table public.rooms add column if not exists is_daily boolean not null default false;
alter table public.rooms add column if not exists daily_date date;

-- 2. start_round gains two optional modes:
--      p_skip_ready = true  → rematch: the players who actually played the previous
--                             round keep their seat, so nobody re-readies. Pulling the
--                             roster from round_players (not from players) also excludes
--                             anyone who left, because leaving only clears localStorage
--                             and leaves their players row behind.
--      p_daily     = true   → daily: seeded from the date, forced to classic, and
--                             playable solo, because a daily that needs a second player
--                             is not a ritual.
--    The defaults reproduce the previous behaviour exactly, so the lobby path is
--    unchanged. The two-argument overload is dropped rather than left beside this one
--    so PostgREST never has to choose between them.
drop function if exists public.start_round(uuid, text);

create or replace function public.start_round(
  p_player_id uuid,
  p_game_mode text default 'classic',
  p_skip_ready boolean default false,
  p_daily boolean default false
)
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
  v_participants uuid[];
  v_mode text := case when p_daily then 'classic' else p_game_mode end;
begin
  select r.* into v_room from public.rooms r join public.players p on p.room_id = r.id
  where p.id = p_player_id and p.user_id = auth.uid() for update of r;

  if not found then raise exception 'Room not found.'; end if;
  if v_room.host_player_id <> p_player_id then raise exception 'Only the host can start.'; end if;
  if v_mode not in ('classic', 'survival', 'blitz') then raise exception 'Unknown game mode.'; end if;

  -- A rematch starts from the results screen; everything else starts in the lobby.
  if p_daily then
    if v_room.status <> 'lobby' then raise exception 'The room is not in the lobby.'; end if;
  elsif p_skip_ready then
    if v_room.status <> 'results' then raise exception 'The round is not finished.'; end if;
  else
    if v_room.status <> 'lobby' then raise exception 'The room is not in the lobby.'; end if;
  end if;

  if p_daily or p_skip_ready then
    if p_daily then
      select array_agg(p.id) into v_participants from public.players p where p.room_id = v_room.id;
    else
      select array_agg(rp.player_id) into v_participants
      from public.round_players rp
      join public.players p on p.id = rp.player_id
      where rp.round_id = v_room.active_round_id and p.room_id = v_room.id;
    end if;
    if v_participants is null or array_length(v_participants, 1) < 1 then
      if p_daily then raise exception 'Nobody is in the room.'; end if;
      raise exception 'There is no previous round to rematch.';
    end if;
  else
    select array_agg(p.id) into v_participants from public.players p where p.room_id = v_room.id and p.is_ready;
    if v_participants is null or array_length(v_participants, 1) < 2 then
      raise exception 'At least 2 players must be ready.';
    end if;
  end if;

  -- Mark or clear the daily before generating, so the leaderboard scope commits
  -- together with the round it describes.
  update public.rooms
  set game_mode = v_mode,
      is_daily = p_daily,
      daily_date = case when p_daily then current_date else null end
  where id = v_room.id;

  select coalesce(max(round_number), 0) + 1 into v_round_number from public.rounds where room_id = v_room.id;

  if v_mode = 'blitz' then
    v_target_count := 30;
  elsif v_mode = 'survival' then
    v_target_count := 100;
  end if;

  -- Daily layouts are identical for every player in the world. Seeding here — after
  -- every other random() caller in this function and immediately before the two
  -- generation loops — makes the layout reproducible, because those loops consume
  -- random() a fixed number of times in a fixed order for a given mode.
  if p_daily then
    perform setseed(mod(abs(hashtext(current_date::text)::bigint), 1000000)::double precision / 1000000.0);
  end if;

  -- Calculate total duration first
  v_cumulative_ms := 0;
  for i in 0..(v_target_count - 1) loop
    if v_mode = 'blitz' then
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
  select v_round_id, t.player_id from unnest(v_participants) as t(player_id);

  v_cumulative_ms := 0;
  for i in 0..(v_target_count - 1) loop
    if v_mode = 'blitz' then
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

-- 3. Thin wrapper for the daily. A separate entry point keeps the client honest: the
--    home screen calls start_daily, and the lobby keeps calling start_round.
create or replace function public.start_daily(p_player_id uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.start_round(p_player_id, 'classic', true, true);
$$;

-- 4. Global leaderboard. round_players and players are both locked to room members by
--    RLS, so the board has to read through a security definer function. It publishes a
--    display name and a score and nothing else — never players.user_id — but it does
--    always include the caller's own row so "you are #47" works even when they are far
--    outside the top N.
create or replace function public.get_leaderboard(p_limit integer default 10, p_daily boolean default false)
returns table ("rank" integer, display_name text, score integer, is_you boolean)
language sql
security definer
set search_path = public, pg_temp
as $$
  with best as (
    select distinct on (p.user_id)
      p.user_id,
      p.display_name,
      rp.score
    from public.round_players rp
    join public.players p on p.id = rp.player_id
    join public.rounds r on r.id = rp.round_id
    join public.rooms ro on ro.id = r.room_id
    where not p_daily or (ro.is_daily and ro.daily_date = current_date)
    order by p.user_id, rp.score desc, rp.last_hit_at desc nulls last
  ),
  ranked as (
    select
      row_number() over (order by b.score desc, b.display_name) as rnk,
      b.user_id,
      b.display_name,
      b.score
    from best b
  )
  select
    r.rnk::integer,
    r.display_name,
    r.score,
    r.user_id = auth.uid() as is_you
  from ranked r
  where r.rnk <= greatest(1, least(p_limit, 100))
     or r.user_id = auth.uid()
  order by r.rnk;
$$;

revoke all on function public.start_round(uuid, text, boolean, boolean) from public;
revoke all on function public.start_daily(uuid) from public;
revoke all on function public.get_leaderboard(integer, boolean) from public;
grant execute on function public.start_round(uuid, text, boolean, boolean) to authenticated;
grant execute on function public.start_daily(uuid) to authenticated;
grant execute on function public.get_leaderboard(integer, boolean) to authenticated;
