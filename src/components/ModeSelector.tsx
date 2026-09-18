import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Disc3, ListMusic, Smartphone } from "lucide-react";
import PlaylistPicker, { PlaylistOption } from "@/components/PlaylistPicker";

export type GameMode = "classic" | "timeline";

interface Props {
  onSelect: (mode: GameMode) => void;
  playlistName?: string;
  songsCount?: number;
  /** Shared playlist source controls (same logic as classic mode). */
  playlists?: PlaylistOption[];
  activeId?: string;
  onSwitchPlaylist?: (id: string) => void;
  switching?: boolean;
  playlistInput?: string;
  onPlaylistInputChange?: (value: string) => void;
  onLoadPlaylist?: () => void;
  loadingPlaylist?: boolean;
}

/**
 * Mode selector shown at game start. Lets the user pick between the
 * existing classic mode (untouched) and the new timeline mode for two
 * teams in landscape orientation.
 */
export default function ModeSelector({
  onSelect,
  playlistName,
  songsCount,
  playlists,
  activeId,
  onSwitchPlaylist,
  switching,
  playlistInput,
  onPlaylistInputChange,
  onLoadPlaylist,
  loadingPlaylist,
}: Props) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 gap-8">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-5xl font-black neon-text text-primary tracking-tight">
          <span className="opacity-70 mr-2">▸</span>BEATLINE
        </h1>
        <p className="text-muted-foreground text-center">Elige cómo quieres jugar</p>
        {playlistName && (
          <p className="text-[11px] text-muted-foreground uppercase tracking-widest">
            {playlistName}{typeof songsCount === "number" ? ` · ${songsCount} canciones` : ""}
          </p>
        )}
      </div>

      {playlists && activeId && onSwitchPlaylist && onLoadPlaylist && onPlaylistInputChange && (
        <div className="w-full max-w-2xl">
          <PlaylistPicker
            playlists={playlists}
            activeId={activeId}
            onSwitch={onSwitchPlaylist}
            switching={switching}
            input={playlistInput ?? ""}
            onInputChange={onPlaylistInputChange}
            onLoad={onLoadPlaylist}
            loading={loadingPlaylist}
          />
        </div>
      )}


      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl">
        <Card className="p-6 flex flex-col gap-4 border-primary/40 bg-card/60 neon-hover">
          <div className="flex items-center gap-3">
            <Disc3 className="h-8 w-8 text-primary" />
            <h2 className="text-2xl font-black text-foreground">Clásico</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            El modo de siempre: una canción, revela el año, puntúa a mano. Marcador
            de dos equipos y controles familiares.
          </p>
          <Button
            onClick={() => onSelect("classic")}
            className="h-14 text-lg rounded-2xl neon-glow bg-primary hover:bg-primary/90"
          >
            Jugar en clásico
          </Button>
        </Card>

        <Card className="p-6 flex flex-col gap-4 border-primary/40 bg-card/60 neon-hover">
          <div className="flex items-center gap-3">
            <ListMusic className="h-8 w-8 text-primary" />
            <h2 className="text-2xl font-black text-foreground">Timeline</h2>
            <span className="ml-auto text-[10px] uppercase tracking-widest text-primary border border-primary/50 rounded px-1.5 py-0.5">
              Nuevo
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Dos equipos, dos líneas temporales en pantalla. Coloca cada canción en
            su posición correcta. Soporta primis y desafíos.
          </p>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Smartphone className="h-3.5 w-3.5" /> Recomendado en horizontal
          </div>
          <Button
            onClick={() => onSelect("timeline")}
            className="h-14 text-lg rounded-2xl neon-glow bg-primary hover:bg-primary/90"
          >
            Jugar en timeline
          </Button>
        </Card>
      </div>
    </main>
  );
}
