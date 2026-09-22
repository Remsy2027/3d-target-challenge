export type RoomStatus = "lobby" | "active" | "results" | "closed";

export interface Room {
  id: string;
  code: string;
  host_player_id: string;
  status: RoomStatus;
  active_round_id: string | null;
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
  target_type: "normal" | "bonus";
  points: 10 | 25;
  pos_x: number;
  pos_y: number;
  pos_z: number;
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

/** Client-side combo/accuracy tracking (not persisted to DB) */
export interface ClientStats {
  streak: number;
  bestStreak: number;
  hits: number;
  misses: number;
  multiplier: number;
}

export function getMultiplier(streak: number): number {
  if (streak >= 10) return 3;
  if (streak >= 5) return 2;
  if (streak >= 3) return 1.5;
  return 1;
}
