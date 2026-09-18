import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Disc3, Pause, Play, Undo2 } from "lucide-react";

/**
 * Shared post-reveal presentation screen.
 *
 * Extracted verbatim from the Classic Mode reveal view so both modes render
 * the exact same information (cover art, year, main artist, featuring,
 * title) with the same visual language.
 *
 * `layout="landscape"` is a compact variant used by Timeline Mode (mobile
 * landscape / PWA) — same data & pattern, denser arrangement.
 */
export interface SongRevealScreenProps {
  albumArt: string | null;
  year: number;
  artist: string;
  title: string;
  isPaused: boolean;
  onTogglePause: () => void;
  onBack?: () => void;
  actionLabel: string;
  onAction: () => void;
  layout?: "portrait" | "landscape";
  /** Optional extra content (e.g. Timeline Mode turn result summary). */
  children?: ReactNode;
}

/** Classic Mode artist/featuring split — reused as-is. */
export function splitArtist(artist: string) {
  const parts = artist.split(/,\s*|\s+&\s+|\s+feat\.?\s+|\s+ft\.?\s+/i).filter(Boolean);
  return { main: parts[0] || artist, feat: parts.slice(1) };
}

export const SongRevealScreen = ({
  albumArt,
  year,
  artist,
  title,
  isPaused,
  onTogglePause,
  onBack,
  actionLabel,
  onAction,
  layout = "portrait",
  children,
}: SongRevealScreenProps) => {
  const { main, feat } = splitArtist(artist);

  const cover = (
    <div
      className={`${
        layout === "landscape"
          ? "h-[42vh] max-h-[46vh] aspect-square"
          : "w-64 h-64 sm:w-80 sm:h-80"
      } rounded-2xl overflow-hidden border-2 border-primary neon-glow-strong bg-secondary flex items-center justify-center animate-scale-in shrink-0`}
    >
      {albumArt ? (
        <img
          src={albumArt}
          alt={`Carátula de ${title} de ${artist}`}
          className="w-full h-full object-cover"
        />
      ) : (
        <Disc3 className={`${layout === "landscape" ? "h-16 w-16" : "h-24 w-24"} text-primary animate-spin`} />
      )}
    </div>
  );

  const pauseBtn = (
    <Button
      onClick={onTogglePause}
      variant="outline"
      size="icon"
      className={`${layout === "landscape" ? "h-11 w-11" : "h-14 w-14"} rounded-full border-2 border-primary bg-black neon-hover shrink-0`}
      aria-label={isPaused ? "Reanudar" : "Pausar"}
    >
      {isPaused ? (
        <Play className={layout === "landscape" ? "!h-5 !w-5 fill-current" : "!h-7 !w-7 fill-current"} />
      ) : (
        <Pause className={layout === "landscape" ? "!h-5 !w-5 fill-current" : "!h-7 !w-7 fill-current"} />
      )}
    </Button>
  );

  if (layout === "landscape") {
    return (
      <div
        className="fixed inset-0 z-50 bg-black flex items-center gap-4 px-4 animate-fade-in"
        style={{
          paddingTop: "max(0.5rem, env(safe-area-inset-top))",
          paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
        }}
      >
        {cover}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
          <div className="text-[4.5rem] leading-none font-black text-white tabular-nums animate-scale-in" style={{ letterSpacing: "0.03em" }}>
            {year}
          </div>
          <div className="text-2xl font-black text-primary neon-text leading-tight truncate">{main}</div>
          {feat.length > 0 && (
            <div className="text-xs font-medium text-muted-foreground truncate">feat. {feat.join(", ")}</div>
          )}
          <div className="text-base text-foreground/80 italic truncate">{title}</div>
          {children && <div className="mt-1">{children}</div>}
        </div>
        <div className="flex flex-col items-center justify-center gap-3 shrink-0">
          {onBack && (
            <Button
              onClick={onBack}
              variant="outline"
              size="icon"
              aria-label="Volver"
              className="h-11 w-11 rounded-xl border border-primary/50 bg-black/60 text-foreground hover:bg-primary/20"
            >
              <Undo2 className="h-5 w-5" />
            </Button>
          )}
          {pauseBtn}
          <Button
            onClick={onAction}
            className="h-16 px-6 text-base rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-black tracking-wide neon-glow-strong"
          >
            {actionLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col p-6 gap-6 overflow-y-auto animate-fade-in">
      <div className="flex justify-between items-center">
        {onBack ? (
          <Button
            onClick={onBack}
            variant="outline"
            size="icon"
            aria-label="Volver al menú"
            className="h-12 w-12 rounded-xl border border-primary/50 bg-black/60 text-foreground hover:bg-primary/20"
          >
            <Undo2 className="h-5 w-5" />
          </Button>
        ) : (
          <span />
        )}
        {pauseBtn}
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        {cover}
        <div className="text-[7rem] sm:text-[10rem] font-black text-white leading-none animate-scale-in" style={{ letterSpacing: "0.04em" }}>
          {year}
        </div>
        <div className="text-center animate-fade-in max-w-full px-4">
          <div className="text-4xl font-black text-primary neon-text leading-tight">{main}</div>
          {feat.length > 0 && (
            <div className="text-lg font-medium text-muted-foreground mt-1">feat. {feat.join(", ")}</div>
          )}
          <div className="text-xl text-foreground/80 mt-2 italic">{title}</div>
        </div>
        {children}
      </div>
      <Button
        onClick={onAction}
        className="h-28 w-full text-2xl rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-black tracking-wide neon-glow-strong"
      >
        {actionLabel}
      </Button>
    </div>
  );
};

export default SongRevealScreen;
