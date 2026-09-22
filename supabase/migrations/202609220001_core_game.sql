create extension if not exists pgcrypto;

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  host_player_id uuid,
  status text not null default 'lobby' check (status in ('lobby', 'active', 'results', 'closed')),
  active_round_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '12 hours')
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null,
  display_name text not null check (char_length(display_name) between 2 and 20),
  is_ready boolean not null default false,
  joined_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  unique (room_id, user_id)
);

create unique index players_room_name_unique on public.players (room_id, lower(display_name));

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  status text not null default 'active' check (status in ('active', 'results')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (room_id, round_number),
  check (ends_at > starts_at)
);

create table public.round_players (
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  score integer not null default 0 check (score >= 0),
  last_hit_at timestamptz,
  primary key (round_id, player_id)
);

create table public.round_targets (
  round_id uuid not null references public.rounds(id) on delete cascade,
  target_index integer not null check (target_index between 0 and 59),
  target_type text not null check (target_type in ('normal', 'bonus')),
  points integer not null check (points in (10, 25)),
  pos_x real not null check (pos_x between -3.3 and 3.3),
  pos_y real not null check (pos_y between -2.1 and 2.1),
  pos_z real not null check (pos_z between -0.7 and 0.7),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  primary key (round_id, target_index),
  check (ends_at > starts_at)
);

create table public.hits (
  round_id uuid not null,
  player_id uuid not null,
  target_index integer not null,
  points integer not null check (points in (10, 25)),
  created_at timestamptz not null default clock_timestamp(),
  primary key (round_id, player_id, target_index),
  foreign key (round_id, player_id) references public.round_players(round_id, player_id) on delete cascade,
  foreign key (round_id, target_index) references public.round_targets(round_id, target_index) on delete cascade
);

alter table public.rooms add constraint rooms_host_player_fk foreign key (host_player_id) references public.players(id) on delete set null;
alter table public.rooms add constraint rooms_active_round_fk foreign key (active_round_id) references public.rounds(id) on delete set null;

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.players
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.rounds enable row level security;
alter table public.round_players enable row level security;
alter table public.round_targets enable row level security;
alter table public.hits enable row level security;

create policy rooms_member_read on public.rooms for select to authenticated using (public.is_room_member(id));
create policy players_member_read on public.players for select to authenticated using (public.is_room_member(room_id));
create policy rounds_member_read on public.rounds for select to authenticated using (public.is_room_member(room_id));
create policy round_players_member_read on public.round_players for select to authenticated using (
  exists (select 1 from public.rounds r where r.id = round_id and public.is_room_member(r.room_id))
);
create policy round_targets_member_read on public.round_targets for select to authenticated using (
  exists (select 1 from public.rounds r where r.id = round_id and public.is_room_member(r.room_id))
);
create policy own_hits_read on public.hits for select to authenticated using (
  exists (select 1 from public.players p where p.id = player_id and p.user_id = auth.uid())
);

grant select on public.rooms, public.players, public.rounds, public.round_players, public.round_targets, public.hits to authenticated;

create or replace function public.make_room_code()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
begin
  for i in 1..6 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
  end loop;
  return result;
end;
$$;

create or replace function public.server_now()
returns timestamptz
language sql
stable
as $$ select clock_timestamp(); $$;

create or replace function public.create_room(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room_id uuid;
  v_player_id uuid;
  v_code text;
  v_name text := btrim(p_display_name);
begin
  if auth.uid() is null then raise exception 'Player session is missing.'; end if;
  if char_length(v_name) not between 2 and 20 then raise exception 'Name must contain 2–20 characters.'; end if;

  loop
    v_code := public.make_room_code();
    begin
      insert into public.rooms (code) values (v_code) returning id into v_room_id;
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;

  insert into public.players (room_id, user_id, display_name)
  values (v_room_id, auth.uid(), v_name)
  returning id into v_player_id;

  update public.rooms set host_player_id = v_player_id where id = v_room_id;
  return jsonb_build_object('room_id', v_room_id, 'player_id', v_player_id, 'code', v_code);
end;
$$;

create or replace function public.join_room(p_code text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms%rowtype;
  v_player_id uuid;
  v_name text := btrim(p_display_name);
begin
  if auth.uid() is null then raise exception 'Player session is missing.'; end if;
  if char_length(v_name) not between 2 and 20 then raise exception 'Name must contain 2–20 characters.'; end if;

  select * into v_room from public.rooms where code = upper(btrim(p_code)) for update;
  if not found or v_room.status = 'closed' or v_room.expires_at < clock_timestamp() then raise exception 'Room not found or expired.'; end if;

  select id into v_player_id from public.players where room_id = v_room.id and user_id = auth.uid();
  if found then return jsonb_build_object('room_id', v_room.id, 'player_id', v_player_id, 'code', v_room.code); end if;
  if v_room.status <> 'lobby' then raise exception 'This match is already in progress.'; end if;
  if (select count(*) from public.players where room_id = v_room.id) >= 8 then raise exception 'This room is full.'; end if;
  if exists (select 1 from public.players where room_id = v_room.id and lower(display_name) = lower(v_name)) then raise exception 'That name is already in use in this room.'; end if;

  insert into public.players (room_id, user_id, display_name)
  values (v_room.id, auth.uid(), v_name)
  returning id into v_player_id;
  return jsonb_build_object('room_id', v_room.id, 'player_id', v_player_id, 'code', v_room.code);
end;
$$;

create or replace function public.set_ready(p_player_id uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_room_id uuid;
begin
  select room_id into v_room_id from public.players where id = p_player_id and user_id = auth.uid();
  if not found then raise exception 'Player not found.'; end if;
  if not exists (select 1 from public.rooms where id = v_room_id and status = 'lobby') then raise exception 'Readiness can only change in the lobby.'; end if;
  update public.players set is_ready = p_ready, last_seen_at = clock_timestamp() where id = p_player_id;
end;
$$;

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
begin
  select r.* into v_room from public.rooms r join public.players p on p.room_id = r.id
  where p.id = p_player_id and p.user_id = auth.uid() for update of r;
  if not found then raise exception 'Room not found.'; end if;
  if v_room.host_player_id <> p_player_id then raise exception 'Only the host can start.'; end if;
  if v_room.status <> 'lobby' then raise exception 'The room is not in the lobby.'; end if;
  if (select count(*) from public.players where room_id = v_room.id and is_ready) < 2 then raise exception 'At least 2 players must be ready.'; end if;

  select coalesce(max(round_number), 0) + 1 into v_round_number from public.rounds where room_id = v_room.id;
  insert into public.rounds (room_id, round_number, starts_at, ends_at)
  values (v_room.id, v_round_number, v_starts_at, v_starts_at + interval '60 seconds')
  returning id into v_round_id;

  insert into public.round_players (round_id, player_id)
  select v_round_id, id from public.players where room_id = v_room.id and is_ready;

  insert into public.round_targets (round_id, target_index, target_type, points, pos_x, pos_y, pos_z, starts_at, ends_at)
  select
    v_round_id,
    i,
    case when random() < 0.2 then 'bonus' else 'normal' end,
    10,
    (-3.05 + random() * 6.10)::real,
    (-1.75 + random() * 3.50)::real,
    (-0.45 + random() * 0.90)::real,
    v_starts_at + (i * interval '1 second'),
    v_starts_at + (i * interval '1 second') + interval '900 milliseconds'
  from generate_series(0, 59) as series(i);

  update public.round_targets set points = 25 where round_id = v_round_id and target_type = 'bonus';
  update public.rooms set status = 'active', active_round_id = v_round_id, updated_at = clock_timestamp() where id = v_room.id;
  return jsonb_build_object('round_id', v_round_id, 'starts_at', v_starts_at);
end;
$$;

create or replace function public.submit_hit(p_player_id uuid, p_round_id uuid, p_target_index integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.round_targets%rowtype;
  v_now timestamptz := clock_timestamp();
  v_inserted integer;
  v_score integer;
begin
  if not exists (
    select 1 from public.round_players rp
    join public.players p on p.id = rp.player_id
    join public.rounds r on r.id = rp.round_id
    where rp.round_id = p_round_id and rp.player_id = p_player_id and p.user_id = auth.uid() and r.status = 'active'
  ) then raise exception 'You are not an active player in this round.'; end if;

  select * into v_target from public.round_targets where round_id = p_round_id and target_index = p_target_index;
  if not found then raise exception 'Target not found.'; end if;
  if v_now < v_target.starts_at - interval '100 milliseconds' or v_now > v_target.ends_at + interval '400 milliseconds' then raise exception 'Target is no longer active.'; end if;

  insert into public.hits (round_id, player_id, target_index, points)
  values (p_round_id, p_player_id, p_target_index, v_target.points)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update public.round_players set score = score + v_target.points, last_hit_at = v_now
    where round_id = p_round_id and player_id = p_player_id
    returning score into v_score;
  else
    select score into v_score from public.round_players where round_id = p_round_id and player_id = p_player_id;
  end if;
  return jsonb_build_object('accepted', v_inserted = 1, 'score', v_score, 'points', case when v_inserted = 1 then v_target.points else 0 end);
end;
$$;

create or replace function public.finalize_round(p_player_id uuid, p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_round public.rounds%rowtype;
begin
  select r.* into v_round from public.rounds r join public.players p on p.room_id = r.room_id
  where r.id = p_round_id and p.id = p_player_id and p.user_id = auth.uid();
  if not found then raise exception 'Round not found.'; end if;
  if clock_timestamp() < v_round.ends_at then raise exception 'The round has not ended.'; end if;
  update public.rounds set status = 'results' where id = p_round_id and status = 'active';
  update public.rooms set status = 'results', updated_at = clock_timestamp() where id = v_round.room_id and active_round_id = p_round_id;
end;
$$;

create or replace function public.return_to_lobby(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_room public.rooms%rowtype;
begin
  select r.* into v_room from public.rooms r join public.players p on p.room_id = r.id
  where p.id = p_player_id and p.user_id = auth.uid() for update of r;
  if not found then raise exception 'Room not found.'; end if;
  if v_room.host_player_id <> p_player_id then raise exception 'Only the host can open the lobby.'; end if;
  if v_room.status <> 'results' then raise exception 'The round is not finished.'; end if;
  update public.players set is_ready = false where room_id = v_room.id;
  update public.rooms set status = 'lobby', active_round_id = null, updated_at = clock_timestamp(), expires_at = clock_timestamp() + interval '12 hours' where id = v_room.id;
end;
$$;

revoke all on function public.is_room_member(uuid) from public;
revoke all on function public.create_room(text) from public;
revoke all on function public.join_room(text, text) from public;
revoke all on function public.set_ready(uuid, boolean) from public;
revoke all on function public.start_round(uuid) from public;
revoke all on function public.submit_hit(uuid, uuid, integer) from public;
revoke all on function public.finalize_round(uuid, uuid) from public;
revoke all on function public.return_to_lobby(uuid) from public;
grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.server_now() to authenticated;
grant execute on function public.create_room(text) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.set_ready(uuid, boolean) to authenticated;
grant execute on function public.start_round(uuid) to authenticated;
grant execute on function public.submit_hit(uuid, uuid, integer) to authenticated;
grant execute on function public.finalize_round(uuid, uuid) to authenticated;
grant execute on function public.return_to_lobby(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms') then alter publication supabase_realtime add table public.rooms; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'players') then alter publication supabase_realtime add table public.players; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rounds') then alter publication supabase_realtime add table public.rounds; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'round_players') then alter publication supabase_realtime add table public.round_players; end if;
end $$;
