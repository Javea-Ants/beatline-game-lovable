import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { loginWithSpotify, handleRedirect, getAccessToken, playTrack, pausePlayback, resumePlayback, seekTo, logout, fetchTrack } from "@/lib/spotify";
import { SONGS, type Song } from "@/lib/songs";
import { Play, Pause, SkipForward, SkipBack, Eye, LogOut, Coins, Copy, Disc3 } from "lucide-react";
import { toast } from "sonner";

type Phase = "idle" | "playing" | "revealed";

interface Team { name: string; score: number; tokens: number; }

const Index = () => {
  const PLAYLIST_NAME = "Temazos de varias décadas";
  const [authed, setAuthed] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [song, setSong] = useState<Song | null>(null);
  const [albumArt, setAlbumArt] = useState<string | null>(null);
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

  const pickRandom = () => SONGS[Math.floor(Math.random() * SONGS.length)];

  const handlePlay = async () => {
    try {
      const s = pickRandom();
      setSong(s);
      setPhase("playing");
      setIsPaused(false);
      await playTrack(s.uri);
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

  const handleReveal = async () => {
    await pausePlayback();
    setIsPaused(true);
    setPhase("revealed");
  };

  const handleNext = () => {
    setPhase("idle");
    setSong(null);
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
        <div className="flex flex-col">
          <h1 className="text-2xl font-black neon-text text-primary">HITSTER</h1>
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            Playlist: {PLAYLIST_NAME}
          </span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => { logout(); setAuthed(false); }}>
          <LogOut className="h-5 w-5" />
        </Button>
      </header>

      {/* Marcador */}
      <div className="grid grid-cols-2 gap-3">
        {teams.map((team, i) => (
          <Card key={i} className="p-3 flex flex-col items-center gap-2 border-primary/40">
            <div className="text-sm font-semibold text-muted-foreground">{team.name}</div>
            <div className="text-4xl font-black neon-text text-primary">{team.score}</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-10 w-10 text-xl" onClick={() => adjustScore(i, -1)}>−</Button>
              <Button size="sm" variant="outline" className="h-10 w-10 text-xl" onClick={() => adjustScore(i, 1)}>+</Button>
            </div>
            <div className="flex gap-1 mt-1">
              {Array.from({ length: 3 }).map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => idx < team.tokens && useToken(i)}
                  disabled={idx >= team.tokens}
                  className={`h-9 w-9 rounded-full flex items-center justify-center transition ${
                    idx < team.tokens ? "bg-primary text-primary-foreground neon-glow" : "bg-muted opacity-30"
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
            onClick={handlePlay}
            className="h-64 w-64 rounded-full bg-primary text-primary-foreground neon-glow flex flex-col items-center justify-center text-4xl font-black active:scale-95 transition"
          >
            <Play className="h-24 w-24 mb-2 fill-current" />
            PLAY
          </button>
        )}

        {phase === "playing" && (
          <div className="w-full flex flex-col gap-4">
            <div className="text-center text-lg text-muted-foreground animate-pulse">
              {isPaused ? "En pausa" : "Sonando..."}
            </div>
            <Button onClick={handleReveal} className="h-24 text-2xl rounded-2xl neon-glow bg-primary hover:bg-primary/90">
              <Eye className="h-8 w-8 mr-3" /> REVELAR INFO
            </Button>
            <div className="grid grid-cols-3 gap-3">
              <Button onClick={handleRestart} variant="outline" className="h-20 rounded-2xl border-2 border-primary bg-black hover:bg-primary/20 neon-glow">
                <SkipBack className="!h-9 !w-9 fill-current" />
              </Button>
              <Button onClick={handleSkip} variant="outline" className="h-20 rounded-2xl border-2 border-primary bg-black hover:bg-primary/20 neon-glow">
                <SkipForward className="!h-9 !w-9 fill-current" />
              </Button>
              <Button onClick={handleTogglePause} variant="outline" className="h-20 rounded-2xl border-2 border-primary bg-black hover:bg-primary/20 neon-glow">
                {isPaused ? <Play className="!h-9 !w-9 fill-current" /> : <Pause className="!h-9 !w-9 fill-current" />}
              </Button>
            </div>
          </div>
        )}

        {phase === "revealed" && song && (
          <div className="w-full flex flex-col items-center gap-6">
            <div className="text-9xl font-black neon-text text-primary tracking-tighter">
              {song.year}
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold">{song.artist}</div>
              <div className="text-xl text-muted-foreground mt-1">{song.title}</div>
            </div>
            <Button onClick={handleNext} className="h-20 w-full text-2xl rounded-2xl neon-glow bg-primary hover:bg-primary/90">
              SIGUIENTE
            </Button>
          </div>
        )}
      </section>
    </main>
  );
};

export default Index;
