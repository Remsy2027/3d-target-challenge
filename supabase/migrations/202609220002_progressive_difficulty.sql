-- Progressive difficulty: targets start with 1200ms visibility and decrease to 600ms.
-- Run this migration AFTER the initial core_game migration.
-- It replaces the start_round function with a version that ramps difficulty.

create or replace function public.start_round(p_player_id uuid)
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
begin
  select r.* into v_room from public.rooms r join public.players p on p.room_id = r.id
  where p.id = p_player_id and p.user_id = auth.uid() for update of r;
  if not found then raise exception 'Room not found.'; end if;
  if v_room.host_player_id <> p_player_id then raise exception 'Only the host can start.'; end if;
  if v_room.status <> 'lobby' then raise exception 'The room is not in the lobby.'; end if;
  if (select count(*) from public.players where room_id = v_room.id and is_ready) < 2 then raise exception 'At least 2 players must be ready.'; end if;

  select coalesce(max(round_number), 0) + 1 into v_round_number from public.rounds where room_id = v_room.id;

  -- Calculate total round duration: targets progressively speed up from 1200ms to 600ms
  -- Each target i (0-59) has duration: 1200 - (i * 10) ms, clamped to minimum 600ms
  -- Plus a 100ms gap between targets
  v_cumulative_ms := 0;
  for i in 0..59 loop
    v_duration_ms := greatest(600, 1200 - i * 10);
    v_cumulative_ms := v_cumulative_ms + v_duration_ms + 100;
  end loop;

  insert into public.rounds (room_id, round_number, starts_at, ends_at)
  values (v_room.id, v_round_number, v_starts_at, v_starts_at + (v_cumulative_ms || ' milliseconds')::interval)
  returning id into v_round_id;

  insert into public.round_players (round_id, player_id)
  select v_round_id, id from public.players where room_id = v_room.id and is_ready;

  -- Insert targets with progressive difficulty
  v_cumulative_ms := 0;
  for i in 0..59 loop
    v_duration_ms := greatest(600, 1200 - i * 10);
    v_offset := (v_cumulative_ms || ' milliseconds')::interval;

    insert into public.round_targets (round_id, target_index, target_type, points, pos_x, pos_y, pos_z, starts_at, ends_at)
    values (
      v_round_id,
      i,
      case when random() < 0.2 then 'bonus' else 'normal' end,
      10,
      (-3.05 + random() * 6.10)::real,
      (-1.75 + random() * 3.50)::real,
      (-0.45 + random() * 0.90)::real,
      v_starts_at + v_offset,
      v_starts_at + v_offset + (v_duration_ms || ' milliseconds')::interval
    );

    v_cumulative_ms := v_cumulative_ms + v_duration_ms + 100;
  end loop;

  update public.round_targets set points = 25 where round_id = v_round_id and target_type = 'bonus';
  update public.rooms set status = 'active', active_round_id = v_round_id, updated_at = clock_timestamp() where id = v_room.id;
  return jsonb_build_object('round_id', v_round_id, 'starts_at', v_starts_at);
end;
$$;
