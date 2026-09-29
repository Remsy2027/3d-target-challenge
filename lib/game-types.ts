export type RoomStatus = "lobby" | "active" | "results" | "closed";
export type ArenaTheme = "cyber" | "volcanic" | "neon";
export type GameMode = "classic" | "survival" | "blitz";
export type TargetType = "normal" | "bonus" | "decoy" | "speed" | "moving" | "time_freeze" | "double_points" | "shield";

export interface Room {
  id: string;
  code: string;
  host_player_id: string;
  status: RoomStatus;
  active_round_id: string | null;
  game_mode: GameMode;
}

export interface Player {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string;
  is_ready: boolean;
  joined_at: string;
}

export interface GameRound {
  id: string;
  room_id: string;
  round_number: number;
  status: "active" | "results";
  starts_at: string;
  ends_at: string;
}

export interface RoundPlayer {
  round_id: string;
  player_id: string;
  score: number;
  last_hit_at: string | null;
}

export interface RoundTarget {
  round_id: string;
  target_index: number;
  target_type: TargetType;
  points: number;
  pos_x: number;
  pos_y: number;
  pos_z: number;
  velocity_x?: number;
  velocity_y?: number;
  starts_at: string;
  ends_at: string;
}

export interface RoomSnapshot {
  room: Room;
  players: Player[];
  round: GameRound | null;
  roundPlayers: RoundPlayer[];
  targets: RoundTarget[];
  hitTargetIndexes: number[];
}

/**
 * Response payload of the submit_hit RPC. `score`/`streak`/`multiplier` are
 * authoritative; the client mirrors them into ClientStats for instant UI.
 */
export interface SubmitHitResult {
  accepted: boolean;
  score: number;
  awarded: number;
  streak: number;
  multiplier: number;
}

/**
 * Client-side combo/accuracy/powerup tracking (not persisted to DB).
 *
 * The authoritative streak/multiplier/double/shield/freeze state lives in
 * round_players (see supabase/migrations/202609220004_powerups_server_side.sql);
 * these fields are a local mirror used for instant UI feedback and are reconciled
 * with the server response after every accepted hit.
 */
export interface ClientStats {
  streak: number;
  bestStreak: number;
  hits: number;
  misses: number;
  multiplier: number;
  shieldActive: boolean;
  doublePointsHitsRemaining: number;
  freezeCharges: number;
}

/**
 * Mirror of the multiplier table in submit_hit (migration 202609220004).
 * Keep in sync with the server — this is the optimistic UI's prediction only;
 * the submit_hit response's `multiplier` field is authoritative.
 */
export function getMultiplier(streak: number): number {
  if (streak >= 10) return 3;
  if (streak >= 5) return 2;
  if (streak >= 3) return 1.5;
  return 1;
}
