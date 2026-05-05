import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { loginWithSpotify, handleRedirect, getAccessToken, playTrack, pausePlayback, resumePlayback, seekTo, logout, fetchTrack, extractPlaylistId, fetchPlaylistSongs } from "@/lib/spotify";
import { SONGS, type Song } from "@/lib/songs";
import { Play, Pause, SkipForward, SkipBack, Eye, LogOut, Coins, Copy, Disc3, Settings } from "lucide-react";
import { toast } from "sonner";

type Phase = "idle" | "playing" | "revealed";

interface Team { name: string; score: number; tokens: number; }

const DEFAULT_PLAYLIST_NAME = "Temazos de varias décadas";

const Index = () => {
  const [authed, setAuthed] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [song, setSong] = useState<Song | null>(null);
  const [albumArt, setAlbumArt] = useState<string | null>(null);
  const [playlistName, setPlaylistName] = useState(DEFAULT_PLAYLIST_NAME);
  const [songs, setSongs] = useState<Song[]>(SONGS);
  const [playlistInput, setPlaylistInput] = useState("");
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [teams, setTeams] = useState<Team[]>([
    { name: "Equipo 1", score: 0, tokens: 3 },
    { name: "Equipo 2", score: 0, tokens: 3 },
  ]);

  useEffect(() => {
    (async () => {
      await handleRedirect();
      const t = await getAccessToken();
      setAuthed(!!t);
      setLoading(false);
    })();
  }, []);

  const pickRandom = () => songs[Math.floor(Math.random() * songs.length)];

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
      setSongs(valid);
      setPlaylistName(result.name);
      setPlaylistInput("");
      setSettingsOpen(false);
      toast.success(`Cargadas ${valid.length} canciones`);
    } catch (e: any) {
      toast.error(e.message || "Error al cargar la playlist");
    } finally {
      setLoadingPlaylist(false);
    }
  };

  const handlePlay = async () => {
    try {
      const s = pickRandom();
      setSong(s);
      setAlbumArt(null);
      setPhase("playing");
      setIsPaused(false);
      await playTrack(s.uri);
      fetchTrack(s.uri).then((d) => setAlbumArt(d.albumArt));
    } catch (e: any) {
      toast.error("Error al reproducir. Necesitas Spotify Premium.");
      console.error(e);
    }
  };

  const handleSkip = async () => {
    await pausePlayback();
    handlePlay();
  };

  const handleTogglePause = async () => {
    if (isPaused) {
      await resumePlayback();
      setIsPaused(false);
    } else {
      await pausePlayback();
      setIsPaused(true);
    }
  };

  const handleRestart = async () => {
    await seekTo(0);
    if (isPaused) {
      await resumePlayback();
      setIsPaused(false);
    }
  };

  const handleReveal = () => {
    setPhase("revealed");
  };

  const handleNext = async () => {
    await pausePlayback();
    setPhase("idle");
    setSong(null);
    setAlbumArt(null);
    await handlePlay();
  };

  const adjustScore = (i: number, delta: number) => {
    setTeams((t) => t.map((team, idx) => idx === i ? { ...team, score: Math.max(0, team.score + delta) } : team));
  };

  const useToken = (i: number) => {
    setTeams((t) => t.map((team, idx) => idx === i && team.tokens > 0 ? { ...team, tokens: team.tokens - 1 } : team));
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
        <h1 className="text-5xl font-black neon-text text-primary">HITSTER</h1>
        <p className="text-muted-foreground text-center">Adivina el año de la canción</p>
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

  return (
    <main className="min-h-screen flex flex-col p-4 gap-4">
      <header className="flex items-center justify-between">
        <div className="flex flex-col min-w-0">
          <h1 className="text-2xl font-black neon-text text-primary">HITSTER</h1>
          <span className="text-xs text-muted-foreground uppercase tracking-wider truncate max-w-[200px]">
            Playlist: {playlistName}
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
                  {loadingPlaylist ? "Cargando..." : "Cargar Lista"}
                </Button>
                <div className="text-xs text-muted-foreground border-t border-primary/20 pt-3 mt-2">
                  Playlist actual: <span className="text-primary">{playlistName}</span> ({songs.length} canciones)
                </div>
              </div>
            </SheetContent>
          </Sheet>
          <Button variant="ghost" size="icon" onClick={() => { logout(); setAuthed(false); }} aria-label="Cerrar sesión">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Marcador */}
      <div className="grid grid-cols-2 gap-3">
        {teams.map((team, i) => (
          <Card key={i} className="p-3 flex flex-col items-center gap-3 border-primary/40 bg-card/60 backdrop-blur neon-hover">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{team.name}</div>
            <div
              key={team.score}
              className="relative h-20 w-20 rounded-full flex items-center justify-center bg-black border-2 border-primary neon-glow-strong animate-scale-in"
            >
              <span className="text-3xl font-black text-primary neon-text tabular-nums">{team.score}</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-10 w-10 text-xl border-primary/60 bg-black neon-hover" onClick={() => adjustScore(i, -1)}>−</Button>
              <Button size="sm" variant="outline" className="h-10 w-10 text-xl border-primary/60 bg-black neon-hover" onClick={() => adjustScore(i, 1)}>+</Button>
            </div>
            <div className="flex gap-1.5">
              {Array.from({ length: 3 }).map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => idx < team.tokens && useToken(i)}
                  disabled={idx >= team.tokens}
                  className={`h-9 w-9 rounded-full flex items-center justify-center transition-all duration-200 ${
                    idx < team.tokens
                      ? "bg-primary text-primary-foreground neon-glow hover:scale-110 hover:neon-glow-strong"
                      : "bg-muted opacity-30"
                  }`}
                  aria-label="Comodín"
                >
                  <Coins className="h-4 w-4" />
                </button>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/* Zona principal */}
      <section className="flex-1 flex flex-col items-center justify-center gap-6">
        {phase === "idle" && (
          <button
            key="idle"
            onClick={handlePlay}
            className="h-64 w-64 rounded-full bg-primary text-primary-foreground neon-glow-strong flex flex-col items-center justify-center text-4xl font-black active:scale-95 hover:scale-105 transition-transform duration-300 animate-scale-in animate-neon-pulse"
          >
            <Play className="h-24 w-24 mb-2 fill-current" />
            PLAY
          </button>
        )}

        {phase === "playing" && song && (
          <div key={song.uri} className="w-full flex flex-col gap-4 animate-fade-in">
            <div className="text-center text-lg text-muted-foreground animate-pulse tracking-widest uppercase">
              {isPaused ? "En pausa" : "Sonando..."}
            </div>
            <Button onClick={handleReveal} className="h-24 text-2xl rounded-2xl neon-glow-strong bg-primary hover:bg-primary/90 neon-hover font-black tracking-wide">
              <Eye className="h-8 w-8 mr-3" /> REVELAR INFO
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

      {phase === "revealed" && song && (
        <div key={`reveal-${song.uri}`} className="fixed inset-0 z-50 bg-black flex flex-col p-6 gap-6 overflow-y-auto animate-fade-in">
          <div className="flex justify-end">
            <Button
              onClick={handleTogglePause}
              variant="outline"
              size="icon"
              className="h-14 w-14 rounded-full border-2 border-primary bg-black neon-hover"
              aria-label={isPaused ? "Reanudar" : "Pausar"}
            >
              {isPaused ? <Play className="!h-7 !w-7 fill-current" /> : <Pause className="!h-7 !w-7 fill-current" />}
            </Button>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center gap-6">
            <div className="w-64 h-64 sm:w-80 sm:h-80 rounded-2xl overflow-hidden border-2 border-primary neon-glow-strong bg-secondary flex items-center justify-center animate-scale-in">
              {albumArt ? (
                <img src={albumArt} alt={`Carátula de ${song.title} de ${song.artist}`} className="w-full h-full object-cover" />
              ) : (
                <Disc3 className="h-24 w-24 text-primary animate-spin" />
              )}
            </div>
            <div
              className="text-[7rem] sm:text-[10rem] font-black text-white leading-none animate-scale-in"
              style={{ letterSpacing: "0.04em" }}
            >
              {song.year}
            </div>
            <div className="text-center animate-fade-in">
              <div className="text-3xl font-bold">{song.artist}</div>
              <div className="text-xl text-muted-foreground mt-1">{song.title}</div>
            </div>
          </div>
          <Button
            onClick={handleNext}
            variant="outline"
            className="h-20 w-full text-lg rounded-2xl bg-secondary/60 hover:bg-secondary text-foreground/80 border border-primary/30 font-semibold tracking-wide"
          >
            SIGUIENTE CANCIÓN
          </Button>
        </div>
      )}
    </main>
  );
};

export default Index;

