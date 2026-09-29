# 3D Target Challenge

A realtime multiplayer browser game for 2–8 players. React renders the interface, React Three Fiber renders the 3D arena, and Supabase provides anonymous player sessions, durable match state, secure scoring, and realtime updates.

## Prerequisites

- Node.js 22 or newer
- pnpm
- A Supabase project

## 1. Configure Supabase

1. Create a Supabase project.
2. Open **Authentication → Providers → Anonymous Sign-Ins** and enable anonymous sign-ins.
3. Open **SQL Editor**.
4. Run each migration **in numeric order** as a new query in the SQL Editor: `202609220001_core_game.sql`, then `202609220002_progressive_difficulty.sql`, `202609220003_game_modes_targets_powerups.sql`, `202609220004_powerups_server_side.sql`, then `202609220005_retention.sql`. Migration 4 makes scoring fully server-authoritative (streak multipliers, double points, shield, time freeze) and fixes survival mode's target-count limit. Migration 5 adds the global leaderboard, the daily challenge, and rematches.
5. Open **Project Settings → API** and copy the project URL and anon/public key.

The migration creates the tables, Row-Level Security policies, secure game functions, hit validation, and realtime publications.

### Applying the missing migrations

If the game says **`Could not find the function public.start_round(p_game_mode, p_player_id) in the schema cache`** when the host presses **Start game**, the project has migrations 1 and 2 but not 3 and 4. Instead of pasting both files, paste `supabase/apply-missing-migrations.sql`, which contains just those two in order plus a read-only verification query whose every row should return `OK`. Note that this file deliberately covers only migrations 3 and 4 — it is not the whole setup, and migration 5 still has to be run separately.

You rarely have to work this out by hand: the app probes the database on load and shows a setup card naming the exact files still to run.

You can confirm the state of any project from the terminal without credentials:

```bash
curl "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rooms?select=game_mode&limit=1" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

A `42703 column rooms.game_mode does not exist` response means migration 3 has not run yet.

## 2. Configure the app

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Set the two values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Never put the Supabase service-role key in this file or in browser code.

## 3. Run locally

```bash
pnpm install
pnpm dev
```

Open the address printed by the development server:

```text
http://localhost:5173
```

To test from a phone on the same Wi-Fi network, start the app so it listens on your LAN interface and open your computer's LAN IP from the phone. Depending on the local runner, use:

```bash
pnpm dev -- --host 0.0.0.0
```

Then open `http://YOUR_COMPUTER_LAN_IP:5173` on the phone. Allow port 5173 through the firewall if prompted.

## Two-player test

Supabase stores one anonymous identity per browser profile. Use two genuinely separate sessions:

- Player 1: normal browser window
- Player 2: Incognito/Private window, a different browser profile, or a second device

Test the complete loop:

1. Player 1 enters a name and selects **Create room**.
2. Copy the six-character room code.
3. Player 2 opens the app, enters a different name and the room code, then selects **Join room**.
4. Confirm both players appear in both lobbies.
5. Both players select **Mark Ready**.
6. Player 1, the host, selects **Start game**.
7. Confirm both devices show the same three-second countdown and a 60-second timer.
8. Hit red targets for 10 points and smaller gold targets for 25 points.
9. Confirm each accepted hit updates the live leaderboard on both devices.
10. At zero, confirm both devices show the result and winner.
11. The host selects **Rematch**. Confirm a new round starts on both devices with no Ready step, that the combo and accuracy counters reset to zero, and that the series chip shows 1–0.
12. The host selects **Back to lobby** instead. Confirm both players return to the lobby and must mark Ready again.

## Retention loop

Three features (all from migration 5) give players a reason to come back.

**Hall of fame.** The home screen shows a global board from the `get_leaderboard` RPC, with an **All time** / **Today** toggle. It always includes your own row, so your rank is visible even when you are far outside the top ten.

**Daily challenge.** Once a day, every player in the world gets the *identical* 60 classic targets, seeded in `start_round` from `current_date` with `setseed`. The layout is reproducible because the generation loops consume `random()` a fixed number of times in a fixed order. The daily is playable solo — it is started by `start_daily`, which skips the "at least 2 players ready" gate that a normal round still enforces — and it appears on the **Today** board until midnight UTC, then resets.

**Rematch.** The results screen has a **Rematch** button that calls `start_round` with `p_skip_ready: true`. Participants come from the *previous round's* `round_players` rows rather than from `players.is_ready`, so nobody has to re-ready and anyone who left is excluded. "Back to lobby" still exists for handing out the room code again.

Series wins ("2–1") are derived on the client from the room's finished rounds, which any member can already read — no extra server code.

## Security model

- The browser never writes scores directly.
- `submit_hit` is the single source of truth for scoring: it validates the authenticated player, active round, target timing, and duplicate hits, and computes streak multipliers, double points, shield, time freeze, and the decoy penalty server-side. The client only mirrors the server's response for instant UI feedback.
- A unique database key makes repeat submissions idempotent.
- `get_leaderboard` is `security definer` because `round_players` is RLS-locked to room members, but it publishes only a display name and a score — never `players.user_id`. Display names are user-chosen and globally visible on the board.
- The official leaderboard uses server-confirmed scores only.
- Target positions and animation stay local; only room, readiness, round, hit, and score data are synchronized.

## Useful checks

```bash
pnpm exec tsc --noEmit
pnpm build
```

## Troubleshooting

- **`Could not find the function public.start_round(...) in the schema cache`** — migrations 3 and 4 have not been applied. See *Applying the missing migrations* above.
- **`function public.start_round(uuid, text) does not exist` while running migration 4** — you ran migration 4 without migration 3, so the two-argument `start_round` does not exist yet. The SQL Editor runs a script in a single transaction, so this failure rolls back *everything* in that script and the database stays unchanged. Run 3 first (or paste `supabase/apply-missing-migrations.sql` whole). Migration 4 now detects this and refuses with a readable message.
- **Nothing seems to change after running the SQL** — check the project ref in the dashboard URL matches `NEXT_PUBLIC_SUPABASE_URL` in `.env.local`, then run the verification query at the bottom of `supabase/apply-missing-migrations.sql`; every row must say `OK`.
- **Every room looks empty or scores never update** — check that anonymous sign-ins are enabled (step 2) and that the realtime publication exists; migration 1 creates it.
- **`Could not find the function public.get_leaderboard(...)` / `start_daily(...)`, or `column rooms.is_daily does not exist`** — migration 5 has not been applied. Unlike migrations 3 and 4, this one also breaks the room query, so an existing session fails to restore and the app shows the setup card naming `202609220005_retention.sql`.
- **The daily challenge button does nothing** — it still needs a name of at least two characters, because the room needs one to create your `players` row.
- **The host cannot start with one player** — by design: at least two players must be ready.
