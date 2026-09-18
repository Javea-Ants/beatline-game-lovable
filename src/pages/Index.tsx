import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { loginWithSpotify, handleRedirect, getAccessToken, playTrack, pausePlayback, resumePlayback, seekTo, logout, fetchTrack, extractPlaylistId, fetchPlaylistSongs, hasRequiredScopes } from "@/lib/spotify";
import { SONGS, type Song } from "@/lib/songs";
import { SongRevealScreen } from "@/components/SongRevealScreen";
import { resolveYear, getCuratedSongs, getCuratedStats } from "@/lib/curatedYears";

import { Play, Pause, SkipForward, SkipBack, Eye, LogOut, Copy, Disc3, Settings, Undo2, ListMusic, Loader2, Gamepad2 } from "lucide-react";
import { toast } from "sonner";
import ModeSelector, { type GameMode } from "@/components/ModeSelector";
import TimelineMode from "@/components/TimelineMode";

type AppMode = "select" | GameMode;

type Phase = "idle" | "playing" | "revealed";

interface Team { name: string; score: number; }

interface CurrentSong extends Song { albumArt: string | null; }

interface PlaylistDef {
  id: string;
  name: string;
  description?: string;
  spotifyId?: string;
  localSongs?: Song[];
  custom?: boolean;
}

interface PlaylistRuntime {
  loaded: boolean;
  loading: boolean;
  songs: Song[];
  name: string;
  teams: Team[];
  phase: Phase;
  currentSong: CurrentSong | null;
  isPaused: boolean;
}

const DEFAULT_SPOTIFY_PLAYLIST_ID = "0eBDf1fYiwzj3IIhyaLxKN";

// The default HITSTER pool is sourced from the curated CSV directly so
// random mode draws from the FULL curated library (not whatever subset
// happens to live in the Spotify playlist). Spotify is still used for
// playback and album art on demand.
const CURATED_HITSTER_SONGS: Song[] = getCuratedSongs();

// Startup self-check: verify that the curated CSV parsed correctly and
// that the number of playable songs matches what was actually loaded into
// the in-memory pool. Logs a structured report and surfaces a toast when
// something is off (missing fields, duplicates, count mismatch, etc.).
function validateCuratedDataset() {
  const stats = getCuratedStats();
  const loaded = CURATED_HITSTER_SONGS.length;
  const mismatch = loaded !== stats.playable;
  const hasMissing =
    stats.missing.uri > 0 ||
    stats.missing.curatedYear > 0 ||
    stats.missing.title > 0 ||
    stats.missing.artist > 0;

  const report = {
    csvDataRows: stats.csvDataRows,
    parsedEntries: stats.parsedEntries,
    playableInCsv: stats.playable,
    loadedInPool: loaded,
    duplicates: stats.duplicates,
    missing: stats.missing,
    ok: !mismatch && loaded > 0,
  };

  if (!loaded) {
    console.error("[HITSTER][CSV] No se cargó ninguna canción del CSV curado", report);
  } else if (mismatch) {
    console.warn(
      `[HITSTER][CSV] Desajuste: CSV reporta ${stats.playable} jugables pero el pool tiene ${loaded}`,
      report,
    );
  } else {
    console.info(
      `[HITSTER][CSV] OK – ${loaded}/${stats.csvDataRows} filas cargadas como jugables`,
      report,
    );
  }
  return { ...report, mismatch, hasMissing };
}

const CURATED_VALIDATION = validateCuratedDataset();


const BUILTIN_PLAYLISTS: PlaylistDef[] = [
  {
    id: "hitster-es",
    name: "Beatline – Biblioteca curada",
    description: "Biblioteca curada (CSV)",
    localSongs: CURATED_HITSTER_SONGS.length > 0 ? CURATED_HITSTER_SONGS : SONGS,
  },
  {
    id: "classics",
    name: "Clásicos Globales",
    description: "20 hits universales (lista local)",
    localSongs: SONGS,
  },
];


const defaultTeams = (): Team[] => [
  { name: "Equipo 1", score: 0 },
  { name: "Equipo 2", score: 0 },
];

// Fisher-Yates shuffle. Returns a new array; never mutates the input.
function createShuffledDeck<T>(items: T[]): T[] {
  const deck = items.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const initialRuntime = (def: PlaylistDef): PlaylistRuntime => ({
  loaded: !!def.localSongs,
  loading: false,
  songs: def.localSongs ?? [],
  name: def.name,
  teams: defaultTeams(),
  phase: "idle",
  currentSong: null,
  isPaused: false,
});

const Index = () => {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showPlaylistViewer, setShowPlaylistViewer] = useState(false);
  const [playlistInput, setPlaylistInput] = useState("");
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);
  // Game-mode selector. Classic mode preserves the existing UI/logic
  // unchanged; timeline mode is rendered by a separate component and never
  // touches classic state. Defaults to "select" so the user picks each game.
  const [mode, setMode] = useState<AppMode>("select");

  const [playlists, setPlaylists] = useState<PlaylistDef[]>(BUILTIN_PLAYLISTS);
  const [activeId, setActiveId] = useState<string>(BUILTIN_PLAYLISTS[0].id);
  const [runtimes, setRuntimes] = useState<Record<string, PlaylistRuntime>>(() => {
    const map: Record<string, PlaylistRuntime> = {};
    for (const p of BUILTIN_PLAYLISTS) map[p.id] = initialRuntime(p);
    return map;
  });
  const [switching, setSwitching] = useState(false);

  // In-memory shuffled decks per playlist. Lives only in this session: a
  // page reload, app close, or logout drops everything. Each playlist has
  // its own deck; switching playlists rebuilds the active one from scratch.
  const decksRef = useRef<Record<string, Song[]>>({});

  const active = runtimes[activeId];
  const activeDef = useMemo(() => playlists.find((p) => p.id === activeId), [playlists, activeId]);

  const updateRuntime = (id: string, patch: Partial<PlaylistRuntime>) => {
    setRuntimes((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  // Start a new game for `id`: shuffle the songs, clear current song, idle.
  // Scores are intentionally preserved (UI/scoring untouched per spec).
  const startNewGame = (id: string, songs: Song[]) => {
    decksRef.current[id] = createShuffledDeck(songs);
    updateRuntime(id, { phase: "idle", currentSong: null, isPaused: false });
  };

  // Pull the next song from the active deck without ever repeating one
  // already drawn in this session. Returns null when the deck is exhausted.
  const drawNextSong = (id: string): Song | null => {
    const deck = decksRef.current[id];
    if (!deck || deck.length === 0) return null;
    return deck.shift() ?? null;
  };

  // Fetch a playlist's songs from Spotify if needed
  const ensureLoaded = async (id: string): Promise<boolean> => {
    const def = playlists.find((p) => p.id === id);
    if (!def) return false;
    const rt = runtimes[id];
    if (rt?.loaded) return true;
    if (!def.spotifyId) {
      // No way to load
      return rt?.songs.length > 0;
    }
    updateRuntime(id, { loading: true });
    try {
      const result = await fetchPlaylistSongs(def.spotifyId);
      // For the default HITSTER playlist, override years from curated CSV.
      const useCurated = def.id === "hitster-es";
      const enriched: Song[] = result.songs.map((s) => {
        const trackId = (s as any).id || s.uri.split(":").pop() || "";
        const spotifyYear = s.year;
        const { year, source } = useCurated
          ? resolveYear({ trackId, uri: s.uri, spotifyYear })
          : { year: spotifyYear, source: "spotify" as const };
        return {
          ...s,
          year,
          spotifyTrackId: trackId,
          spotifyYear,
          curatedYear: source === "curated" ? year : undefined,
          yearSource: source,
        };
      });
      const valid = enriched.filter((s) => s.year > 0);
      if (valid.length === 0) {
        updateRuntime(id, { loading: false });
        return false;
      }
      updateRuntime(id, {
        loaded: true,
        loading: false,
        songs: valid,
        name: result.name || def.name,
      });
      // Brand new game for this playlist: fresh shuffled deck.
      decksRef.current[id] = createShuffledDeck(valid);
      return true;
    } catch (e) {
      console.error("Error cargando playlist:", e);
      updateRuntime(id, { loading: false });
      return false;
    }
  };

  useEffect(() => {
    // Surface CSV validation issues to the user (logged at module load).
    if (CURATED_VALIDATION.loadedInPool === 0) {
      toast.error("No se cargó ninguna canción del CSV curado. Revisa el archivo.");
    } else if (CURATED_VALIDATION.mismatch) {
      toast.warning(
        `CSV: ${CURATED_VALIDATION.playableInCsv} jugables en el archivo, pero ${CURATED_VALIDATION.loadedInPool} cargadas en memoria.`,
      );
    } else if (CURATED_VALIDATION.hasMissing) {
      const m = CURATED_VALIDATION.missing;
      toast.message(
        `CSV cargado (${CURATED_VALIDATION.loadedInPool}). Filas descartadas por campos vacíos: uri ${m.uri}, año ${m.curatedYear}, título ${m.title}, artista ${m.artist}.`,
      );
    }

    // Build initial decks for any built-in playlist that already has its
    // songs locally available (no fetch required).
    for (const p of BUILTIN_PLAYLISTS) {
      if (p.localSongs && !decksRef.current[p.id]) {
        decksRef.current[p.id] = createShuffledDeck(p.localSongs);
      }
    }

    (async () => {
      await handleRedirect();
      const t = await getAccessToken();

      if (t && !hasRequiredScopes()) {
        toast.message("Actualizando permisos de Spotify para leer playlists...");
        logout();
        await loginWithSpotify();
        return;
      }

      if (!t) {
        setAuthed(false);
        // Hitster default falls back to local songs
        updateRuntime("hitster-es", { loaded: true, songs: SONGS, name: "Beatline – Lista local" });
        decksRef.current["hitster-es"] = createShuffledDeck(SONGS);
        setLoading(false);
        return;
      }

      setAuthed(true);

      const ok = await ensureLoaded("hitster-es");
      if (!ok) {
        updateRuntime("hitster-es", { loaded: true, songs: SONGS, name: "Beatline – Lista local" });
        decksRef.current["hitster-es"] = createShuffledDeck(SONGS);
        toast.message("No se pudo cargar la playlist por defecto desde Spotify. Se usa la lista local.");
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSwitchPlaylist = async (newId: string) => {
    if (newId === activeId) return;
    // Pause current playback if any
    if (active?.phase === "playing" && !active.isPaused) {
      try { await pausePlayback(); } catch {}
      updateRuntime(activeId, { isPaused: true });
    }
    setSwitching(true);
    setActiveId(newId);
    const ok = await ensureLoaded(newId);
    if (ok) {
      // Switching playlists always starts a brand-new game with a fresh
      // shuffled deck — no carry-over from a previous session.
      const songs = (await Promise.resolve(runtimes[newId]?.songs)) || [];
      // ensureLoaded may have just populated the songs in state but our
      // closure has the previous snapshot. Read from setRuntimes instead.
      setRuntimes((prev) => {
        const rt = prev[newId];
        if (rt && rt.songs.length) {
          decksRef.current[newId] = createShuffledDeck(rt.songs);
          return { ...prev, [newId]: { ...rt, phase: "idle", currentSong: null, isPaused: false } };
        }
        return prev;
      });
    }
    setSwitching(false);
    if (!ok) {
      toast.error("No se pudieron cargar las canciones de esta playlist");
    }
  };

  const handleLoadPlaylist = async () => {
    const id = extractPlaylistId(playlistInput);
    if (!id) {
      toast.error("Enlace o URI no válido");
      return;
    }
    setLoadingPlaylist(true);
    try {
      const result = await fetchPlaylistSongs(id);
      const valid = result.songs.filter((s) => s.year > 0);
      if (valid.length === 0) {
        toast.error("No se encontraron canciones válidas");
        return;
      }
      const newDef: PlaylistDef = {
        id: `sp-${id}`,
        name: result.name,
        description: "Playlist personalizada de Spotify",
        spotifyId: id,
        custom: true,
      };
      setPlaylists((prev) => {
        if (prev.some((p) => p.id === newDef.id)) return prev;
        return [...prev, newDef];
      });
      setRuntimes((prev) => ({
        ...prev,
        [newDef.id]: {
          ...initialRuntime(newDef),
          loaded: true,
          songs: valid,
          name: result.name,
        },
      }));
      // Fresh shuffled deck for the newly added playlist.
      decksRef.current[newDef.id] = createShuffledDeck(valid);
      // Pause current playback before switching
      if (active?.phase === "playing" && !active.isPaused) {
        try { await pausePlayback(); } catch {}
        updateRuntime(activeId, { isPaused: true });
      }
      setActiveId(newDef.id);
      setPlaylistInput("");
      setSettingsOpen(false);
      toast.success(`Cargadas ${valid.length} canciones`);
    } catch (e: any) {
      toast.error(e.message || "Error al cargar la playlist");
    } finally {
      setLoadingPlaylist(false);
    }
  };

  // Plays the next song from the active deck. Never repeats songs already
  // drawn in this game session. When the deck is exhausted, leaves the
  // playlist in idle and notifies the user — no silent re-shuffle.
  const playNextFromDeck = async (attemptsLeft = 5) => {
    const id = activeId;
    if (attemptsLeft <= 0) {
      toast.error("No se pudo reproducir ninguna canción");
      return;
    }
    const next = drawNextSong(id);
    if (!next) {
      updateRuntime(id, { phase: "idle", currentSong: null, isPaused: false });
      toast.message("No quedan más canciones en esta partida");
      return;
    }
    if (!next.uri || !/^spotify:track:[a-zA-Z0-9]{22}$/.test(next.uri)) {
      // Discarded forever in this session — already removed from the deck.
      toast.warning("Canción no disponible, saltando...");
      await playNextFromDeck(attemptsLeft - 1);
      return;
    }
    try {
      const initialArt = (next as any).albumArt ?? null;
      updateRuntime(id, {
        currentSong: { ...next, albumArt: initialArt },
        phase: "playing",
        isPaused: false,
      });
      const result = await playTrack(next.uri);
      if (!result.ok) {
        toast.warning("Canción no disponible, saltando...");
        updateRuntime(id, { currentSong: null });
        await playNextFromDeck(attemptsLeft - 1);
        return;
      }
      if (!initialArt) {
        const { albumArt } = await fetchTrack(next.uri);
        setRuntimes((prev) => {
          const cur = prev[id]?.currentSong;
          if (cur && cur.uri === next.uri) {
            return { ...prev, [id]: { ...prev[id], currentSong: { ...cur, albumArt } } };
          }
          return prev;
        });
      }
    } catch (e: any) {
      console.error(e);
      toast.warning("Canción no disponible, saltando...");
      updateRuntime(id, { currentSong: null });
      await playNextFromDeck(attemptsLeft - 1);
    }
  };

  const handlePlay = async () => { await playNextFromDeck(); };
  const handleSkip = async () => {
    updateRuntime(activeId, { currentSong: null });
    await playNextFromDeck();
  };
  const handleTogglePause = async () => {
    if (active.isPaused) {
      await resumePlayback();
      updateRuntime(activeId, { isPaused: false });
    } else {
      await pausePlayback();
      updateRuntime(activeId, { isPaused: true });
    }
  };
  const handleRestart = async () => {
    await seekTo(0);
    if (active.isPaused) {
      await resumePlayback();
      updateRuntime(activeId, { isPaused: false });
    }
  };
  const handleReveal = () => updateRuntime(activeId, { phase: "revealed" });
  const handleNext = async () => {
    updateRuntime(activeId, { currentSong: null });
    await playNextFromDeck();
  };

  const adjustScore = (i: number, delta: number) => {
    const next = active.teams.map((team, idx) =>
      idx === i ? { ...team, score: Math.max(0, team.score + delta) } : team,
    );
    updateRuntime(activeId, { teams: next });
  };

  const handleOpenPlaylistViewer = () => {
    setSettingsOpen(false);
    setShowPlaylistViewer(true);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center">Cargando...</div>;

  if (!authed) {
    const redirectUri = window.location.origin + "/";
    const copyUri = async () => {
      try {
        await navigator.clipboard.writeText(redirectUri);
        toast.success("Redirect URI copiada");
      } catch {
        toast.error("No se pudo copiar");
      }
    };
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 gap-8">
        <h1 className="text-5xl font-black neon-text text-primary tracking-tight">
          <span className="opacity-70 mr-2">▸</span>BEATLINE
        </h1>
        <p className="text-muted-foreground text-center">Ordena las canciones en su línea de tiempo</p>
        <Button
          onClick={loginWithSpotify}
          className="h-20 px-12 text-xl rounded-2xl neon-glow bg-primary hover:bg-primary/90"
        >
          Login con Spotify
        </Button>
        <p className="text-xs text-muted-foreground text-center max-w-xs">
          Necesitas una cuenta de Spotify Premium para reproducir música.
        </p>
        <div className="w-full max-w-sm flex flex-col gap-2 p-4 rounded-xl border border-primary/40 bg-card">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Redirect URI</div>
          <div className="text-sm font-mono break-all text-primary">{redirectUri}</div>
          <Button onClick={copyUri} variant="outline" className="h-12 rounded-xl border-primary/60">
            <Copy className="h-4 w-4 mr-2" /> Copiar
          </Button>
          <p className="text-xs text-muted-foreground">
            Añade esta URL exacta en tu app de Spotify Developer Dashboard.
          </p>
        </div>
      </main>
    );
  }

  // ---------- Mode gating (does NOT alter classic state below) ----------
  if (mode === "select") {
    const rt = runtimes[activeId];
    return (
      <ModeSelector
        onSelect={(m) => setMode(m)}
        playlistName={rt?.name}
        songsCount={rt?.songs.length}
        playlists={playlists.map((p) => ({
          id: p.id,
          name: runtimes[p.id]?.name ?? p.name,
          description: p.description,
          count: runtimes[p.id]?.songs.length ?? 0,
        }))}
        activeId={activeId}
        onSwitchPlaylist={handleSwitchPlaylist}
        switching={switching}
        playlistInput={playlistInput}
        onPlaylistInputChange={setPlaylistInput}
        onLoadPlaylist={handleLoadPlaylist}
        loadingPlaylist={loadingPlaylist}
      />
    );
  }
  if (mode === "timeline") {
    const rt = runtimes[activeId];
    return (
      <TimelineMode
        key={activeId}
        songs={rt?.songs ?? []}
        playlistName={rt?.name ?? ""}
        onExit={() => setMode("select")}
        onChangePlaylist={() => setMode("select")}
      />
    );
  }


  const songs = active.songs;
  const phase = active.phase;
  const currentSong = active.currentSong;
  const isPaused = active.isPaused;
  const teams = active.teams;
  const playlistName = active.name;
  const isLoadingActive = active.loading || switching;
  const isEmpty = !isLoadingActive && songs.length === 0;

  return (
    <main className="min-h-screen flex flex-col p-4 gap-4">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col min-w-0">
            <h1 className="text-2xl font-black neon-text text-primary tracking-tight"><span className="opacity-70 mr-1">▸</span>BEATLINE</h1>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider truncate max-w-[220px]">
              {playlistName}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Ajustes">
                  <Settings className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="bg-background border-primary/40">
                <SheetHeader>
                  <SheetTitle className="text-primary neon-text">Cargar playlist</SheetTitle>
                </SheetHeader>
                <div className="flex flex-col gap-4 mt-6">
                  <Input
                    value={playlistInput}
                    onChange={(e) => setPlaylistInput(e.target.value)}
                    placeholder="Pega el enlace o URI de tu playlist de Spotify"
                    className="h-14 text-base border-primary/60"
                  />
                  <p className="text-xs text-muted-foreground">
                    Nota: Los años de listas personalizadas pueden corresponder a remasters.
                  </p>
                  <Button
                    onClick={handleLoadPlaylist}
                    disabled={loadingPlaylist || !playlistInput.trim()}
                    className="h-14 text-lg rounded-2xl neon-glow bg-primary hover:bg-primary/90"
                  >
                    {loadingPlaylist ? "Cargando..." : "Añadir y usar"}
                  </Button>
                  <div className="text-xs text-muted-foreground border-t border-primary/20 pt-3 mt-2">
                    Playlist actual: <span className="text-primary">{playlistName}</span> ({songs.length} canciones)
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleOpenPlaylistViewer}
                    className="border-primary/40 text-muted-foreground hover:text-primary hover:border-primary/70 bg-transparent"
                  >
                    <ListMusic className="h-4 w-4 mr-2" />
                    Ver playlist completa
                  </Button>
                </div>
              </SheetContent>
            </Sheet>

            <Dialog open={showPlaylistViewer} onOpenChange={setShowPlaylistViewer}>
              <DialogContent className="bg-background border-primary/40 w-[calc(100vw-1rem)] max-w-lg h-[calc(100dvh-1rem)] sm:h-[85dvh] sm:max-h-[760px] p-0 gap-0 flex flex-col overflow-hidden">
                <DialogHeader className="shrink-0 p-5 pb-3 border-b border-primary/20">
                  <DialogTitle className="text-primary neon-text">Playlist completa</DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    <span className="text-primary/90">{playlistName}</span> · {songs.length} canciones
                  </DialogDescription>
                </DialogHeader>
                <div
                  className="playlist-scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  role="region"
                  aria-label="Lista completa de canciones"
                  tabIndex={0}
                >
                  <ol className="divide-y divide-primary/10" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {songs.map((s, i) => (
                      <li key={`${s.uri}-${i}`} className="px-5 py-2.5 text-sm flex gap-3 items-baseline hover:bg-primary/5">
                        <span className="text-primary/70 font-mono text-xs w-10 shrink-0">#{String(i + 1).padStart(2, "0")}</span>
                        <span className="text-muted-foreground font-mono text-xs w-10 shrink-0">{s.year || "—"}</span>
                        <span className="text-foreground min-w-0 flex-1 truncate">
                          <span className="text-primary">{s.artist}</span>
                          <span className="text-muted-foreground"> — </span>
                          <span>{s.title}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="shrink-0 p-3 border-t border-primary/20 flex justify-end">
                  <Button
                    variant="ghost"
                    onClick={() => setShowPlaylistViewer(false)}
                    className="text-muted-foreground hover:text-primary"
                  >
                    Cerrar
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Button
              variant="ghost"
              size="icon"
              onClick={async () => {
                // Pause any in-flight playback so we don't leave audio orphaned
                if (active.phase === "playing" && !active.isPaused) {
                  try { await pausePlayback(); } catch {}
                  updateRuntime(activeId, { isPaused: true });
                }
                setMode("select");
              }}
              aria-label="Cambiar modo de juego"
              title="Cambiar modo de juego"
            >
              <Gamepad2 className="h-5 w-5" />
            </Button>


            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                logout();
                setAuthed(false);
                setMode("select");
                setPlaylists(BUILTIN_PLAYLISTS);
                setActiveId(BUILTIN_PLAYLISTS[0].id);
                const map: Record<string, PlaylistRuntime> = {};
                for (const p of BUILTIN_PLAYLISTS) map[p.id] = initialRuntime(p);
                map["hitster-es"] = { ...map["hitster-es"], loaded: true, songs: SONGS };
                setRuntimes(map);
                // Drop every in-memory deck and start fresh decks for built-ins.
                decksRef.current = {};
                for (const p of BUILTIN_PLAYLISTS) {
                  const songs = p.id === "hitster-es" ? SONGS : (p.localSongs ?? []);
                  if (songs.length) decksRef.current[p.id] = createShuffledDeck(songs);
                }
              }}
              aria-label="Cerrar sesión"
            >
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Selector de playlist */}
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">
            Playlist
          </label>
          <Select value={activeId} onValueChange={handleSwitchPlaylist} disabled={switching}>
            <SelectTrigger className="h-11 flex-1 border-primary/50 bg-card/60 text-left">
              <SelectValue placeholder="Selecciona una playlist" />
            </SelectTrigger>
            <SelectContent className="bg-background border-primary/40 max-w-[90vw]">
              {playlists.map((p) => {
                const rt = runtimes[p.id];
                const count = rt?.songs.length ?? 0;
                return (
                  <SelectItem key={p.id} value={p.id} className="py-2.5">
                    <div className="flex flex-col">
                      <span className="font-semibold text-foreground">{p.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {p.description ? `${p.description} · ` : ""}
                        {rt?.loaded ? `${count} canciones` : "no cargada"}
                      </span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {isLoadingActive && (
            <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" aria-label="Cargando" />
          )}
        </div>
      </header>

      {/* Marcador */}
      <div className="grid grid-cols-2 gap-3">
        {teams.map((team, i) => (
          <Card key={i} className="p-4 flex flex-col items-center gap-3 border-primary/40 bg-card/60 backdrop-blur neon-hover">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{team.name}</div>
            <div
              key={team.score}
              className="relative h-32 w-32 rounded-full flex items-center justify-center bg-black border-2 border-primary animate-scale-in"
            >
              <span className="text-6xl font-black text-white tabular-nums leading-none">{team.score}</span>
            </div>
            <div className="flex gap-3">
              <Button size="sm" variant="outline" className="h-12 w-12 text-2xl border-primary/60 bg-black neon-hover" onClick={() => adjustScore(i, -1)}>−</Button>
              <Button size="sm" variant="outline" className="h-12 w-12 text-2xl border-primary/60 bg-black neon-hover" onClick={() => adjustScore(i, 1)}>+</Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Zona principal */}
      <section key={activeId} className="flex-1 flex flex-col items-center justify-center gap-6 animate-fade-in">
        {isLoadingActive && (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <span className="text-sm uppercase tracking-widest">Cargando playlist...</span>
          </div>
        )}

        {!isLoadingActive && isEmpty && (
          <div className="flex flex-col items-center gap-3 text-center max-w-sm px-6">
            <Disc3 className="h-16 w-16 text-primary/60" />
            <h2 className="text-xl font-bold text-foreground">Sin canciones disponibles</h2>
            <p className="text-sm text-muted-foreground">
              Esta playlist no tiene canciones cargadas. Selecciona otra o añade una nueva desde ajustes.
            </p>
            <Button
              variant="outline"
              onClick={() => setSettingsOpen(true)}
              className="mt-2 border-primary/60 bg-transparent hover:bg-primary/10"
            >
              <Settings className="h-4 w-4 mr-2" /> Abrir ajustes
            </Button>
          </div>
        )}

        {!isLoadingActive && !isEmpty && phase === "idle" && (
          <button
            key="idle"
            onClick={handlePlay}
            className="h-64 w-64 rounded-full bg-primary text-primary-foreground neon-glow-strong flex flex-col items-center justify-center text-4xl font-black active:scale-95 hover:scale-105 transition-transform duration-300 animate-scale-in animate-neon-pulse"
          >
            <Play className="h-24 w-24 mb-2 fill-current" />
            PLAY
          </button>
        )}

        {!isLoadingActive && phase === "playing" && currentSong && (
          <div key={currentSong.uri} className="w-full flex flex-col gap-4 animate-fade-in">
            <div className="text-center text-lg text-muted-foreground animate-pulse tracking-widest uppercase">
              {isPaused ? "En pausa" : "Sonando..."}
            </div>
            <Button onClick={handleReveal} className="h-32 w-full text-3xl rounded-2xl bg-primary hover:bg-primary/90 neon-hover font-black tracking-wide">
              <Eye className="h-10 w-10 mr-3" /> REVELAR INFO
            </Button>
            <div className="grid grid-cols-3 gap-3">
              <Button onClick={handleRestart} variant="outline" className="h-20 rounded-2xl border-2 border-primary bg-black hover:bg-primary/20 neon-hover">
                <SkipBack className="!h-9 !w-9 fill-current" />
              </Button>
              <Button onClick={handleSkip} variant="outline" className="h-20 rounded-2xl border-2 border-primary bg-black hover:bg-primary/20 neon-hover">
                <SkipForward className="!h-9 !w-9 fill-current" />
              </Button>
              <Button onClick={handleTogglePause} variant="outline" className="h-20 rounded-2xl border-2 border-primary bg-black hover:bg-primary/20 neon-hover">
                {isPaused ? <Play className="!h-9 !w-9 fill-current" /> : <Pause className="!h-9 !w-9 fill-current" />}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Visualizador de audio */}
      {!isLoadingActive && (phase === "playing" || phase === "revealed") && currentSong && (
        <div className="flex items-end justify-center gap-1.5 h-16 pb-2" aria-hidden="true">
          {Array.from({ length: 24 }).map((_, i) => (
            <span
              key={i}
              className="w-2 rounded-full bg-primary"
              style={{
                height: isPaused ? "8px" : `${20 + ((i * 37) % 60)}%`,
                animation: isPaused ? "none" : `eq-bar ${0.6 + (i % 5) * 0.15}s ease-in-out ${i * 0.05}s infinite alternate`,
                boxShadow: "0 0 8px hsl(var(--neon) / 0.6)",
                transition: "height 0.3s ease",
              }}
            />
          ))}
        </div>
      )}

      {!isLoadingActive && phase === "revealed" && currentSong && (
        <SongRevealScreen
          key={`reveal-${currentSong.uri}`}
          albumArt={currentSong.albumArt}
          year={currentSong.year}
          artist={currentSong.artist}
          title={currentSong.title}
          isPaused={isPaused}
          onTogglePause={handleTogglePause}
          onBack={() => updateRuntime(activeId, { phase: "playing" })}
          actionLabel="SIGUIENTE CANCIÓN"
          onAction={handleNext}
        />
      )}
    </main>
  );
};

export default Index;
