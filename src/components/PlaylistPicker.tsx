import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface PlaylistOption {
  id: string;
  name: string;
  description?: string;
  count: number;
}

interface Props {
  playlists: PlaylistOption[];
  activeId: string;
  onSwitch: (id: string) => void;
  switching?: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onLoad: () => void;
  loading?: boolean;
}

/**
 * Shared playlist source controls: pick an already-loaded playlist or paste a
 * Spotify link/URI to add a custom one. Purely presentational — all parsing,
 * validation, fetching and state handling stay in the page-level handlers that
 * classic mode already uses.
 */
export default function PlaylistPicker({
  playlists,
  activeId,
  onSwitch,
  switching,
  input,
  onInputChange,
  onLoad,
  loading,
}: Props) {
  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">
          Playlist
        </label>
        <Select value={activeId} onValueChange={onSwitch} disabled={switching}>
          <SelectTrigger className="h-11 flex-1 border-primary/50 bg-card/60 text-left">
            <SelectValue placeholder="Selecciona una playlist" />
          </SelectTrigger>
          <SelectContent className="bg-background border-primary/40 max-w-[90vw]">
            {playlists.map((p) => (
              <SelectItem key={p.id} value={p.id} className="py-2.5">
                <div className="flex flex-col">
                  <span className="text-sm">{p.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {p.count} canciones{p.description ? ` · ${p.description}` : ""}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Pega el enlace o URI de tu playlist de Spotify"
          className="h-11 text-sm border-primary/60"
        />
        <Button
          onClick={onLoad}
          disabled={loading || !input.trim()}
          className="h-11 rounded-xl bg-primary hover:bg-primary/90 shrink-0"
        >
          {loading ? "Cargando..." : "Añadir"}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Nota: los años de listas personalizadas pueden corresponder a remasters.
      </p>
    </div>
  );
}
