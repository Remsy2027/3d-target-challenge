"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleHelp, Copy, Crown, LoaderCircle, LogOut, Radio, RotateCcw, Swords, Target, Trophy, Users, WifiOff, Zap, Volume2, VolumeX, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TargetArena } from "@/components/target-arena";
import type { GameRound, Player, Room, RoomSnapshot, RoundPlayer, RoundTarget, ClientStats, ArenaTheme, GameMode, SubmitHitResult } from "@/lib/game-types";
import { ensureAnonymousSession, findMissingMigrations, isSupabaseConfigured, supabase } from "@/lib/supabase";
import { play, playHitSound, playBonusHitSound, playMissSound, playCountdownBeep, playGoSound, playComboSound, playRoundEndSound, playDecoyHitSound, playSpeedHitSound, playPowerupSound, isMuted, toggleMute } from "@/lib/sounds";

const STORAGE_KEY = "target-challenge-player";

/**
 * Supabase/PostgREST errors are plain objects, not Error instances, so
 * `cause instanceof Error` would swallow the real database message.
 */
function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === "object" && "message" in cause && typeof (cause as { message?: unknown }).message === "string") {
    return (cause as { message: string }).message;
  }
  return fallback;
}

function Rules({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "grid gap-2 text-sm text-slate-300" : "grid gap-3 text-[0.95rem] text-slate-300"}>
      <div className="flex items-center gap-3"><span className="rule-number">1</span><span>Join with a room code and mark yourself Ready.</span></div>
      <div className="flex items-center gap-3"><span className="rule-number">2</span><span>The host starts when at least 2 players are ready.</span></div>
      <div className="flex items-center gap-3"><span className="rule-number">3</span><span>Hit targets for 60 seconds. Red = 10 points, gold = 25.</span></div>
      <div className="flex items-center gap-3"><span className="rule-number">4</span><span>The highest server-confirmed score wins.</span></div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#ff684f] text-white shadow-[0_8px_30px_rgba(255,104,79,.28)] sm:size-11 sm:rounded-2xl"><Target className="size-5 sm:size-6" /></div>
      <div className="min-w-0">
        <p className="truncate text-[0.95rem] font-black tracking-[-0.03em] text-white sm:text-lg">3D Target Challenge</p>
        <p className="hidden text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300 sm:block">Realtime arena</p>
      </div>
    </div>
  );
}

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-2 text-[0.7rem] font-bold text-slate-300 sm:gap-2 sm:px-3 sm:text-xs" title={connected ? "Live" : "Reconnecting"} aria-label={connected ? "Live" : "Reconnecting"}>
      {connected ? <Radio className="size-3.5 text-emerald-400" /> : <WifiOff className="size-3.5 text-amber-300" />}
      {/* On phones the colored icon carries the state so the brand title keeps its full width. */}
      <span className="hidden sm:inline">{connected ? "Live" : "Reconnecting"}</span>
    </div>
  );
}

function Shell({ children, connected = true, headerChildren }: { children: React.ReactNode; connected?: boolean; headerChildren?: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-[#050b14] text-slate-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1440px] flex-col px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-6 sm:py-4 lg:px-8">
        <header className="flex items-center justify-between gap-2 py-1 sm:gap-3 sm:py-2">
          <Brand />
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {headerChildren}
            <StatusPill connected={connected} />
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center py-4 sm:py-8">{children}</div>
      </div>
    </main>
  );
}

function LoadingScreen() {
  return <Shell><div className="flex items-center gap-3 text-slate-300"><LoaderCircle className="size-5 animate-spin" /> Restoring your game…</div></Shell>;
}

function SetupRequired() {
  return (
    <Shell connected={false}>
      <Card className="glass-card w-full max-w-xl animate-fade-up">
        <CardHeader>
          <CardTitle className="text-2xl text-white">Connect the realtime backend</CardTitle>
          <CardDescription className="text-slate-400">The game is ready, but it needs your Supabase project values before rooms can be created.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-300">
          <p>Copy <code>.env.example</code> to <code>.env.local</code>, add the two public Supabase values, then run the included SQL migration.</p>
          <p>The exact setup and two-player testing steps are in <code>README.md</code>.</p>
        </CardContent>
      </Card>
    </Shell>
  );
}

/**
 * Shown instead of the game when the connected Supabase project is missing
 * migrations. Without this the host just sees a raw PostgREST error about
 * start_round never being found in the schema cache.
 */
function SchemaOutdated({ migrations }: { migrations: string[] }) {
  return (
    <Shell connected={false}>
      <Card className="glass-card w-full max-w-xl animate-fade-up">
        <CardHeader>
          <CardTitle className="text-2xl text-white">Finish the database setup</CardTitle>
          <CardDescription className="text-slate-400">Your Supabase project is missing database migrations, so the host cannot start a round.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-300">
          <p>In the Supabase dashboard open <strong className="text-white">SQL Editor</strong>, paste <code>supabase/apply-missing-migrations.sql</code> from this project, run it once, then reload this page.</p>
          <p className="font-bold text-slate-400">Still to run</p>
          <ul className="grid gap-1 font-mono text-xs text-amber-200">
            {migrations.map((name) => <li key={name}>{name}</li>)}
          </ul>
          <p className="text-slate-400">The full setup and two-player testing steps are in <code>README.md</code>.</p>
        </CardContent>
      </Card>
    </Shell>
  );
}

function HomeScreen({ initialCode, busy, error, onCreate, onJoin }: { initialCode: string; busy: boolean; error: string; onCreate: (name: string) => Promise<void>; onJoin: (name: string, code: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(initialCode);
  return (
    <Shell>
      <div className="grid w-full max-w-5xl gap-4 sm:gap-6 md:grid-cols-[1.05fr_.95fr] animate-fade-up">
        <section className="order-2 flex flex-col justify-center rounded-[1.5rem] border border-cyan-300/10 sm:rounded-[2rem] md:order-1 bg-[radial-gradient(circle_at_15%_20%,rgba(34,211,238,.14),transparent_34%),radial-gradient(circle_at_90%_80%,rgba(255,104,79,.14),transparent_34%)] p-5 sm:p-8 lg:p-10">
          <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-cyan-300/20 sm:mb-7 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-cyan-200"><Swords className="size-3.5" /> 2–8 players</div>
          <h1 className="max-w-xl text-[2rem] font-black leading-[1.02] tracking-[-0.055em] text-white sm:text-5xl lg:text-6xl">Aim fast.<br /><span className="text-[#ff765e]">Climb the board.</span></h1>
          <p className="mt-4 max-w-lg text-sm leading-6 text-slate-300 sm:mt-5 sm:text-base sm:leading-7">Create a room, invite your friends, and race through the same 60-second target challenge.</p>
          <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 sm:mt-8 sm:p-5">
            <div className="mb-4 flex items-center gap-2 font-bold text-white"><CircleHelp className="size-5 text-cyan-300" /> How to play</div>
            <Rules compact />
          </div>
        </section>
        <Card className="glass-card order-1 justify-center md:order-2">
          <CardHeader>
            <CardTitle className="text-xl text-white sm:text-2xl">Enter the arena</CardTitle>
            <CardDescription className="text-slate-400">No account required. Your name is only used inside the room.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 sm:space-y-5">
            <label className="grid gap-2 text-sm font-bold text-slate-200">Your name<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={20} placeholder="e.g. Mohit" className="game-input" autoComplete="nickname" /></label>
            <Button className="game-button h-12 w-full" disabled={busy || name.trim().length < 2} onClick={() => onCreate(name)}>{busy ? <LoaderCircle className="animate-spin" /> : <Zap />} Create room</Button>
            <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.15em] text-slate-500"><span className="h-px flex-1 bg-white/10" />or join<span className="h-px flex-1 bg-white/10" /></div>
            <label className="grid gap-2 text-sm font-bold text-slate-200">Room code<Input value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} maxLength={6} placeholder="ABC123" className="game-input text-center font-mono text-lg font-black tracking-[0.25em] uppercase" /></label>
            <Button variant="outline" className="h-12 w-full border-white/15 bg-white/[0.05] text-white hover:bg-white/10 hover:text-white" disabled={busy || name.trim().length < 2 || code.length !== 6} onClick={() => onJoin(name, code)}><Users /> Join room</Button>
            {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}

function Leaderboard({ players, scores, currentPlayerId, className = "space-y-2", compact = false }: { players: Player[]; scores: RoundPlayer[]; currentPlayerId: string; className?: string; compact?: boolean }) {
  const rows = useMemo(() => {
    const scoreMap = new Map(scores.map((score) => [score.player_id, score.score]));
    return players.filter((player) => scoreMap.has(player.id)).map((player) => ({ ...player, score: scoreMap.get(player.id) ?? 0 })).sort((a, b) => b.score - a.score || a.joined_at.localeCompare(b.joined_at));
  }, [players, scores]);
  return (
    <ol className={className}>
      {rows.map((player, index) => (
        <li key={player.id} className={`flex items-center gap-2.5 rounded-xl border sm:gap-3 ${compact ? "px-2.5 py-2" : "px-3 py-3"} ${player.id === currentPlayerId ? "border-cyan-300/25 bg-cyan-300/10" : "border-white/[0.07] bg-white/[0.035]"}`}>
          <span className={`grid shrink-0 place-items-center rounded-lg text-xs font-black ${compact ? "size-6" : "size-7"} ${index === 0 ? "bg-amber-300 text-amber-950" : "bg-white/10 text-slate-300"}`}>{index + 1}</span>
          <span className={`min-w-0 flex-1 truncate font-bold text-white ${compact ? "text-sm" : ""}`}>{player.display_name}{player.id === currentPlayerId ? " (you)" : ""}</span>
          <span className={`font-mono font-black text-cyan-200 ${compact ? "text-base" : "text-lg"}`}>{player.score}</span>
        </li>
      ))}
    </ol>
  );
}

function LobbyScreen({ room, players, currentPlayerId, busy, error, connected, onReady, onStart, onLeave }: { room: Room; players: Player[]; currentPlayerId: string; busy: boolean; error: string; connected: boolean; onReady: (ready: boolean) => Promise<void>; onStart: (mode: GameMode) => Promise<void>; onLeave: () => void }) {
  const me = players.find((player) => player.id === currentPlayerId)!;
  const isHost = room.host_player_id === currentPlayerId;
  const readyCount = players.filter((player) => player.is_ready).length;
  const copyRoom = async () => navigator.clipboard.writeText(`${window.location.origin}?room=${room.code}`);
  const [mode, setMode] = useState<GameMode>("classic");
  return (
    <Shell connected={connected}>
      <div className="grid w-full max-w-5xl gap-4 sm:gap-6 md:grid-cols-[1fr_.72fr] animate-fade-up">
        <Card className="glass-card">
          <CardHeader className="border-b border-white/[0.08]">
            <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
              <div><CardDescription className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-cyan-300 sm:mb-2">Room code</CardDescription><CardTitle className="font-mono text-3xl tracking-[0.18em] text-white sm:text-4xl">{room.code}</CardTitle></div>
              <Button variant="outline" className="whitespace-nowrap border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white" onClick={copyRoom}><Copy /> Copy invite</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-1 sm:space-y-5">
            <div className="flex items-center justify-between"><h2 className="font-bold text-white">Players</h2><span className="text-sm font-semibold text-slate-400">{players.length}/8 · {readyCount} ready</span></div>
            {/* Two-up while the card is full width; back to one column when it shares the row with the rules card. */}
            <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
              {players.map((player) => (
                <li key={player.id} className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] p-3">
                  <span className={`grid size-9 place-items-center rounded-xl font-black ${player.is_ready ? "bg-emerald-400/15 text-emerald-300" : "bg-white/[0.07] text-slate-400"}`}>{player.is_ready ? <Check className="size-5" /> : player.display_name.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1 truncate font-bold text-white">{player.display_name}{player.id === currentPlayerId ? " (you)" : ""}</span>
                  {room.host_player_id === player.id && <Crown className="size-4 text-amber-300" aria-label="Host" />}
                </li>
              ))}
            </ul>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button className={me?.is_ready ? "h-12 bg-emerald-500 text-emerald-950 hover:bg-emerald-400" : "game-button h-12"} disabled={busy} onClick={() => onReady(!me?.is_ready)}><Check /> {me?.is_ready ? "Ready!" : "Mark Ready"}</Button>
              {isHost ? (
                <div className="flex min-w-0 gap-2">
                  <select value={mode} onChange={e => setMode(e.target.value as GameMode)} className="h-12 shrink-0 rounded-xl border border-white/10 bg-[#07111f] px-2 text-sm font-bold text-white outline-none sm:px-3">
                    <option value="classic">Classic</option>
                    <option value="survival">Survival</option>
                    <option value="blitz">Blitz</option>
                  </select>
                  <Button className="h-12 flex-1 whitespace-nowrap bg-white text-slate-950 hover:bg-slate-200" disabled={busy || readyCount < 2} onClick={() => onStart(mode)}><Swords /> Start game</Button>
                </div>
              ) : <div className="grid h-12 place-items-center rounded-xl border border-white/10 bg-white/[0.035] text-sm text-slate-400">Waiting for the host</div>}
            </div>
            {isHost && readyCount < 2 && <p className="text-center text-sm text-amber-200">At least 2 players must be ready.</p>}
            {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
            <button onClick={onLeave} className="mx-auto flex items-center gap-2 text-sm font-semibold text-slate-500 transition hover:text-white"><LogOut className="size-4" /> Leave room</button>
          </CardContent>
        </Card>
        <Card className="glass-card"><CardHeader><CardTitle className="flex items-center gap-2 text-xl text-white"><CircleHelp className="size-5 text-cyan-300" /> Game rules</CardTitle></CardHeader><CardContent><Rules /></CardContent></Card>
      </div>
    </Shell>
  );
}

function GameScreen({ snapshot, currentPlayerId, clockOffset, connected, clientStats, setClientStats, onHit, onFinish }: { snapshot: RoomSnapshot; currentPlayerId: string; clockOffset: number; connected: boolean; clientStats: ClientStats; setClientStats: React.Dispatch<React.SetStateAction<ClientStats>>; onHit: (target: RoundTarget, worldPos?: { x: number; y: number; z: number }) => Promise<SubmitHitResult | null>; onFinish: () => Promise<void> }) {
  const round = snapshot.round!;
  const [now, setNow] = useState(Date.now() + clockOffset);
  const [hitIndexes, setHitIndexes] = useState(() => new Set(snapshot.hitTargetIndexes));
  const [muted, setMuted] = useState(isMuted());
  const [theme, setTheme] = useState<ArenaTheme>("cyber");
  const [floatingTexts, setFloatingTexts] = useState<Array<{ id: number; points: number; type: string; x: number; y: number; text: string }>>([]);
  const [hitFlash, setHitFlash] = useState<string | null>(null);

  const finalizing = useRef(false);
  useEffect(() => setHitIndexes(new Set(snapshot.hitTargetIndexes)), [snapshot.hitTargetIndexes]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now() + clockOffset), 50); return () => window.clearInterval(timer); }, [clockOffset]);
  const startMs = new Date(round.starts_at).getTime();
  const endMs = new Date(round.ends_at).getTime();
  const secondsToStart = Math.max(0, Math.ceil((startMs - now) / 1000));
  const remaining = Math.max(0, Math.ceil((endMs - now) / 1000));
  // A held time-freeze charge keeps the current target clickable for an extra 400 ms,
  // mirrored by submit_hit's widened acceptance window (migration 202609220004).
  const freezeGraceMs = clientStats.freezeCharges > 0 ? 400 : 0;
  const activeTarget = snapshot.targets.find((target) => now >= new Date(target.starts_at).getTime() && now <= new Date(target.ends_at).getTime() + freezeGraceMs && !hitIndexes.has(target.target_index)) ?? null;
  const isParticipant = snapshot.roundPlayers.some((score) => score.player_id === currentPlayerId);
  
  useEffect(() => { if (now >= endMs && !finalizing.current) { finalizing.current = true; void onFinish(); } }, [endMs, now, onFinish]);

  const prevSeconds = useRef(secondsToStart);
  useEffect(() => {
    if (prevSeconds.current !== secondsToStart) {
      if (secondsToStart > 0 && secondsToStart <= 3) {
        play(() => playCountdownBeep(secondsToStart));
      } else if (secondsToStart === 0 && prevSeconds.current > 0) {
        play(playGoSound);
      }
      prevSeconds.current = secondsToStart;
    }
  }, [secondsToStart]);

  const prevRemaining = useRef(remaining);
  useEffect(() => {
    if (prevRemaining.current !== remaining) {
      if (remaining === 0 && prevRemaining.current > 0) {
        play(playRoundEndSound);
      }
      prevRemaining.current = remaining;
    }
  }, [remaining]);

  const activeTargetIndex = activeTarget?.target_index ?? -1;
  const lastTargetIndexRef = useRef(activeTargetIndex);
  useEffect(() => {
    if (lastTargetIndexRef.current !== -1 && lastTargetIndexRef.current !== activeTargetIndex && isParticipant) {
      if (!hitIndexes.has(lastTargetIndexRef.current)) {
        setClientStats((s) => {
          if (s.shieldActive) return { ...s, shieldActive: false };
          return { ...s, streak: 0, misses: s.misses + 1, multiplier: 1 };
        });
        play(playMissSound);
      }
    }
    lastTargetIndexRef.current = activeTargetIndex;
  }, [activeTargetIndex, hitIndexes, isParticipant, setClientStats]);

  const hit = async (target: RoundTarget, worldPos?: { x: number; y: number; z: number }) => {
    if (now < startMs || now >= endMs || hitIndexes.has(target.target_index)) return;
    setHitIndexes((current) => new Set(current).add(target.target_index));

    // Instant audio feedback. Points, streak, and powerup state are confirmed by the
    // server (submit_hit is the single source of truth) before anything is displayed.
    if (target.target_type === 'decoy') play(playDecoyHitSound);
    else if (target.target_type === 'speed') play(playSpeedHitSound);
    else if (['time_freeze', 'double_points', 'shield'].includes(target.target_type)) play(playPowerupSound);
    else if (target.target_type === 'bonus') play(playBonusHitSound);
    else play(playHitSound);

    const result = await onHit(target, worldPos);
    if (!result?.accepted) return;

    if (result.streak === 3 || result.streak === 5 || result.streak === 10) {
      play(() => playComboSound(result.streak));
    }

    setHitFlash(target.target_type);
    setTimeout(() => setHitFlash(null), 200);

    const id = Date.now();
    const x = 40 + Math.random() * 20;
    const y = 40 + Math.random() * 20;
    const text = target.target_type === 'decoy'
      ? 'DECOY -15'
      : ['time_freeze', 'double_points', 'shield'].includes(target.target_type)
        ? 'POWERUP!'
        : `+${result.awarded}${target.target_type === 'bonus' ? ' BONUS' : ''}${result.multiplier > 1 ? ` x${result.multiplier}` : ''}`;

    setFloatingTexts(current => [...current, { id, points: result.awarded, type: target.target_type, x, y, text }]);
    setTimeout(() => {
      setFloatingTexts(current => current.filter(t => t.id !== id));
    }, 800);
  };
  
  const myScore = snapshot.roundPlayers.find((score) => score.player_id === currentPlayerId)?.score ?? 0;
  
  const getComboClass = (streak: number) => {
    if (streak >= 10) return "combo-10";
    if (streak >= 5) return "combo-5";
    return "combo-3";
  };

  return (
    <main className="min-h-dvh select-none bg-[#050b14] px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-slate-100 sm:px-3 sm:pb-3 sm:pt-3 lg:px-4 lg:pb-4 lg:pt-4">
      <div className="mx-auto flex min-h-[calc(100dvh-1rem)] w-full max-w-[1480px] flex-col gap-2 sm:min-h-[calc(100dvh-1.5rem)] sm:gap-3 lg:min-h-[calc(100dvh-2rem)]">
        <header className="flex items-center justify-between gap-2 rounded-2xl border border-white/[0.08] bg-[#0b1524]/95 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
          <Brand />
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 lg:gap-3">
            <button type="button" onClick={() => setTheme(t => t === 'cyber' ? 'volcanic' : t === 'volcanic' ? 'neon' : 'cyber')} className="mute-btn" title="Change theme" aria-label="Change theme">
              <Palette className="size-4" />
            </button>
            <button type="button" onClick={() => { toggleMute(); setMuted(isMuted()); }} className="mute-btn" title="Toggle sound" aria-label="Toggle sound">
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
            {/* Laptops and desktops keep the stats inline in the header. */}
            <div className="hidden items-center gap-2 lg:flex">
              <div className="score-chip"><span>Score</span><strong>{myScore}</strong></div>
              {clientStats.streak >= 3 && (
                <div className={`combo-badge ${getComboClass(clientStats.streak)}`}>
                  🔥 x{clientStats.multiplier}
                </div>
              )}
              <div className={`timer-chip ${remaining <= 10 ? "timer-danger" : ""}`}><span>{secondsToStart > 0 ? "Starts in" : "Time"}</span><strong>{secondsToStart > 0 ? secondsToStart : remaining}</strong></div>
            </div>
            <StatusPill connected={connected} />
          </div>
        </header>

        {/* Phones and tablets get their own stats row so the chips never cover the arena. */}
        <div className="flex items-stretch gap-2 lg:hidden">
          <div className="score-chip flex-1"><span>Score</span><strong>{myScore}</strong></div>
          {clientStats.streak >= 3 && (
            <div className={`combo-badge ${getComboClass(clientStats.streak)} self-center`}>🔥 x{clientStats.multiplier}</div>
          )}
          <div className={`timer-chip flex-1 ${remaining <= 10 ? "timer-danger" : ""}`}><span>{secondsToStart > 0 ? "Starts in" : "Time"}</span><strong>{secondsToStart > 0 ? secondsToStart : remaining}</strong></div>
        </div>

        <div className="grid min-h-0 flex-1 content-start gap-2 sm:gap-3 lg:content-normal lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="relative aspect-[4/3] w-full self-start overflow-hidden rounded-2xl border border-white/[0.08] bg-[#07111f] sm:aspect-[16/9] lg:aspect-auto lg:h-full lg:min-h-0 lg:self-stretch lg:rounded-[1.5rem]">
            {hitFlash && <div className={`hit-flash hit-flash-${hitFlash}`} />}
            
            {floatingTexts.map(t => (
              <div key={t.id} className={`float-score float-score-${t.type}`} style={{ left: `${t.x}%`, top: `${t.y}%` }}>
                {t.text}
              </div>
            ))}

            {(() => {
              const isEliminated = snapshot.room.game_mode === 'survival' && clientStats.misses >= 3;
              return (
                <>
                  <TargetArena theme={theme} target={secondsToStart === 0 && isParticipant && !isEliminated ? activeTarget : null} onHit={hit} disabled={remaining === 0 || !isParticipant || isEliminated} />
                  
                  {isEliminated && (
                    <div className="absolute inset-0 z-30 flex items-center justify-center bg-red-950/80 backdrop-blur-sm">
                      <div className="text-center animate-fade-up">
                        <h2 className="text-4xl font-black tracking-widest text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.8)] sm:text-6xl">ELIMINATED</h2>
                        <p className="mt-3 text-base font-bold text-red-200 sm:mt-4 sm:text-xl">You missed 3 targets!</p>
                      </div>
                    </div>
                  )}
                  
                  <div className="pointer-events-none absolute inset-x-0 top-5 flex justify-center z-20">
                    {!isParticipant ? <div className="rounded-full border border-white/10 bg-black/45 px-4 py-2 text-sm font-bold text-slate-200 backdrop-blur">Spectating this round</div> : secondsToStart > 0 ? <div className="countdown-bubble"><span>Get ready</span><strong>{secondsToStart}</strong></div> : isEliminated ? null : !activeTarget && remaining > 0 ? <div className="rounded-full border border-white/10 bg-black/35 px-4 py-2 text-sm font-bold text-slate-300 backdrop-blur">Next target…</div> : activeTarget?.target_type === "bonus" ? <div className="rounded-full border border-amber-300/30 bg-amber-300/15 px-4 py-2 text-sm font-black text-amber-200 backdrop-blur">BONUS · 25 POINTS</div> : null}
                  </div>
                </>
              );
            })()}
          </section>
          <aside className="rounded-2xl border border-white/[0.08] bg-[#0b1524] p-3 sm:p-4 lg:rounded-[1.5rem]">
            <div className="mb-3 flex items-center justify-between gap-2 sm:mb-4"><h2 className="flex items-center gap-2 text-sm font-black text-white sm:text-base"><Trophy className="size-4 text-amber-300 sm:size-5" /> Live leaderboard</h2><span className="text-[0.7rem] font-bold uppercase tracking-wider text-slate-500 sm:text-xs">Round {round.round_number}</span></div>
            <Leaderboard players={snapshot.players} scores={snapshot.roundPlayers} currentPlayerId={currentPlayerId} compact className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1" />
            <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.035] p-3 text-[0.7rem] leading-5 text-slate-400 sm:mt-4 sm:text-xs"><strong className="text-[#ff8b77]">Red targets</strong> give 10 points. <strong className="text-amber-300">Small gold targets</strong> give 25.</div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function ResultsScreen({ snapshot, currentPlayerId, connected, busy, error, clientStats, onLobby, onLeave }: { snapshot: RoomSnapshot; currentPlayerId: string; connected: boolean; busy: boolean; error: string; clientStats: ClientStats; onLobby: () => Promise<void>; onLeave: () => void }) {
  const scoreMap = new Map(snapshot.roundPlayers.map((score) => [score.player_id, score.score]));
  const ranked = snapshot.players.filter((player) => scoreMap.has(player.id)).sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0));
  const topScore = ranked.length ? scoreMap.get(ranked[0].id) ?? 0 : 0;
  const winners = ranked.filter((player) => (scoreMap.get(player.id) ?? 0) === topScore);
  const isHost = snapshot.room.host_player_id === currentPlayerId;

  const [pb, setPb] = useState<number>(0);
  useEffect(() => {
    const storedPb = parseInt(window.localStorage.getItem('target-challenge-pb') || '0', 10);
    const myScore = snapshot.roundPlayers.find(s => s.player_id === currentPlayerId)?.score ?? 0;
    if (myScore > storedPb) {
      window.localStorage.setItem('target-challenge-pb', myScore.toString());
      setPb(myScore);
    } else {
      setPb(storedPb);
    }
  }, [snapshot.roundPlayers, currentPlayerId]);

  const { hits, misses } = clientStats;
  const total = hits + misses;
  const accuracy = total > 0 ? Math.round((hits / total) * 100) : 0;

  return (
    <Shell connected={connected}>
      <Card className="glass-card w-full max-w-2xl overflow-hidden animate-fade-up">
        <div className="border-b border-white/[0.08] bg-[radial-gradient(circle_at_50%_0%,rgba(251,191,36,.18),transparent_62%)] px-4 py-6 text-center sm:px-6 sm:py-8">
          <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-amber-300 text-amber-950 shadow-[0_10px_45px_rgba(251,191,36,.25)] sm:mb-4 sm:size-16"><Trophy className="size-7 sm:size-8" /></div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">Round complete</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">{winners.length > 1 ? `${winners.map((player) => player.display_name).join(" & ")} tie!` : `${winners[0]?.display_name ?? "No one"} wins!`}</h1>
          <p className="mt-2 text-slate-400">Top score: {topScore} points</p>
        </div>
        <CardContent className="space-y-4 pt-5 sm:space-y-5 sm:pt-6">
          <div className="mb-4 flex flex-col items-center justify-center gap-1 rounded-xl border border-white/5 bg-black/20 p-3 sm:p-4">
            <div className="text-sm font-bold text-slate-400">Accuracy</div>
            <div className="text-2xl font-black text-white sm:text-3xl">{accuracy}%</div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-1">{hits} hits · {misses} misses</div>
            {pb > 0 && <div className="mt-3 text-xs font-black uppercase tracking-widest text-amber-300 bg-amber-400/10 px-3 py-1.5 rounded-full">Personal Best: {pb}</div>}
          </div>
          
          <Leaderboard players={snapshot.players} scores={snapshot.roundPlayers} currentPlayerId={currentPlayerId} />
          {isHost ? <Button className="game-button h-12 w-full" disabled={busy} onClick={onLobby}><RotateCcw /> Play another round</Button> : <div className="grid h-12 place-items-center rounded-xl border border-white/10 bg-white/[0.035] text-sm text-slate-400">Waiting for the host to open the lobby</div>}
          {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
          <button onClick={onLeave} className="mx-auto flex items-center gap-2 text-sm font-semibold text-slate-500 transition hover:text-white"><LogOut className="size-4" /> Leave room</button>
        </CardContent>
      </Card>
    </Shell>
  );
}

export function GameClient() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(true);
  const [clockOffset, setClockOffset] = useState(0);
  const [missingMigrations, setMissingMigrations] = useState<string[]>([]);
  
  const [clientStats, setClientStats] = useState<ClientStats>({ streak: 0, bestStreak: 0, hits: 0, misses: 0, multiplier: 1, shieldActive: false, doublePointsHitsRemaining: 0, freezeCharges: 0 });
  
  const snapshotRef = useRef<RoomSnapshot | null>(null);
  snapshotRef.current = snapshot;

  useEffect(() => {
    if (snapshot?.room.status === "lobby") {
      setClientStats({ streak: 0, bestStreak: 0, hits: 0, misses: 0, multiplier: 1, shieldActive: false, doublePointsHitsRemaining: 0, freezeCharges: 0 });
    }
  }, [snapshot?.room.status]);

  const loadSnapshot = useCallback(async (roomId: string, activePlayerId: string) => {
    if (!supabase) return;
    const { data: room, error: roomError } = await supabase.from("rooms").select("id,code,host_player_id,status,active_round_id").eq("id", roomId).single();
    if (roomError) throw roomError;
    const { data: players, error: playersError } = await supabase.from("players").select("id,room_id,user_id,display_name,is_ready,joined_at").eq("room_id", roomId).order("joined_at");
    if (playersError) throw playersError;
    let round: GameRound | null = null;
    let roundPlayers: RoundPlayer[] = [];
    let targets: RoundTarget[] = [];
    let hitTargetIndexes: number[] = [];
    if (room.active_round_id) {
      const [roundResult, scoresResult, targetsResult, hitsResult] = await Promise.all([
        supabase.from("rounds").select("id,room_id,round_number,status,starts_at,ends_at").eq("id", room.active_round_id).single(),
        supabase.from("round_players").select("round_id,player_id,score,last_hit_at").eq("round_id", room.active_round_id),
        supabase.from("round_targets").select("round_id,target_index,target_type,points,pos_x,pos_y,pos_z,starts_at,ends_at").eq("round_id", room.active_round_id).order("target_index"),
        supabase.from("hits").select("target_index").eq("round_id", room.active_round_id).eq("player_id", activePlayerId),
      ]);
      if (roundResult.error) throw roundResult.error;
      if (scoresResult.error) throw scoresResult.error;
      if (targetsResult.error) throw targetsResult.error;
      if (hitsResult.error) throw hitsResult.error;
      round = roundResult.data as GameRound;
      roundPlayers = (scoresResult.data ?? []) as RoundPlayer[];
      targets = (targetsResult.data ?? []) as RoundTarget[];
      hitTargetIndexes = (hitsResult.data ?? []).map((hit) => hit.target_index);
    }
    setSnapshot({ room: room as Room, players: (players ?? []) as Player[], round, roundPlayers, targets, hitTargetIndexes });
  }, []);

  const syncClock = useCallback(async () => {
    if (!supabase) return;
    const before = Date.now();
    const { data } = await supabase.rpc("server_now");
    const after = Date.now();
    if (data) setClockOffset(new Date(data as string).getTime() - (before + after) / 2);
  }, []);

  useEffect(() => {
    const restore = async () => {
      if (!supabase) { setLoading(false); return; }
      try {
        await ensureAnonymousSession();
        await syncClock();
        setMissingMigrations(await findMissingMigrations());
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (!stored) return;
        const saved = JSON.parse(stored) as { playerId: string; roomId: string };
        const { data: player } = await supabase.from("players").select("id").eq("id", saved.playerId).maybeSingle();
        if (player) { setPlayerId(saved.playerId); await loadSnapshot(saved.roomId, saved.playerId); }
        else window.localStorage.removeItem(STORAGE_KEY);
      } catch (cause) {
        setError(errorMessage(cause, "Could not restore the room."));
      } finally { setLoading(false); }
    };
    void restore();
  }, [loadSnapshot, syncClock]);

  useEffect(() => {
    if (!supabase || !snapshot?.room.id || !playerId) return;
    const client = supabase;
    const roomId = snapshot.room.id;
    const refresh = () => void loadSnapshot(roomId, playerId).catch(() => setConnected(false));
    const channel = client.channel(`room:${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds", filter: `room_id=eq.${roomId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "round_players" }, refresh)
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    return () => { void client.removeChannel(channel); };
  }, [loadSnapshot, playerId, snapshot?.room.id]);

  const enterRoom = async (operation: "create_room" | "join_room", args: Record<string, string>) => {
    if (!supabase) return;
    setBusy(true); setError("");
    try {
      await ensureAnonymousSession();
      const { data, error: rpcError } = await supabase.rpc(operation, args);
      if (rpcError) throw rpcError;
      const result = data as { room_id: string; player_id: string };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ roomId: result.room_id, playerId: result.player_id }));
      setPlayerId(result.player_id);
      await syncClock();
      await loadSnapshot(result.room_id, result.player_id);
    } catch (cause) { setError(errorMessage(cause, "Could not enter the room.")); }
    finally { setBusy(false); }
  };

  const perform = async (operation: string, args: Record<string, unknown> = {}) => {
    if (!supabase || !snapshot || !playerId) return;
    setBusy(true); setError("");
    try {
      const { error: rpcError } = await supabase.rpc(operation, { p_player_id: playerId, ...args });
      if (rpcError) throw rpcError;
      await loadSnapshot(snapshot.room.id, playerId);
    } catch (cause) {
      // PGRST202 means PostgREST cannot resolve this function signature at all,
      // which almost always means a migration was never applied.
      setError((cause as { code?: string } | null)?.code === "PGRST202"
        ? `The database is missing an update, so ${operation} is unavailable. Run supabase/apply-missing-migrations.sql in the Supabase SQL Editor.`
        : errorMessage(cause, "The action could not be completed."));
    } finally { setBusy(false); }
  };

  const hitTarget = useCallback(async (target: RoundTarget): Promise<SubmitHitResult | null> => {
    if (!supabase || !playerId || !snapshotRef.current?.round) return null;
    const { data, error: hitError } = await supabase.rpc("submit_hit", { p_player_id: playerId, p_round_id: snapshotRef.current.round.id, p_target_index: target.target_index });
    if (hitError) { setError(hitError.message); return null; }
    const result = data as SubmitHitResult | null;
    if (!result?.accepted) return result ?? null;
    // Reconcile the local mirror with the server's authoritative response.
    setClientStats((s) => ({
      streak: result.streak,
      bestStreak: Math.max(s.bestStreak, result.streak),
      hits: s.hits + 1,
      misses: s.misses,
      multiplier: result.multiplier,
      shieldActive: s.shieldActive || target.target_type === "shield",
      doublePointsHitsRemaining: target.target_type === "double_points" ? 5 : Math.max(0, s.doublePointsHitsRemaining - (result.awarded > 0 ? 1 : 0)),
      freezeCharges: target.target_type === "time_freeze" ? s.freezeCharges + 1 : Math.max(0, s.freezeCharges - (target.target_type !== "decoy" && s.freezeCharges > 0 ? 1 : 0)),
    }));
    return result;
  }, [playerId]);

  const finishRound = useCallback(async () => {
    if (!supabase || !playerId || !snapshotRef.current?.round) return;
    const { error: finishError } = await supabase.rpc("finalize_round", { p_player_id: playerId, p_round_id: snapshotRef.current.round.id });
    if (finishError) setError(finishError.message);
    else await loadSnapshot(snapshotRef.current.room.id, playerId);
  }, [loadSnapshot, playerId]);

  const leave = () => { window.localStorage.removeItem(STORAGE_KEY); setSnapshot(null); setPlayerId(null); setError(""); };

  if (loading) return <LoadingScreen />;
  if (!isSupabaseConfigured) return <SetupRequired />;
  if (missingMigrations.length > 0) return <SchemaOutdated migrations={missingMigrations} />;
  if (!snapshot || !playerId) {
    const initialCode = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("room")?.toUpperCase().slice(0, 6) ?? "" : "";
    return <HomeScreen initialCode={initialCode} busy={busy} error={error} onCreate={(name) => enterRoom("create_room", { p_display_name: name.trim() })} onJoin={(name, code) => enterRoom("join_room", { p_display_name: name.trim(), p_code: code.trim().toUpperCase() })} />;
  }
  if (snapshot.room.status === "lobby") return <LobbyScreen room={snapshot.room} players={snapshot.players} currentPlayerId={playerId} busy={busy} error={error} connected={connected} onReady={(ready) => perform("set_ready", { p_ready: ready })} onStart={(mode) => perform("start_round", { p_game_mode: mode })} onLeave={leave} />;
  if (snapshot.room.status === "active" && snapshot.round) return <GameScreen snapshot={snapshot} currentPlayerId={playerId} clockOffset={clockOffset} connected={connected} clientStats={clientStats} setClientStats={setClientStats} onHit={hitTarget} onFinish={finishRound} />;
  return <ResultsScreen snapshot={snapshot} currentPlayerId={playerId} connected={connected} busy={busy} error={error} clientStats={clientStats} onLobby={() => perform("return_to_lobby")} onLeave={leave} />;
}
