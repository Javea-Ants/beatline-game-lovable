import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { playTrack, pausePlayback, resumePlayback, fetchTrack } from "@/lib/spotify";
import type { Song } from "@/lib/songs";
import { SongRevealScreen } from "@/components/SongRevealScreen";
import {
  ArrowLeft,
  Pause,
  Play,
  Shield,
  Star,
  Disc3,
  Plus,
  Loader2,
  RotateCw,
  X,
  Check,
  CheckCircle2,
  XCircle,
  Pencil,
  SkipForward,
} from "lucide-react";
import { toast } from "sonner";

/**
 * TIMELINE MODE — Landscape-first, two-team gameplay.
 *
 * Turn flow (simplified — no Confirm step):
 *   idle        → "Empezar" draws the next song and starts playback
 *   placing     → active team picks a slot. From here:
 *                   - active taps "Revelar" → resolveTurn(null)
 *                   - challenger taps "Desafiar" → goes to "challenging"
 *   challenging → challenger picks a DIFFERENT slot inside the ACTIVE team's
 *                 timeline (never its own), taps "Revelar" → resolveTurn(challenge).
 *                 The Comodín is always consumed. If the active team was wrong
 *                 and the challenger right, the card goes to the CHALLENGER's
 *                 own timeline; if both are wrong, nobody scores.
 *   revealed    → result UI, music KEEPS PLAYING. "Siguiente turno"
 *                 pauses playback and hands control to the other team.
 *
 * IMPORTANT visibility rule:
 *   Already-placed timeline cards ALWAYS show their year. The currently
 *   unresolved song lives only in `currentSong` (not in any timeline) until
 *   resolve, so there is never a need to mask years on the board.
 */

interface TLCard {
  uri: string;
  title: string;
  artist: string;
  year: number;
  albumArt: string | null;
}

interface TLTeam {
  name: string;
  timeline: TLCard[];
  primis: number; // internal name kept; UI label is "Comodín"
}

type TLPhase = "idle" | "playing" | "placing" | "challenging" | "revealed";

interface ChallengeState {
  by: 0 | 1;
  slot: number | null;
}

interface RevealResult {
  activeOk: boolean;
  activeSlot: number;
  challengerOk: boolean | null;
  challengerIdx: 0 | 1 | null;
  challengerSlot: number | null;
  insertedInto: 0 | 1 | null;
  primiDelta: { team: 0 | 1; delta: number } | null;
}

interface Props {
  songs: Song[];
  playlistName: string;
  onExit: () => void;
  /** Opens the shared playlist source screen (same one classic mode uses). */
  onChangePlaylist?: () => void;
}


const INITIAL_PRIMIS = 0;
const WIN_TIMELINE_SIZE = 10;

/** Per-team visual identity. Neutral system UI stays on `--primary`. */
const TEAM_TONES = [
  {
    text: "text-cyan-300",
    badgeBg: "bg-cyan-500",
    badgeFg: "text-black",
    border: "border-cyan-400",
    borderSoft: "border-cyan-400/40",
    ring: "ring-cyan-400/40",
    glow: "shadow-[0_0_24px_rgba(34,211,238,0.5)]",
    bgTint: "bg-cyan-500/10",
    bgTintStrong: "bg-cyan-500/20",
    slotActive:
      "border-cyan-400 bg-cyan-500/25 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.55)]",
    slotIdle:
      "border-cyan-400/50 hover:bg-cyan-500/10 active:bg-cyan-500/20 text-cyan-300/80",
    yearText: "text-cyan-200",
  },
  {
    text: "text-pink-300",
    badgeBg: "bg-pink-500",
    badgeFg: "text-black",
    border: "border-pink-400",
    borderSoft: "border-pink-400/40",
    ring: "ring-pink-400/40",
    glow: "shadow-[0_0_24px_rgba(244,114,182,0.5)]",
    bgTint: "bg-pink-500/10",
    bgTintStrong: "bg-pink-500/20",
    slotActive:
      "border-pink-400 bg-pink-500/25 text-pink-200 shadow-[0_0_12px_rgba(244,114,182,0.55)]",
    slotIdle:
      "border-pink-400/50 hover:bg-pink-500/10 active:bg-pink-500/20 text-pink-300/80",
    yearText: "text-pink-200",
  },
] as const;

function shuffle<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isValidUri(uri: string) {
  return /^spotify:track:[a-zA-Z0-9]{22}$/.test(uri);
}

function correctSlots(timeline: TLCard[], year: number): Set<number> {
  const ok = new Set<number>();
  for (let i = 0; i <= timeline.length; i++) {
    const leftOk = i === 0 || timeline[i - 1].year <= year;
    const rightOk = i === timeline.length || year <= timeline[i].year;
    if (leftOk && rightOk) ok.add(i);
  }
  return ok;
}

function canonicalSlot(timeline: TLCard[], year: number): number {
  let i = 0;
  while (i < timeline.length && timeline[i].year <= year) i++;
  return i;
}

function insertSorted(timeline: TLCard[], card: TLCard): TLCard[] {
  const copy = timeline.slice();
  const i = canonicalSlot(copy, card.year);
  copy.splice(i, 0, card);
  return copy;
}

/* -------------------------------- Hook ---------------------------------- */

function useIsPortrait() {
  const [portrait, setPortrait] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(orientation: portrait)").matches
      : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const onChange = () => setPortrait(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return portrait;
}

/* ------------------------------- Component ------------------------------ */

export default function TimelineMode({ songs, playlistName, onExit, onChangePlaylist }: Props) {
  const [teams, setTeams] = useState<TLTeam[]>([
    { name: "Equipo 1", timeline: [], primis: INITIAL_PRIMIS },
    { name: "Equipo 2", timeline: [], primis: INITIAL_PRIMIS },
  ]);
  const [active, setActive] = useState<0 | 1>(0);
  const [phase, setPhase] = useState<TLPhase>("idle");
  const [currentSong, setCurrentSong] = useState<TLCard | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [challenge, setChallenge] = useState<ChallengeState | null>(null);
  const [result, setResult] = useState<RevealResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [seedUri, setSeedUri] = useState<string | null>(null);
  const [preGame, setPreGame] = useState(true);
  const [winner, setWinner] = useState<number | null>(null);
  const [dismissedRotate, setDismissedRotate] = useState(false);

  const isPortrait = useIsPortrait();
  const deckRef = useRef<Song[]>([]);
  const playedUrisRef = useRef<Set<string>>(new Set());

  const toCard = (s: Song): TLCard => ({
    uri: s.uri,
    title: s.title,
    artist: s.artist,
    year: s.year,
    albumArt: null,
  });

  const drawNext = (): Song | null => {
    while (deckRef.current.length) {
      const next = deckRef.current.shift()!;
      if (!isValidUri(next.uri) || next.year <= 0) continue;
      if (playedUrisRef.current.has(next.uri)) continue;
      playedUrisRef.current.add(next.uri);
      return next;
    }
    const pool = songs.filter((s) => isValidUri(s.uri) && s.year > 0);
    if (pool.length === 0) return null;
    deckRef.current = shuffle(pool);
    playedUrisRef.current = new Set();
    const next = deckRef.current.shift()!;
    playedUrisRef.current.add(next.uri);
    return next;
  };

  const pickSharedSeed = (): TLCard | null => {
    const s = drawNext();
    return s ? toCard(s) : null;
  };

  useEffect(() => {
    deckRef.current = shuffle(songs.filter((s) => isValidUri(s.uri) && s.year > 0));
    playedUrisRef.current = new Set();
    const seed = pickSharedSeed();
    if (seed) {
      setTeams((prev) => [
        { ...prev[0], timeline: [seed] },
        { ...prev[1], timeline: [seed] },
      ]);
      setSeedUri(seed.uri);
      setSeeded(true);
      setPreGame(true);
    }
    return () => {
      deckRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs]);

  const rerollSeed = () => {
    if (!preGame || phase !== "idle" || busy) return;
    const seed = pickSharedSeed();
    if (!seed) {
      toast.error("No hay más canciones para sortear");
      return;
    }
    setTeams((prev) => [
      { ...prev[0], timeline: [seed] },
      { ...prev[1], timeline: [seed] },
    ]);
    setSeedUri(seed.uri);
  };

  const startTurn = async () => {
    if (winner !== null || busy) return;
    setBusy(true);
    try {
      if (preGame) setPreGame(false);
      const next = drawNext();
      if (!next) {
        toast.message("No quedan más canciones en esta partida");
        return;
      }
      const card = toCard(next);
      setCurrentSong(card);
      setSelectedSlot(null);
      setChallenge(null);
      setResult(null);
      setPhase("playing");
      setIsPaused(false);
      const r = await playTrack(next.uri);
      if (!r.ok) {
        toast.warning("Canción no disponible, saltando...");
        setPhase("idle");
        setCurrentSong(null);
        return;
      }
      fetchTrack(next.uri)
        .then(({ albumArt }) =>
          setCurrentSong((cur) => (cur && cur.uri === next.uri ? { ...cur, albumArt } : cur)),
        )
        .catch(() => {});
      setPhase("placing");
    } finally {
      setBusy(false);
    }
  };

  const skipSong = async () => {
    if (winner !== null || busy) return;
    setBusy(true);
    try {
      await pausePlayback();
      const next = drawNext();
      if (!next) {
        toast.message("No quedan más canciones en esta partida");
        return;
      }
      const card = toCard(next);
      setCurrentSong(card);
      setSelectedSlot(null);
      setChallenge(null);
      setResult(null);
      setPhase("playing");
      setIsPaused(false);
      const r = await playTrack(next.uri);
      if (!r.ok) {
        toast.warning("Canción no disponible, saltando...");
        setPhase("idle");
        setCurrentSong(null);
        return;
      }
      fetchTrack(next.uri)
        .then(({ albumArt }) =>
          setCurrentSong((cur) => (cur && cur.uri === next.uri ? { ...cur, albumArt } : cur)),
        )
        .catch(() => {});
      setPhase("placing");
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async () => {
    if (isPaused) {
      await resumePlayback();
      setIsPaused(false);
    } else {
      await pausePlayback();
      setIsPaused(true);
    }
  };

  const challengerIdx = (): 0 | 1 => (active === 0 ? 1 : 0);

  /** Opposing team spends a Comodín to challenge → must pick a slot. */
  const openChallenge = () => {
    if (phase !== "placing") return;
    if (selectedSlot === null) {
      toast.error("El equipo en turno debe elegir su posición primero");
      return;
    }
    const cIdx = challengerIdx();
    if (teams[cIdx].primis <= 0) {
      toast.error("El otro equipo no tiene comodines");
      return;
    }
    setChallenge({ by: cIdx, slot: null });
    setPhase("challenging");
    toast.message(`${teams[cIdx].name} desafía (−1 comodín al revelar)`);
  };

  const cancelChallenge = () => {
    if (phase !== "challenging") return;
    setChallenge(null);
    setPhase("placing");
  };

  /**
   * Resolve the turn. Music keeps playing — we do NOT pause here. Playback
   * stops only when the user taps "Siguiente turno".
   */
  const resolveTurn = (chal: ChallengeState | null) => {
    if (!currentSong || selectedSlot === null) return;

    const song = currentSong;
    const slot = selectedSlot;

    // The placement being judged always happens inside the ACTIVE team's
    // timeline — including the challenger's alternative slot.
    const activeTL = teams[active].timeline;
    const valid = correctSlots(activeTL, song.year);
    const activeOk = valid.has(slot);

    let challengerOk: boolean | null = null;
    let cIdx: 0 | 1 | null = null;
    let cSlot: number | null = null;
    if (chal && chal.slot !== null) {
      cIdx = chal.by;
      cSlot = chal.slot;
      challengerOk = valid.has(chal.slot);
    }

    let insertedInto: 0 | 1 | null = null;
    // A spent Comodín is always consumed — never refunded.
    const primiDelta: { team: 0 | 1; delta: number } | null =
      chal && cIdx !== null ? { team: cIdx, delta: -1 } : null;

    if (activeOk) {
      // Active team was right: they take the card, challenger just loses the Comodín.
      insertedInto = active;
    } else if (chal && cIdx !== null && challengerOk) {
      // Active team was wrong and the challenger nailed it: reward goes to the
      // challenger's OWN timeline.
      insertedInto = cIdx;
    }
    // Otherwise (active wrong + challenger wrong, or no challenge): nobody scores.

    const finalInserted = insertedInto;
    const finalCIdx = cIdx;

    setTeams((prev) => {
      const copy = prev.map((t) => ({ ...t, timeline: t.timeline.slice() })) as TLTeam[];
      if (chal && finalCIdx !== null) {
        copy[finalCIdx].primis = Math.max(0, copy[finalCIdx].primis - 1);
      }
      if (finalInserted !== null) {
        copy[finalInserted].timeline = insertSorted(copy[finalInserted].timeline, song);
      }
      for (let i = 0; i < copy.length; i++) {
        if (copy[i].timeline.length >= WIN_TIMELINE_SIZE) {
          setWinner(i);
          break;
        }
      }
      return copy;
    });


    setResult({
      activeOk,
      activeSlot: slot,
      challengerOk,
      challengerIdx: cIdx,
      challengerSlot: cSlot,
      insertedInto: finalInserted,
      primiDelta,
    });
    setPhase("revealed");
  };

  /** Active team reveals directly (no challenge). */
  const revealDirect = () => {
    if (phase !== "placing" || selectedSlot === null) {
      toast.error("Elige una posición primero");
      return;
    }
    resolveTurn(null);
  };

  /** Reveal after a challenge has been issued and a challenger slot picked. */
  const revealWithChallenge = () => {
    if (phase !== "challenging" || !challenge || challenge.slot === null) {
      toast.error("El equipo que desafía debe elegir una posición");
      return;
    }
    resolveTurn(challenge);
  };

  const nextTurn = async () => {
    // Hand off to the other team and immediately start their turn —
    // no intermediate "idle" / "Turno de X" click required.
    setSelectedSlot(null);
    setChallenge(null);
    setResult(null);
    setCurrentSong(null);
    setActive((a) => ((a === 0 ? 1 : 0) as 0 | 1));
    await startTurn();
  };


  const restartGame = async () => {
    try {
      await pausePlayback();
    } catch {}
    deckRef.current = shuffle(songs.filter((s) => isValidUri(s.uri) && s.year > 0));
    playedUrisRef.current = new Set();
    const seed = pickSharedSeed();
    setTeams([
      { name: "Equipo 1", timeline: seed ? [seed] : [], primis: INITIAL_PRIMIS },
      { name: "Equipo 2", timeline: seed ? [seed] : [], primis: INITIAL_PRIMIS },
    ]);
    setSeedUri(seed?.uri ?? null);
    setActive(0);
    setPhase("idle");
    setCurrentSong(null);
    setSelectedSlot(null);
    setChallenge(null);
    setResult(null);
    setSeeded(!!seed);
    setPreGame(true);
    setWinner(null);
  };

  /** Manual comodín adjustment (awarded socially when a team names title + artist). */
  const adjustPrimi = (teamIdx: 0 | 1, delta: number) => {
    setTeams((prev) => {
      const copy = [...prev] as [TLTeam, TLTeam];
      copy[teamIdx] = {
        ...copy[teamIdx],
        primis: Math.max(0, copy[teamIdx].primis + delta),
      };
      return copy;
    });
  };

  /**
   * Manual year correction for an ALREADY PLACED card (current match only).
   * Custom playlists sometimes carry wrong Spotify years; this rewrites the
   * year in local match state and re-sorts that team's timeline. It never
   * touches the source dataset nor any song outside this match.
   */
  const [editCard, setEditCard] = useState<{ teamIdx: 0 | 1; cardIdx: number } | null>(null);
  const [editYear, setEditYear] = useState("");

  const openEditCard = (teamIdx: 0 | 1, cardIdx: number) => {
    setEditCard({ teamIdx, cardIdx });
    setEditYear(String(teams[teamIdx].timeline[cardIdx]?.year ?? ""));
  };

  const saveEditCard = () => {
    if (!editCard) return;
    const year = parseInt(editYear, 10);
    if (!Number.isFinite(year) || year < 1900 || year > 2100) {
      toast.error("Introduce un año válido (1900-2100)");
      return;
    }
    setTeams((prev) => {
      const copy = [...prev] as [TLTeam, TLTeam];
      const t = copy[editCard.teamIdx];
      const card = t.timeline[editCard.cardIdx];
      if (!card) return prev;
      const rest = t.timeline.filter((_, i) => i !== editCard.cardIdx);
      copy[editCard.teamIdx] = {
        ...t,
        timeline: insertSorted(rest, { ...card, year }),
      };
      return copy;
    });
    toast.success(`Año corregido: ${year}`);
    setEditCard(null);
  };


  const activeTeam = teams[active];
  const otherTeam = teams[active === 0 ? 1 : 0];
  const otherIdx: 0 | 1 = active === 0 ? 1 : 0;

  const activeSlotsInteractive = phase === "placing";
  const challengerSlotsInteractive = phase === "challenging";

  return (
    <main
      className="w-full bg-background text-foreground flex flex-col overflow-hidden h-[100svh] supports-[height:100dvh]:h-[100dvh]"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {isPortrait && !dismissedRotate && (
        <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center gap-4 p-6 text-center">
          <RotateCw className="h-12 w-12 text-primary animate-pulse" />
          <h2 className="text-xl font-black neon-text text-primary">Gira tu teléfono</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            El modo Timeline está pensado para usarse en horizontal. Rota el móvil para una mejor experiencia.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onExit}>
              Volver
            </Button>
            <Button onClick={() => setDismissedRotate(true)} className="bg-primary hover:bg-primary/90">
              Continuar igual
            </Button>
          </div>
        </div>
      )}

      <header className="flex items-center justify-between px-2 py-1 border-b border-primary/20 shrink-0 h-9">
        <Button variant="ghost" size="sm" onClick={onExit} className="h-7 px-2 text-muted-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" />
          <span className="text-xs">Modo</span>
        </Button>
        <div className="text-center min-w-0">
          <div className="text-xs font-black neon-text text-primary tracking-tight">
            ▸ BEATLINE · TIMELINE
          </div>
          <button
            type="button"
            onClick={onChangePlaylist ?? onExit}
            title="Cambiar playlist"
            className="text-[9px] text-muted-foreground hover:text-primary uppercase tracking-widest truncate max-w-[40vw] underline decoration-dotted underline-offset-2"
          >
            {playlistName} · cambiar
          </button>
        </div>

        <Button variant="ghost" size="sm" onClick={restartGame} className="h-7 px-2 text-muted-foreground text-xs">
          Reiniciar
        </Button>
      </header>

      <div className="flex-1 min-h-0 grid gap-1 p-1 grid-rows-[auto_minmax(0,1fr)_minmax(0,0.28fr)]">

        <ControlBar
          phase={phase}
          currentSong={currentSong}
          isPaused={isPaused}
          busy={busy}
          seeded={seeded}
          preGame={preGame}
          winner={winner}
          activeTeamName={activeTeam.name}
          challengerName={otherTeam.name}
          challengerPrimis={otherTeam.primis}
          activeIdx={active}
          challengerIdx={otherIdx}
          selectedSlot={selectedSlot}
          challengeSlot={challenge?.slot ?? null}
          result={result}
          teams={teams}
          onStart={startTurn}
          onReroll={rerollSeed}
          onTogglePause={togglePause}
          onSkip={skipSong}
          onReveal={revealDirect}
          onChallenge={openChallenge}
          onCancelChallenge={cancelChallenge}
          onRevealChallenge={revealWithChallenge}
          onNext={nextTurn}
        />

        <TeamTimeline
          team={activeTeam}
          teamIdx={active}
          isActive
          highlight={activeSlotsInteractive || challengerSlotsInteractive}
          locked={phase === "challenging"}
          selectedSlot={selectedSlot}
          onSelectSlot={(i) => {
            if (activeSlotsInteractive) {
              setSelectedSlot(i);
              return;
            }
            if (challengerSlotsInteractive) {
              // The challenge happens INSIDE the active team's timeline and
              // cannot repeat the active team's own choice.
              if (i === selectedSlot) {
                toast.error("Elige una posición distinta a la del equipo en turno");
                return;
              }
              setChallenge({ by: otherIdx, slot: i });
            }
          }}
          challengeSlot={challenge && phase !== "idle" ? challenge.slot : null}
          challengeTone={TEAM_TONES[otherIdx]}
          blockedSlot={challengerSlotsInteractive ? selectedSlot : null}
          previewYear={null}
          resultMark={
            phase === "revealed" && result
              ? { slot: result.activeSlot, ok: result.activeOk }
              : null
          }
          challengeResultMark={
            phase === "revealed" && result && result.challengerSlot !== null
              ? { slot: result.challengerSlot, ok: !!result.challengerOk }
              : null
          }
          seedUri={seedUri}
          onAdjustPrimi={(d) => adjustPrimi(active, d)}
          onEditCardYear={(i) => openEditCard(active, i)}
        />

        <TeamTimeline
          team={otherTeam}
          teamIdx={otherIdx}
          isActive={false}
          highlight={false}
          locked={false}
          selectedSlot={null}
          onSelectSlot={() => {}}
          previewYear={null}
          compact
          resultMark={null}
          seedUri={seedUri}
          onAdjustPrimi={(d) => adjustPrimi(otherIdx, d)}
          onEditCardYear={(i) => openEditCard(otherIdx, i)}
        />

      </div>

      {phase === "revealed" && currentSong && result && (
        <SongRevealScreen
          key={`tl-reveal-${currentSong.uri}`}
          albumArt={currentSong.albumArt}
          year={currentSong.year}
          artist={currentSong.artist}
          title={currentSong.title}
          isPaused={isPaused}
          onTogglePause={togglePause}
          actionLabel="SIGUIENTE TURNO"
          onAction={nextTurn}
          layout="landscape"
        >
          <div className="flex flex-col text-[11px] gap-0.5 min-w-0">
            <ResultLine label={activeTeam.name} ok={result.activeOk} detail={`pos ${result.activeSlot}`} />
            {result.challengerIdx !== null && (
              <ResultLine
                label={`${teams[result.challengerIdx].name} (desafío)`}
                ok={!!result.challengerOk}
                detail={`pos ${result.challengerSlot}`}
              />
            )}
            {result.insertedInto !== null ? (
              <div className="text-[10px] text-emerald-300">
                → Carta para {teams[result.insertedInto].name}
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground">→ Nadie se lleva la carta</div>
            )}
            {result.primiDelta && (
              <div className="text-[10px] text-muted-foreground">
                {`−1 comodín a ${teams[result.primiDelta.team].name}`}
              </div>
            )}
          </div>
        </SongRevealScreen>
      )}


      <Dialog open={winner !== null} onOpenChange={(o) => !o && setWinner(null)}>
        <DialogContent className="bg-background border-primary/40">
          <DialogHeader>
            <DialogTitle className="text-primary neon-text">
              ¡{winner !== null ? teams[winner].name : ""} gana!
            </DialogTitle>
            <DialogDescription>
              Han completado {WIN_TIMELINE_SIZE} canciones en su línea temporal.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onExit}>Salir</Button>
            <Button onClick={restartGame} className="bg-primary hover:bg-primary/90">
              Nueva partida
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual year correction — affects the current match only. */}
      <Dialog open={editCard !== null} onOpenChange={(o) => !o && setEditCard(null)}>
        <DialogContent className="bg-background border-primary/40 max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-primary">Corregir año</DialogTitle>
            <DialogDescription>
              {editCard
                ? `${teams[editCard.teamIdx].timeline[editCard.cardIdx]?.artist ?? ""} — ${
                    teams[editCard.teamIdx].timeline[editCard.cardIdx]?.title ?? ""
                  }`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <input
            type="number"
            inputMode="numeric"
            value={editYear}
            autoFocus
            onChange={(e) => setEditYear(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveEditCard()}
            className="w-full rounded-lg border-2 border-primary/40 bg-black/60 px-3 py-2 text-2xl font-black tabular-nums text-center text-primary outline-none"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setEditCard(null)}>Cancelar</Button>
            <Button onClick={saveEditCard} className="bg-primary hover:bg-primary/90">Guardar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>

  );
}

/* ----------------------------- Subcomponents ----------------------------- */

function TeamTimeline({
  team,
  teamIdx,
  isActive,
  highlight,
  locked,
  selectedSlot,
  onSelectSlot,
  previewYear,
  compact,
  resultMark,
  challengeSlot = null,
  challengeTone,
  blockedSlot = null,
  challengeResultMark = null,
  seedUri,
  onAdjustPrimi,
  onEditCardYear,
}: {
  team: TLTeam;
  teamIdx: 0 | 1;
  isActive: boolean;
  highlight: boolean;
  locked: boolean;
  selectedSlot: number | null;
  onSelectSlot: (slot: number) => void;
  previewYear: number | null;
  compact?: boolean;
  resultMark?: { slot: number; ok: boolean } | null;
  /** Slot picked by the challenging team, rendered inside THIS timeline. */
  challengeSlot?: number | null;
  challengeTone?: typeof TEAM_TONES[number];
  /** Slot that cannot be picked (the active team's own choice). */
  blockedSlot?: number | null;
  challengeResultMark?: { slot: number; ok: boolean } | null;
  seedUri?: string | null;
  /** Manual +/- control for this team's comodines. */
  onAdjustPrimi?: (delta: number) => void;
  /** Manual year correction for a placed card (current match only). */
  onEditCardYear?: (cardIdx: number) => void;
}) {
  const tone = TEAM_TONES[teamIdx];
  // Tap-to-reveal artist/title on a single placed card (year-only by default).
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const cardSize = compact
    ? "h-full aspect-[5/6] min-w-[56px] max-w-[88px] px-1.5"
    : "h-full aspect-[3/4] min-w-[88px] max-w-[140px] px-2";
  const wrapperBase = compact
    ? `p-1.5 ${tone.borderSoft} ${tone.bgTint} opacity-80`
    : `p-2 ${tone.border} ${tone.bgTintStrong} ${tone.glow} ring-2 ${tone.ring}`;

  const renderSlot = (i: number) => {
    const isChallengePick = challengeSlot === i;
    const resultOk =
      resultMark && resultMark.slot === i
        ? resultMark.ok
        : challengeResultMark && challengeResultMark.slot === i
          ? challengeResultMark.ok
          : null;
    return (
      <SlotButton
        index={i}
        active={selectedSlot === i || isChallengePick}
        disabled={!highlight || blockedSlot === i}
        locked={locked && selectedSlot === i}
        onClick={() => onSelectSlot(i)}
        compact={compact}
        previewYear={previewYear}
        resultOk={resultOk}
        tone={isChallengePick && challengeTone ? challengeTone : tone}
      />
    );
  };


  // Left-rail layout: team identity lives in a thin vertical strip on the
  // left edge of the timeline frame instead of a bulky top header. This
  // gives the full row height to the actual year cards.
  const railWidth = compact ? "w-[76px]" : "w-[88px]";
  const railTextTone = isActive ? tone.text : "text-muted-foreground";
  const btnSize = compact ? "h-6 w-6 text-sm" : "h-8 w-8 text-lg";
  const counterSize = compact ? "text-lg" : "text-2xl";

  return (
    <Card
      className={`flex flex-row gap-1 transition-all duration-300 ${wrapperBase} h-full min-h-0 overflow-hidden`}
    >
      {/* Compact left rail: badge + name + comodines + progress */}
      <div
        className={`${railWidth} shrink-0 flex flex-col items-center justify-between py-1 border-r ${tone.borderSoft} ${isActive ? tone.bgTintStrong : tone.bgTint} px-1`}
      >
        <div className="flex flex-col items-center gap-0.5 min-w-0 w-full">
          <span
            className={`text-[9px] font-black uppercase tracking-wider px-1 py-0.5 rounded ${tone.badgeBg} ${tone.badgeFg} leading-none`}
          >
            {isActive ? "TURNO" : "RIVAL"}
          </span>
          <span className={`text-[10px] font-bold truncate w-full text-center leading-tight ${railTextTone}`}>
            {team.name}
          </span>
        </div>

        {/* Wildcard stepper HUD: −/★count/+ plus the x/10 progress. */}
        <div className="flex flex-col items-center gap-1 leading-none">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={`Quitar comodín a ${team.name}`}
              onClick={() => onAdjustPrimi && onAdjustPrimi(-1)}
              disabled={(onAdjustPrimi ? team.primis <= 0 : true)}
              className={`${btnSize} rounded-lg border-2 ${tone.borderSoft} font-black leading-none text-muted-foreground disabled:opacity-30 active:scale-95 touch-manipulation flex items-center justify-center`}
            >
              −
            </button>
            <div className="flex flex-col items-center gap-0">
              <div className="flex items-center gap-0.5">
                <Star className={`${compact ? "h-3.5 w-3.5" : "h-5 w-5"} ${railTextTone} fill-current`} />
                <span className={`font-black tabular-nums ${counterSize} text-center leading-none ${railTextTone}`}>
                  {team.primis}
                </span>
              </div>
              <span className="text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">Comodín</span>
            </div>
            <button
              type="button"
              aria-label={`Dar comodín a ${team.name}`}
              onClick={() => onAdjustPrimi && onAdjustPrimi(1)}
              disabled={!onAdjustPrimi}
              className={`${btnSize} rounded-lg border-2 ${tone.border} ${tone.text} font-black leading-none active:scale-95 touch-manipulation flex items-center justify-center`}
            >
              +
            </button>
          </div>
          <div className="font-black tabular-nums text-sm text-foreground leading-none">
            {team.timeline.length}
            <span className="text-muted-foreground">/{WIN_TIMELINE_SIZE}</span>
          </div>
        </div>
        {highlight && (
          <span
            className={`text-[8px] font-bold ${tone.text} uppercase tracking-wider text-center leading-tight`}
          >
            {compact ? "Desafía" : "Coloca"}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        <div className="flex items-stretch gap-1 h-full pr-2">
          {renderSlot(0)}
          {team.timeline.map((card, i) => {
            const isSeed = !!seedUri && card.uri === seedUri;
            const isExpanded = expandedIdx === i;
            const yearSize = compact
              ? "text-lg"
              : isSeed
                ? "text-4xl"
                : "text-3xl";
            const borderTone = isSeed
              ? `${tone.border} ring-2 ${tone.ring} shadow-[0_0_24px_rgba(255,255,255,0.15)]`
              : isActive
                ? tone.border
                : tone.borderSoft;
            return (
              <div key={`${card.uri}-${i}`} className="flex items-stretch gap-1">
                <button
                  type="button"
                  onClick={() => setExpandedIdx(isExpanded ? null : i)}
                  aria-label={`Carta ${card.year}`}
                  className={`relative shrink-0 rounded-xl border-2 flex flex-col items-center justify-center bg-gradient-to-b from-black to-zinc-900 ${cardSize} ${borderTone} touch-manipulation`}
                >
                  {isSeed && !compact && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-black tracking-[0.18em] uppercase bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                      Inicio
                    </span>
                  )}
                  {/* Year is ALWAYS visible — already-placed cards never get masked. */}
                  <div
                    className={`font-black tabular-nums leading-none ${
                      isSeed ? `${tone.yearText} neon-text` : tone.yearText
                    } ${yearSize}`}
                  >
                    {card.year}
                  </div>
                  {isExpanded && (
                    <div className="mt-1.5 w-full text-center px-1">
                      <div className={`text-[9px] uppercase tracking-wider ${tone.text} truncate`}>
                        {card.artist}
                      </div>
                      <div className="text-[9px] text-muted-foreground/80 truncate italic">
                        {card.title}
                      </div>
                    </div>
                  )}
                  {isExpanded && onEditCardYear && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Editar año de ${card.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditCardYear(i);
                      }}
                      className={`absolute top-0.5 right-0.5 h-6 w-6 rounded-md border ${tone.border} ${tone.text} flex items-center justify-center bg-black/70 active:scale-95 touch-manipulation`}
                    >
                      <Pencil className="h-3 w-3" />
                    </span>
                  )}
                </button>

                {renderSlot(i + 1)}
              </div>
            );
          })}
          {team.timeline.length === 0 && (
            <div className="self-center text-[10px] text-muted-foreground px-2">
              Sin canciones aún
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}


function SlotButton({
  index,
  active,
  disabled,
  locked,
  onClick,
  compact,
  previewYear,
  resultOk,
  tone,
}: {
  index: number;
  active: boolean;
  disabled: boolean;
  locked: boolean;
  onClick: () => void;
  compact?: boolean;
  previewYear: number | null;
  resultOk: boolean | null;
  tone: typeof TEAM_TONES[number];
}) {
  const toneClass =
    resultOk === true
      ? "border-emerald-400 bg-emerald-400/20 text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.55)]"
      : resultOk === false
        ? "border-red-400 bg-red-400/20 text-red-300 shadow-[0_0_12px_rgba(248,113,113,0.55)]"
        : locked
          ? tone.slotActive
          : disabled
            ? "border-border/30 opacity-30"
            : active
              ? tone.slotActive
              : tone.slotIdle;

  return (
    <button
      type="button"
      disabled={disabled && resultOk === null}
      onClick={onClick}
      aria-label={`Insertar en posición ${index}`}
      className={`shrink-0 rounded-md border-2 border-dashed transition-all flex items-center justify-center touch-manipulation h-full ${
        compact ? "w-7 min-w-[28px]" : "w-11 min-w-[44px]"
      } ${toneClass}`}
    >
      {resultOk === true ? (
        <Check className={compact ? "h-3.5 w-3.5" : "h-5 w-5"} />
      ) : resultOk === false ? (
        <X className={compact ? "h-3.5 w-3.5" : "h-5 w-5"} />
      ) : (active || locked) && previewYear !== null ? (
        <span className={`font-black tabular-nums ${compact ? "text-[10px]" : "text-sm"}`}>
          {previewYear}
        </span>
      ) : (
        <Plus className={compact ? "h-3.5 w-3.5" : "h-5 w-5"} />
      )}
    </button>
  );
}

function ControlBar({
  phase,
  currentSong,
  isPaused,
  busy,
  seeded,
  preGame,
  winner,
  activeTeamName,
  challengerName,
  challengerPrimis,
  activeIdx,
  challengerIdx,
  selectedSlot,
  challengeSlot,
  result,
  teams,
  onStart,
  onReroll,
  onTogglePause,
  onSkip,
  onReveal,
  onChallenge,
  onCancelChallenge,
  onRevealChallenge,
  onNext,
}: {
  phase: TLPhase;
  currentSong: TLCard | null;
  isPaused: boolean;
  busy: boolean;
  seeded: boolean;
  preGame: boolean;
  winner: number | null;
  activeTeamName: string;
  challengerName: string;
  challengerPrimis: number;
  activeIdx: 0 | 1;
  challengerIdx: 0 | 1;
  selectedSlot: number | null;
  challengeSlot: number | null;
  result: RevealResult | null;
  teams: TLTeam[];
  onStart: () => void;
  onReroll: () => void;
  onTogglePause: () => void;
  onSkip: () => void;
  onReveal: () => void;
  onChallenge: () => void;
  onCancelChallenge: () => void;
  onRevealChallenge: () => void;
  onNext: () => void;
}) {
  const activeTone = TEAM_TONES[activeIdx];
  const challengerTone = TEAM_TONES[challengerIdx];

  return (
    <div className={`shrink-0 border-2 ${activeTone.border} ${activeTone.bgTintStrong} backdrop-blur px-1.5 py-1 flex items-center gap-2 min-h-[52px] rounded-xl`}>
      {phase === "idle" && (
        <>
          <Button
            onClick={onStart}
            disabled={busy || winner !== null}
            className={`h-12 flex-1 text-base rounded-lg ${activeTone.badgeBg} ${activeTone.badgeFg} hover:opacity-90 font-black`}
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <Play className="h-5 w-5 mr-2 fill-current" />
                <span className="flex flex-col items-start leading-tight">
                  <span>{seeded ? `Turno de ${activeTeamName}` : "Empezar partida"}</span>
                  <span className="text-[9px] font-medium opacity-80 normal-case tracking-normal">
                    {preGame
                      ? "Año inicial sorteado · empieza el primer turno"
                      : "Escucha, coloca y revela"}
                  </span>
                </span>
              </>
            )}
          </Button>
          {preGame && seeded && (
            <Button
              variant="outline"
              size="sm"
              onClick={onReroll}
              disabled={busy || winner !== null}
              title="Sortear otro año inicial"
              aria-label="Sortear otro año inicial"
              className="h-12 px-3 rounded-lg border border-primary/40 bg-black/40 text-[10px] text-muted-foreground hover:text-primary hover:border-primary/70"
            >
              <RotateCw className="h-3.5 w-3.5 mr-1" />
              Otro
            </Button>
          )}
        </>
      )}

      {phase === "playing" && (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground uppercase tracking-widest py-3">
          <Disc3 className="h-4 w-4 mr-2 animate-spin text-primary" /> Cargando canción...
        </div>
      )}

      {(phase === "placing" || phase === "challenging") && currentSong && (
        <>
          <div className="flex items-center gap-2 shrink-0 border border-primary/40 rounded-lg px-2 py-1 bg-black/40">
            <Button
              variant="ghost"
              size="icon"
              onClick={onTogglePause}
              className="h-10 w-10 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              aria-label={isPaused ? "Reanudar" : "Pausar"}
            >
              {isPaused ? <Play className="h-5 w-5 fill-current" /> : <Pause className="h-5 w-5 fill-current" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onSkip}
              className="h-10 w-10 rounded-lg border border-primary/40 text-primary hover:bg-primary/10"
              aria-label="Saltar canción"
              title="Saltar canción"
            >
              <SkipForward className="h-5 w-5 fill-current" />
            </Button>
            <div className="text-[10px] uppercase tracking-widest text-primary leading-tight">
              <div>Sonando</div>
              <div className="text-muted-foreground normal-case tracking-normal">¿Qué año?</div>
            </div>
          </div>

          <div className="flex-1 text-center text-[11px] min-w-0">
            <div className={`uppercase tracking-widest font-bold truncate ${activeTone.text}`}>
              {activeTeamName}
            </div>
            {phase === "placing" && (
              <div className="text-muted-foreground">
                {selectedSlot === null
                  ? "Toca una posición ↓"
                  : `Pos ${selectedSlot} · revela o el rival puede desafiar`}
              </div>
            )}
            {phase === "challenging" && (
              <div className={`text-[10px] mt-0.5 flex items-center justify-center gap-1 ${challengerTone.text}`}>
                <Shield className="h-3 w-3" />
                {challengerName} desafía
                {challengeSlot !== null
                  ? ` (pos ${challengeSlot})`
                  : " — elige OTRA posición en la línea activa ↓"}
                <button
                  type="button"
                  onClick={onCancelChallenge}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  aria-label="Cancelar desafío"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {phase === "placing" && (
            <>
              <Button
                variant="outline"
                onClick={onChallenge}
                disabled={selectedSlot === null || challengerPrimis <= 0}
                className={`h-11 rounded-lg border-2 ${challengerTone.border} bg-black/40 ${challengerTone.text} text-[11px] px-2 hover:opacity-90`}
                title={challengerPrimis <= 0 ? "Sin comodines" : "Desafiar (−1 comodín)"}
              >
                <Shield className="h-4 w-4 mr-1" />
                Desafiar
                <Star className="h-3 w-3 ml-1 fill-current" />
                <span className="ml-0.5">−1</span>
              </Button>
              <Button
                onClick={onReveal}
                disabled={selectedSlot === null}
                className={`h-11 px-4 rounded-lg ${activeTone.badgeBg} ${activeTone.badgeFg} hover:opacity-90 font-black`}
              >
                Revelar
              </Button>
            </>
          )}

          {phase === "challenging" && (
            <Button
              onClick={onRevealChallenge}
              disabled={challengeSlot === null}
              className={`h-11 px-4 rounded-lg ${challengerTone.badgeBg} ${challengerTone.badgeFg} hover:opacity-90 font-black`}
            >
              Revelar
            </Button>
          )}
        </>
      )}

      {/* phase === "revealed" is rendered as a full-screen reveal interstitial
          (SongRevealScreen) by TimelineMode, mirroring Classic Mode. */}
    </div>
  );
}



function ResultLine({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-1.5 max-w-full">
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
      )}
      <span className="truncate">
        <span className="font-bold">{label}</span>{" "}
        <span className="text-muted-foreground">{detail}</span>{" "}
        <span className={ok ? "text-emerald-300" : "text-red-300"}>{ok ? "correcto" : "incorrecto"}</span>
      </span>
    </div>
  );
}
