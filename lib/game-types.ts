export type RoomStatus = "lobby" | "active" | "results" | "closed";
export type ArenaTheme = "cyber" | "volcanic" | "neon";
export type GameMode = "classic" | "survival" | "blitz";
export type TargetType = "normal" | "bonus" | "decoy" | "speed" | "moving" | "time_freeze" | "double_points" | "shield";

export interface TargetTypeInfo {
  /** Human name, used in the legend and the in-game callout. */
  label: string;
  /** Compact worth, e.g. "+25" or "−15". */
  points: string;
  /** One line for the legend explaining what the target does. */
  description: string;
  /** Shown on screen while this target is live; null for the plain target. */
  callout: string | null;
  /** Accent colour, also used by the arena so the legend can never drift from it. */
  colour: string;
  tone: "plain" | "reward" | "penalty" | "power";
}

/**
 * Single source of truth for what every target type is worth and what it does.
 * The values mirror the target generation in
 * supabase/migrations/202609220005_retention.sql and the scoring in
 * 202609220004_powerups_server_side.sql — if a number changes there, change it here.
 */
export const TARGET_TYPES: Record<TargetType, TargetTypeInfo> = {
  normal: { label: "Standard", points: "+10", description: "The plain red ring.", callout: null, colour: "#fb5f4a", tone: "plain" },
  bonus: { label: "Bonus", points: "+25", description: "A smaller gold target worth more than a standard one.", callout: "BONUS +25", colour: "#f7c948", tone: "reward" },
  speed: { label: "Speed", points: "+50", description: "Blue and visible for only 400 ms — the biggest single score in the game.", callout: "SPEED +50 · HURRY", colour: "#60a5fa", tone: "reward" },
  moving: { label: "Moving", points: "+15", description: "Green and drifting, so you have to lead your click.", callout: "MOVING +15", colour: "#4ade80", tone: "reward" },
  decoy: { label: "Decoy", points: "−15", description: "Grey and harmless looking. Shooting one costs you 15 points.", callout: "DECOY −15 · DON'T SHOOT", colour: "#71717a", tone: "penalty" },
  time_freeze: { label: "Time freeze", points: "+400 ms", description: "Stretches your next target's window by 400 ms, so it stays hittable longer.", callout: "TIME FREEZE · LONGER WINDOW", colour: "#7dd3fc", tone: "power" },
  double_points: { label: "Double points", points: "×2", description: "Your next 5 targets all score double.", callout: "DOUBLE POINTS · NEXT 5", colour: "#c084fc", tone: "power" },
  shield: { label: "Shield", points: "1 miss", description: "Absorbs exactly one missed target without breaking your streak.", callout: "SHIELD · BRIDGES ONE MISS", colour: "#34d399", tone: "power" },
};

/** Streak lengths that step the multiplier up, and what they award. */
export const STREAK_STEPS = [
  { streak: 3, multiplier: 1.5 },
  { streak: 5, multiplier: 2 },
  { streak: 10, multiplier: 3 },
] as const;

export interface Room {
  id: string;
  code: string;
  host_player_id: string;
  status: RoomStatus;
  active_round_id: string | null;
  game_mode: GameMode;
  /** A daily room plays classic rules on a layout seeded from the date. */
  is_daily: boolean;
  daily_date: string | null;
}

/**
 * One row of the global board from the get_leaderboard RPC. `is_you` marks the
 * caller's own row, which the RPC always returns even outside the top N.
 */
export interface LeaderboardRow {
  rank: number;
  display_name: string;
  score: number;
  is_you: boolean;
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
