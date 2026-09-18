// Curated year overrides for the default HITSTER playlist.
//
// Source of truth: src/data/hitster-curated.csv
// To update curated years in the future, simply replace that CSV file
// (keeping the same columns) and the app will pick up the new values
// automatically on next load — no code changes required.
//
// Resolution priority for a song's year:
//   1. curated_year from CSV (matched by spotify_track_id, then spotify_uri)
//   2. spotify year (release_date) returned by the Spotify API
//
// This applies only to the default HITSTER playlist. Custom user playlists
// continue to use Spotify's release year as before.

import csvRaw from "@/data/hitster-curated.csv?raw";

export interface CuratedEntry {
  trackId: string;
  uri: string;
  curatedYear: number | null;
  spotifyYear: number | null;
  title?: string;
  artist?: string;
  status?: string;
  notes?: string;
}

export type YearSource = "curated" | "spotify";


// Minimal CSV parser supporting quoted fields with commas.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export interface CuratedStats {
  csvDataRows: number;       // rows in CSV minus header (skipping fully empty lines)
  parsedEntries: number;     // rows that produced a CuratedEntry (had id or uri)
  playable: number;          // entries usable as game songs (uri + curated_year + title + artist)
  duplicates: number;        // duplicate spotify_track_id rows
  missing: {
    uri: number;
    curatedYear: number;
    title: number;
    artist: number;
  };
}

let CURATED_STATS: CuratedStats = {
  csvDataRows: 0,
  parsedEntries: 0,
  playable: 0,
  duplicates: 0,
  missing: { uri: 0, curatedYear: 0, title: 0, artist: 0 },
};

function buildIndex(): { byId: Map<string, CuratedEntry>; byUri: Map<string, CuratedEntry> } {
  const byId = new Map<string, CuratedEntry>();
  const byUri = new Map<string, CuratedEntry>();
  // Strip BOM
  const text = csvRaw.replace(/^\uFEFF/, "");
  const rows = parseCsv(text);
  if (rows.length < 2) return { byId, byUri };
  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const iId = idx("spotify_track_id");
  const iUri = idx("spotify_uri");
  const iCurated = idx("curated_year");
  const iSpotify = idx("spotify_year");
  const iTitle = idx("Track name");
  const iArtist = idx("Artist name");
  const iStatus = idx("status");
  const iNotes = idx("notes");

  const stats: CuratedStats = {
    csvDataRows: 0,
    parsedEntries: 0,
    playable: 0,
    duplicates: 0,
    missing: { uri: 0, curatedYear: 0, title: 0, artist: 0 },
  };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    // Skip rows where every field is empty (trailing blank line in CSV)
    const nonEmpty = row.some((c) => (c || "").trim().length > 0);
    if (!nonEmpty) continue;
    stats.csvDataRows++;

    const trackId = (row[iId] || "").trim();
    const uri = (row[iUri] || "").trim();
    if (!trackId && !uri) continue;
    const curated = parseInt((row[iCurated] || "").trim(), 10);
    const spotifyY = parseInt((row[iSpotify] || "").trim(), 10);
    const title = iTitle >= 0 ? (row[iTitle] || "").trim() : "";
    const artist = iArtist >= 0 ? (row[iArtist] || "").trim() : "";
    const curatedYear = Number.isFinite(curated) && curated > 0 ? curated : null;

    if (!uri) stats.missing.uri++;
    if (!curatedYear) stats.missing.curatedYear++;
    if (!title) stats.missing.title++;
    if (!artist) stats.missing.artist++;

    const entry: CuratedEntry = {
      trackId,
      uri,
      curatedYear,
      spotifyYear: Number.isFinite(spotifyY) && spotifyY > 0 ? spotifyY : null,
      title: title || undefined,
      artist: artist || undefined,
      status: iStatus >= 0 ? row[iStatus] : undefined,
      notes: iNotes >= 0 ? row[iNotes] : undefined,
    };
    stats.parsedEntries++;
    if (uri && curatedYear && title && artist) stats.playable++;
    if (trackId) {
      if (byId.has(trackId)) stats.duplicates++;
      byId.set(trackId, entry);
    }
    if (uri) byUri.set(uri, entry);
  }
  CURATED_STATS = stats;
  return { byId, byUri };

}


const { byId: CURATED_BY_ID, byUri: CURATED_BY_URI } = buildIndex();

export function lookupCurated(trackId?: string | null, uri?: string | null): CuratedEntry | null {
  if (trackId && CURATED_BY_ID.has(trackId)) return CURATED_BY_ID.get(trackId)!;
  if (uri && CURATED_BY_URI.has(uri)) return CURATED_BY_URI.get(uri)!;
  return null;
}

/**
 * Resolve the final year for a song, applying curated overrides when
 * available. Returns the year plus its source for traceability.
 */
export function resolveYear(params: {
  trackId?: string | null;
  uri?: string | null;
  spotifyYear: number;
}): { year: number; source: YearSource } {
  const entry = lookupCurated(params.trackId, params.uri);
  if (entry?.curatedYear) return { year: entry.curatedYear, source: "curated" };
  return { year: params.spotifyYear, source: "spotify" };
}

export function curatedSize(): number {
  return CURATED_BY_ID.size;
}

/**
 * Full curated song list ready to be used as the default HITSTER pool.
 * Sources every field (title, artist, year, uri) directly from the CSV,
 * so the random pool is the entire curated dataset — independent of
 * which songs happen to be present in any Spotify playlist.
 */
export function getCuratedSongs(): Array<{
  title: string;
  artist: string;
  year: number;
  uri: string;
  spotifyTrackId: string;
  spotifyYear?: number;
  curatedYear: number;
  yearSource: "curated";
}> {
  const out: ReturnType<typeof getCuratedSongs> = [];
  const seen = new Set<string>();
  for (const e of CURATED_BY_ID.values()) {
    if (!e.uri || !e.curatedYear || !e.title || !e.artist) continue;
    if (seen.has(e.trackId)) continue;
    seen.add(e.trackId);
    out.push({
      title: e.title,
      artist: e.artist,
      year: e.curatedYear,
      uri: e.uri,
      spotifyTrackId: e.trackId,
      spotifyYear: e.spotifyYear ?? undefined,
      curatedYear: e.curatedYear,
      yearSource: "curated",
    });
  }
  return out;
}

export function getCuratedStats(): CuratedStats {
  return CURATED_STATS;
}


