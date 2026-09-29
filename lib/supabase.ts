import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { LeaderboardRow } from "@/lib/game-types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;

/**
 * Columns that migrations 3 and 4 add to the base schema. Each probe is a
 * read-only `select` of one column: PostgREST resolves columns before row-level
 * security filters rows out, so a missing column answers 42703 even for an
 * anonymous player who can read nothing.
 */
const MIGRATION_PROBES = [
  { table: "rooms", column: "game_mode", migration: "202609220003_game_modes_targets_powerups.sql" },
  { table: "round_targets", column: "velocity_x", migration: "202609220003_game_modes_targets_powerups.sql" },
  { table: "round_players", column: "current_streak", migration: "202609220004_powerups_server_side.sql" },
  { table: "rooms", column: "is_daily", migration: "202609220005_retention.sql" },
] as const;

/**
 * Functions the client needs but that no column probe can detect, so asking for one
 * is the only way to tell whether the migration that creates it has run.
 */
const MIGRATION_RPCS = [
  { fn: "get_leaderboard", args: { p_limit: 1, p_daily: false }, migration: "202609220005_retention.sql" },
] as const;

/** PostgREST cannot resolve the function or its argument signature. */
const MISSING_FUNCTION_CODES = new Set(["PGRST202", "42883"]);

/** PostgREST reports an unknown table as 42P01 (SQL) or PGRST205 (schema cache). */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);
const UNKNOWN_COLUMN_CODE = "42703";

/**
 * Detects a Supabase project that has not had every migration applied. Without
 * this the only symptom is the far more confusing "Could not find the function
 * public.start_round(p_game_mode, p_player_id) in the schema cache" when the
 * host presses Start game. Returns the migration file names still to run.
 */
export async function findMissingMigrations(): Promise<string[]> {
  if (!supabase) return [];
  const missing = new Set<string>();
  for (const probe of MIGRATION_PROBES) {
    const { error } = await supabase.from(probe.table).select(probe.column).limit(1);
    const code = (error as { code?: string } | null)?.code;
    if (code === UNKNOWN_COLUMN_CODE) missing.add(probe.migration);
    else if (code && MISSING_TABLE_CODES.has(code)) missing.add("202609220001_core_game.sql");
  }
  for (const probe of MIGRATION_RPCS) {
    const { error } = await supabase.rpc(probe.fn, probe.args);
    const code = (error as { code?: string } | null)?.code;
    if (code && MISSING_FUNCTION_CODES.has(code)) missing.add(probe.migration);
  }
  return [...missing].sort();
}

/**
 * Reads the global board from the get_leaderboard RPC (migration 202609220005).
 * `daily` narrows it to today's daily challenge; either way the response always
 * contains the caller's own row so they can see their rank even when it is far
 * outside the top N.
 */
export async function fetchLeaderboard(limit = 10, daily = false): Promise<LeaderboardRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("get_leaderboard", { p_limit: limit, p_daily: daily });
  if (error) throw error;
  return (data ?? []) as LeaderboardRow[];
}

export async function ensureAnonymousSession() {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  const { data: signedIn, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!signedIn.session) throw new Error("Could not start a player session.");
  return signedIn.session;
}
