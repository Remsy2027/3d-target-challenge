"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleHelp, Copy, Crown, LoaderCircle, LogOut, Radio, RotateCcw, Swords, Target, Trophy, Users, WifiOff, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TargetArena } from "@/components/target-arena";
import type { GameRound, Player, Room, RoomSnapshot, RoundPlayer, RoundTarget } from "@/lib/game-types";
import { ensureAnonymousSession, isSupabaseConfigured, supabase } from "@/lib/supabase";

const STORAGE_KEY = "target-challenge-player";

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
    <div className="flex items-center gap-3">
      <div className="grid size-11 place-items-center rounded-2xl bg-[#ff684f] text-white shadow-[0_8px_30px_rgba(255,104,79,.28)]"><Target className="size-6" /></div>
      <div>
        <p className="text-lg font-black tracking-[-0.03em] text-white">3D Target Challenge</p>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Realtime arena</p>
      </div>
    </div>
  );
}

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-slate-300">
      {connected ? <Radio className="size-3.5 text-emerald-400" /> : <WifiOff className="size-3.5 text-amber-300" />}
      {connected ? "Live" : "Reconnecting"}
    </div>
  );
}

function Shell({ children, connected = true }: { children: React.ReactNode; connected?: boolean }) {
  return (
    <main className="min-h-dvh bg-[#050b14] text-slate-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1440px] flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between py-2"><Brand /><StatusPill connected={connected} /></header>
        <div className="flex flex-1 items-center justify-center py-5 sm:py-8">{children}</div>
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
      <Card className="glass-card w-full max-w-xl">
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

function HomeScreen({ initialCode, busy, error, onCreate, onJoin }: { initialCode: string; busy: boolean; error: string; onCreate: (name: string) => Promise<void>; onJoin: (name: string, code: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(initialCode);
  return (
    <Shell>
      <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[1.08fr_.92fr]">
        <section className="flex flex-col justify-center rounded-[2rem] border border-cyan-300/10 bg-[radial-gradient(circle_at_15%_20%,rgba(34,211,238,.14),transparent_34%),radial-gradient(circle_at_90%_80%,rgba(255,104,79,.14),transparent_34%)] p-6 sm:p-10">
          <div className="mb-7 inline-flex w-fit items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-cyan-200"><Swords className="size-3.5" /> 2–8 players</div>
          <h1 className="max-w-xl text-4xl font-black leading-[.98] tracking-[-0.055em] text-white sm:text-6xl">Aim fast.<br /><span className="text-[#ff765e]">Climb the board.</span></h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-slate-300">Create a room, invite your friends, and race through the same 60-second target challenge.</p>
          <div className="mt-8 rounded-2xl border border-white/10 bg-black/20 p-5">
            <div className="mb-4 flex items-center gap-2 font-bold text-white"><CircleHelp className="size-5 text-cyan-300" /> How to play</div>
            <Rules compact />
          </div>
        </section>
        <Card className="glass-card justify-center">
          <CardHeader>
            <CardTitle className="text-2xl text-white">Enter the arena</CardTitle>
            <CardDescription className="text-slate-400">No account required. Your name is only used inside the room.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
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

function Leaderboard({ players, scores, currentPlayerId }: { players: Player[]; scores: RoundPlayer[]; currentPlayerId: string }) {
  const rows = useMemo(() => {
    const scoreMap = new Map(scores.map((score) => [score.player_id, score.score]));
    return players.filter((player) => scoreMap.has(player.id)).map((player) => ({ ...player, score: scoreMap.get(player.id) ?? 0 })).sort((a, b) => b.score - a.score || a.joined_at.localeCompare(b.joined_at));
  }, [players, scores]);
  return (
    <ol className="space-y-2">
      {rows.map((player, index) => (
        <li key={player.id} className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${player.id === currentPlayerId ? "border-cyan-300/25 bg-cyan-300/10" : "border-white/[0.07] bg-white/[0.035]"}`}>
          <span className={`grid size-7 shrink-0 place-items-center rounded-lg text-xs font-black ${index === 0 ? "bg-amber-300 text-amber-950" : "bg-white/10 text-slate-300"}`}>{index + 1}</span>
          <span className="min-w-0 flex-1 truncate font-bold text-white">{player.display_name}{player.id === currentPlayerId ? " (you)" : ""}</span>
          <span className="font-mono text-lg font-black text-cyan-200">{player.score}</span>
        </li>
      ))}
    </ol>
  );
}

function LobbyScreen({ room, players, currentPlayerId, busy, error, connected, onReady, onStart, onLeave }: { room: Room; players: Player[]; currentPlayerId: string; busy: boolean; error: string; connected: boolean; onReady: (ready: boolean) => Promise<void>; onStart: () => Promise<void>; onLeave: () => void }) {
  const me = players.find((player) => player.id === currentPlayerId)!;
  const isHost = room.host_player_id === currentPlayerId;
  const readyCount = players.filter((player) => player.is_ready).length;
  const copyRoom = async () => navigator.clipboard.writeText(`${window.location.origin}?room=${room.code}`);
  return (
    <Shell connected={connected}>
      <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[1fr_.72fr]">
        <Card className="glass-card">
          <CardHeader className="border-b border-white/[0.08]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><CardDescription className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">Room code</CardDescription><CardTitle className="font-mono text-4xl tracking-[0.18em] text-white">{room.code}</CardTitle></div>
              <Button variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white" onClick={copyRoom}><Copy /> Copy invite</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-1">
            <div className="flex items-center justify-between"><h2 className="font-bold text-white">Players</h2><span className="text-sm font-semibold text-slate-400">{players.length}/8 · {readyCount} ready</span></div>
            <ul className="grid gap-2 sm:grid-cols-2">
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
              {isHost ? <Button className="h-12 bg-white text-slate-950 hover:bg-slate-200" disabled={busy || readyCount < 2} onClick={onStart}><Swords /> Start game</Button> : <div className="grid h-12 place-items-center rounded-xl border border-white/10 bg-white/[0.035] text-sm text-slate-400">Waiting for the host</div>}
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

function GameScreen({ snapshot, currentPlayerId, clockOffset, connected, onHit, onFinish }: { snapshot: RoomSnapshot; currentPlayerId: string; clockOffset: number; connected: boolean; onHit: (target: RoundTarget) => Promise<void>; onFinish: () => Promise<void> }) {
  const round = snapshot.round!;
  const [now, setNow] = useState(Date.now() + clockOffset);
  const [hitIndexes, setHitIndexes] = useState(() => new Set(snapshot.hitTargetIndexes));
  const finalizing = useRef(false);
  useEffect(() => setHitIndexes(new Set(snapshot.hitTargetIndexes)), [snapshot.hitTargetIndexes]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now() + clockOffset), 50); return () => window.clearInterval(timer); }, [clockOffset]);
  const startMs = new Date(round.starts_at).getTime();
  const endMs = new Date(round.ends_at).getTime();
  const secondsToStart = Math.max(0, Math.ceil((startMs - now) / 1000));
  const remaining = Math.max(0, Math.ceil((endMs - now) / 1000));
  const activeTarget = snapshot.targets.find((target) => now >= new Date(target.starts_at).getTime() && now <= new Date(target.ends_at).getTime() && !hitIndexes.has(target.target_index)) ?? null;
  const isParticipant = snapshot.roundPlayers.some((score) => score.player_id === currentPlayerId);
  useEffect(() => { if (now >= endMs && !finalizing.current) { finalizing.current = true; void onFinish(); } }, [endMs, now, onFinish]);
  const hit = async (target: RoundTarget) => {
    if (now < startMs || now >= endMs || hitIndexes.has(target.target_index)) return;
    setHitIndexes((current) => new Set(current).add(target.target_index));
    await onHit(target);
  };
  const myScore = snapshot.roundPlayers.find((score) => score.player_id === currentPlayerId)?.score ?? 0;
  return (
    <main className="min-h-dvh bg-[#050b14] p-3 text-slate-100 sm:p-4">
      <div className="mx-auto grid min-h-[calc(100dvh-1.5rem)] max-w-[1480px] grid-rows-[auto_1fr] gap-3 sm:min-h-[calc(100dvh-2rem)]">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#0b1524]/95 px-4 py-3">
          <Brand />
          <div className="flex items-center gap-2 sm:gap-3"><div className="score-chip"><span>Score</span><strong>{myScore}</strong></div><div className={`timer-chip ${remaining <= 10 ? "timer-danger" : ""}`}><span>{secondsToStart > 0 ? "Starts in" : "Time"}</span><strong>{secondsToStart > 0 ? secondsToStart : remaining}</strong></div><StatusPill connected={connected} /></div>
        </header>
        <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="relative min-h-[420px] overflow-hidden rounded-[1.5rem] border border-white/[0.08] bg-[#07111f]">
            <TargetArena target={secondsToStart === 0 && isParticipant ? activeTarget : null} onHit={hit} disabled={remaining === 0 || !isParticipant} />
            <div className="pointer-events-none absolute inset-x-0 top-5 flex justify-center">
              {!isParticipant ? <div className="rounded-full border border-white/10 bg-black/45 px-4 py-2 text-sm font-bold text-slate-200 backdrop-blur">Spectating this round</div> : secondsToStart > 0 ? <div className="countdown-bubble"><span>Get ready</span><strong>{secondsToStart}</strong></div> : !activeTarget && remaining > 0 ? <div className="rounded-full border border-white/10 bg-black/35 px-4 py-2 text-sm font-bold text-slate-300 backdrop-blur">Next target…</div> : activeTarget?.target_type === "bonus" ? <div className="rounded-full border border-amber-300/30 bg-amber-300/15 px-4 py-2 text-sm font-black text-amber-200 backdrop-blur">BONUS · 25 POINTS</div> : null}
            </div>
          </section>
          <aside className="rounded-[1.5rem] border border-white/[0.08] bg-[#0b1524] p-4">
            <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 font-black text-white"><Trophy className="size-5 text-amber-300" /> Live leaderboard</h2><span className="text-xs font-bold uppercase tracking-wider text-slate-500">Round {round.round_number}</span></div>
            <Leaderboard players={snapshot.players} scores={snapshot.roundPlayers} currentPlayerId={currentPlayerId} />
            <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.035] p-3 text-xs leading-5 text-slate-400"><strong className="text-[#ff8b77]">Red targets</strong> give 10 points. <strong className="text-amber-300">Small gold targets</strong> give 25.</div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function ResultsScreen({ snapshot, currentPlayerId, connected, busy, error, onLobby, onLeave }: { snapshot: RoomSnapshot; currentPlayerId: string; connected: boolean; busy: boolean; error: string; onLobby: () => Promise<void>; onLeave: () => void }) {
  const scoreMap = new Map(snapshot.roundPlayers.map((score) => [score.player_id, score.score]));
  const ranked = snapshot.players.filter((player) => scoreMap.has(player.id)).sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0));
  const topScore = ranked.length ? scoreMap.get(ranked[0].id) ?? 0 : 0;
  const winners = ranked.filter((player) => (scoreMap.get(player.id) ?? 0) === topScore);
  const isHost = snapshot.room.host_player_id === currentPlayerId;
  return (
    <Shell connected={connected}>
      <Card className="glass-card w-full max-w-2xl overflow-hidden">
        <div className="border-b border-white/[0.08] bg-[radial-gradient(circle_at_50%_0%,rgba(251,191,36,.18),transparent_62%)] px-6 py-8 text-center">
          <div className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-amber-300 text-amber-950 shadow-[0_10px_45px_rgba(251,191,36,.25)]"><Trophy className="size-8" /></div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">Round complete</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">{winners.length > 1 ? `${winners.map((player) => player.display_name).join(" & ")} tie!` : `${winners[0]?.display_name ?? "No one"} wins!`}</h1>
          <p className="mt-2 text-slate-400">Top score: {topScore} points</p>
        </div>
        <CardContent className="space-y-5 pt-6">
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
  const snapshotRef = useRef<RoomSnapshot | null>(null);
  snapshotRef.current = snapshot;

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
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (!stored) return;
        const saved = JSON.parse(stored) as { playerId: string; roomId: string };
        const { data: player } = await supabase.from("players").select("id").eq("id", saved.playerId).maybeSingle();
        if (player) { setPlayerId(saved.playerId); await loadSnapshot(saved.roomId, saved.playerId); }
        else window.localStorage.removeItem(STORAGE_KEY);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not restore the room.");
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not enter the room."); }
    finally { setBusy(false); }
  };

  const perform = async (operation: string, args: Record<string, unknown> = {}) => {
    if (!supabase || !snapshot || !playerId) return;
    setBusy(true); setError("");
    try {
      const { error: rpcError } = await supabase.rpc(operation, { p_player_id: playerId, ...args });
      if (rpcError) throw rpcError;
      await loadSnapshot(snapshot.room.id, playerId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The action could not be completed."); }
    finally { setBusy(false); }
  };

  const hitTarget = useCallback(async (target: RoundTarget) => {
    if (!supabase || !playerId || !snapshotRef.current?.round) return;
    const { error: hitError } = await supabase.rpc("submit_hit", { p_player_id: playerId, p_round_id: snapshotRef.current.round.id, p_target_index: target.target_index });
    if (hitError) setError(hitError.message);
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
  if (!snapshot || !playerId) {
    const initialCode = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("room")?.toUpperCase().slice(0, 6) ?? "" : "";
    return <HomeScreen initialCode={initialCode} busy={busy} error={error} onCreate={(name) => enterRoom("create_room", { p_display_name: name.trim() })} onJoin={(name, code) => enterRoom("join_room", { p_display_name: name.trim(), p_code: code.trim().toUpperCase() })} />;
  }
  if (snapshot.room.status === "lobby") return <LobbyScreen room={snapshot.room} players={snapshot.players} currentPlayerId={playerId} busy={busy} error={error} connected={connected} onReady={(ready) => perform("set_ready", { p_ready: ready })} onStart={() => perform("start_round")} onLeave={leave} />;
  if (snapshot.room.status === "active" && snapshot.round) return <GameScreen snapshot={snapshot} currentPlayerId={playerId} clockOffset={clockOffset} connected={connected} onHit={hitTarget} onFinish={finishRound} />;
  return <ResultsScreen snapshot={snapshot} currentPlayerId={playerId} connected={connected} busy={busy} error={error} onLobby={() => perform("return_to_lobby")} onLeave={leave} />;
}
