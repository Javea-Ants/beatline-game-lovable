const CLIENT_ID = "a9a6bce68cd7480990324e9b379fa4bd";
const SCOPES = "streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state";

const REDIRECT_URI = window.location.origin + "/";

function base64url(bytes: Uint8Array) {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(input: string) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(hash));
}

function randomString(len = 64) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return base64url(arr).slice(0, len);
}

export async function loginWithSpotify() {
  const verifier = randomString(64);
  const challenge = await sha256(verifier);
  localStorage.setItem("spotify_verifier", verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
  });
  window.location.href = "https://accounts.spotify.com/authorize?" + params.toString();
}

export async function handleRedirect(): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return false;
  const verifier = localStorage.getItem("spotify_verifier");
  if (!verifier) return false;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (data.access_token) {
    saveTokens(data);
    window.history.replaceState({}, "", "/");
    return true;
  }
  return false;
}

interface TokenData { access_token: string; refresh_token?: string; expires_in: number; }

function saveTokens(data: TokenData) {
  localStorage.setItem("spotify_token", data.access_token);
  if (data.refresh_token) localStorage.setItem("spotify_refresh", data.refresh_token);
  localStorage.setItem("spotify_expires", String(Date.now() + data.expires_in * 1000));
}

export async function getAccessToken(): Promise<string | null> {
  const token = localStorage.getItem("spotify_token");
  const expires = Number(localStorage.getItem("spotify_expires") || 0);
  if (token && Date.now() < expires - 60000) return token;
  const refresh = localStorage.getItem("spotify_refresh");
  if (!refresh) return null;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refresh,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (data.access_token) {
    saveTokens({ ...data, refresh_token: data.refresh_token || refresh });
    return data.access_token;
  }
  return null;
}

export function logout() {
  localStorage.removeItem("spotify_token");
  localStorage.removeItem("spotify_refresh");
  localStorage.removeItem("spotify_expires");
}

// Web Playback SDK
let player: any = null;
let deviceId: string | null = null;

export function loadSpotifySdk(): Promise<void> {
  return new Promise((resolve) => {
    if ((window as any).Spotify) return resolve();
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    document.body.appendChild(script);
    (window as any).onSpotifyWebPlaybackSDKReady = () => resolve();
  });
}

export async function initPlayer(): Promise<string> {
  await loadSpotifySdk();
  if (deviceId) return deviceId;
  const token = await getAccessToken();
  if (!token) throw new Error("No token");
  player = new (window as any).Spotify.Player({
    name: "Hitster Web Player",
    getOAuthToken: (cb: (t: string) => void) => getAccessToken().then((t) => t && cb(t)),
    volume: 0.7,
  });
  return new Promise((resolve, reject) => {
    player.addListener("ready", ({ device_id }: any) => {
      deviceId = device_id;
      resolve(device_id);
    });
    player.addListener("initialization_error", ({ message }: any) => reject(new Error(message)));
    player.addListener("authentication_error", ({ message }: any) => reject(new Error(message)));
    player.addListener("account_error", ({ message }: any) => reject(new Error(message)));
    player.connect();
  });
}

export function isValidTrackUri(uri: string | undefined | null): boolean {
  if (!uri) return false;
  return /^spotify:track:[a-zA-Z0-9]{22}$/.test(uri);
}

export async function reconnectPlayer(): Promise<string | null> {
  try {
    if (player) {
      try { await player.disconnect(); } catch {}
    }
    player = null;
    deviceId = null;
    const id = await initPlayer();
    return id;
  } catch (e) {
    console.error("Reconnect failed", e);
    return null;
  }
}

export async function playTrack(uri: string): Promise<{ ok: boolean; status?: number; reason?: string }> {
  if (!isValidTrackUri(uri)) return { ok: false, reason: "invalid_uri" };
  const token = await getAccessToken();
  let id = await initPlayer();
  const doPlay = async (devId: string) =>
    fetch(`https://api.spotify.com/v1/me/player/play?device_id=${devId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ uris: [uri] }),
    });
  let res = await doPlay(id);
  if (res.status === 404 || res.status === 502) {
    // Device lost — try reconnect once
    const newId = await reconnectPlayer();
    if (newId) res = await doPlay(newId);
  }
  if (!res.ok) {
    let reason = `http_${res.status}`;
    try { const j = await res.json(); reason = j?.error?.reason || j?.error?.message || reason; } catch {}
    return { ok: false, status: res.status, reason };
  }
  return { ok: true };
}

export async function pausePlayback() {
  if (player) { try { await player.pause(); return; } catch {} }
  const token = await getAccessToken();
  if (!deviceId) return;
  await fetch(`https://api.spotify.com/v1/me/player/pause?device_id=${deviceId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function resumePlayback() {
  if (player) { try { await player.resume(); return; } catch {} }
  const token = await getAccessToken();
  if (!deviceId) return;
  await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function seekBy(deltaMs: number) {
  if (!player) return;
  try {
    const state = await player.getCurrentState();
    if (!state) return;
    const next = Math.max(0, state.position + deltaMs);
    await player.seek(next);
  } catch {}
}

export async function seekTo(positionMs: number) {
  if (player) { try { await player.seek(positionMs); return; } catch {} }
}

function pickLargest(images: { url: string; width?: number }[] | undefined): string | null {
  if (!images || !images.length) return null;
  return [...images].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null;
}

const singleArtCache = new Map<string, string | null>();

async function findSingleCover(
  token: string,
  trackName: string,
  artistName: string,
  fallbackArt: string | null
): Promise<string | null> {
  const cacheKey = `${trackName}|${artistName}`.toLowerCase();
  if (singleArtCache.has(cacheKey)) return singleArtCache.get(cacheKey) || fallbackArt;
  try {
    const q = encodeURIComponent(`track:"${trackName}" artist:"${artistName}"`);
    const res = await fetch(
      `https://api.spotify.com/v1/search?type=track&limit=10&q=${q}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      singleArtCache.set(cacheKey, null);
      return fallbackArt;
    }
    const data = await res.json();
    const items: any[] = data?.tracks?.items || [];
    const single = items.find(
      (t) =>
        t?.album?.album_type === "single" &&
        t.name?.toLowerCase() === trackName.toLowerCase() &&
        (t.artists || []).some((a: any) => a.name?.toLowerCase() === artistName.toLowerCase())
    );
    const url = pickLargest(single?.album?.images);
    singleArtCache.set(cacheKey, url);
    return url || fallbackArt;
  } catch {
    return fallbackArt;
  }
}

export async function fetchTrack(uri: string): Promise<{ albumArt: string | null }> {
  const id = uri.split(":").pop();
  const token = await getAccessToken();
  if (!token || !id) return { albumArt: null };
  try {
    const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { albumArt: null };
    const data = await res.json();
    const fallback = pickLargest(data?.album?.images);
    const trackName: string = data?.name || "";
    const artistName: string = data?.artists?.[0]?.name || "";
    // If already a single, just use it
    if (data?.album?.album_type === "single") {
      return { albumArt: fallback };
    }
    if (!trackName || !artistName) return { albumArt: fallback };
    const best = await findSingleCover(token, trackName, artistName, fallback);
    return { albumArt: best };
  } catch {
    return { albumArt: null };
  }
}

export function extractPlaylistId(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  const text = input.trim();
  if (!text) return null;

  const ID_RE = /^[a-zA-Z0-9]{22}$/;
  const OTHER_TYPES = ["track", "album", "artist", "show", "episode", "user", "collection"];

  // 1. Raw playlist ID
  if (ID_RE.test(text)) return text;

  // 2. Spotify URI: spotify:playlist:{id} (possibly embedded)
  const uriMatch = text.match(/spotify:([a-z]+):([a-zA-Z0-9]{22})/i);
  if (uriMatch) {
    if (uriMatch[1].toLowerCase() === "playlist") return uriMatch[2];
    if (OTHER_TYPES.includes(uriMatch[1].toLowerCase())) return null;
  }

  // 3. Try to find a URL inside the text and parse it
  const urlMatches = text.match(/https?:\/\/[^\s]+/gi) || [];
  const candidates: string[] = urlMatches.length ? urlMatches : [text];

  for (const candidate of candidates) {
    let cleaned = candidate.replace(/[)>\].,;'"]+$/g, "");
    let url: URL | null = null;
    try {
      url = new URL(cleaned);
    } catch {
      try {
        url = new URL("https://" + cleaned);
      } catch {
        url = null;
      }
    }
    if (url && /(^|\.)spotify\.com$/i.test(url.hostname)) {
      // Path may be /playlist/{id} or /intl-xx/playlist/{id} or /user/x/playlist/{id}
      const parts = url.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => p.toLowerCase() === "playlist");
      if (idx !== -1 && parts[idx + 1] && ID_RE.test(parts[idx + 1])) {
        return parts[idx + 1];
      }
      // If URL clearly references another entity type, skip
      if (parts.some((p) => OTHER_TYPES.includes(p.toLowerCase()))) continue;
    }
  }

  // 4. Last-resort regex over the whole input for /playlist/{id}
  const pathMatch = text.match(/playlist[/:]([a-zA-Z0-9]{22})(?![a-zA-Z0-9])/i);
  if (pathMatch) return pathMatch[1];

  return null;
}

export interface PlaylistResult {
  name: string;
  songs: { id: string; title: string; artist: string; year: number; uri: string; albumArt: string | null }[];
}

export async function fetchPlaylistSongs(playlistId: string): Promise<PlaylistResult> {
  const token = await getAccessToken();
  if (!token) throw new Error("No token");
  const metaRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}?fields=name`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error("Playlist no encontrada");
  const meta = await metaRes.json();

  const PAGE_SIZE = 100;
  const MAX_PAGES = 50; // safety cap: up to 5000 tracks
  const fields =
    "items(track(uri,type,is_local,id,name,artists(name),album(release_date,images))),next,total";

  const allItems: any[] = [];
  let offset = 0;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${PAGE_SIZE}&offset=${offset}&fields=${encodeURIComponent(
      fields
    )}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      if (pages === 0) throw new Error("No se pudieron cargar las canciones");
      break;
    }
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    allItems.push(...items);
    pages += 1;
    if (!data?.next || items.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const seen = new Set<string>();
  const songs = allItems
    .map((it: any) => it?.track)
    .filter(
      (t: any) =>
        t &&
        t.type === "track" &&
        !t.is_local &&
        t.uri &&
        typeof t.uri === "string" &&
        t.uri.startsWith("spotify:track:") &&
        t.id &&
        t.name &&
        Array.isArray(t.artists) &&
        t.artists.length > 0
    )
    .map((t: any) => ({
      id: t.id as string,
      title: t.name as string,
      artist: (t.artists || []).map((a: any) => a.name).filter(Boolean).join(", "),
      year: parseInt((t.album?.release_date || "0").slice(0, 4), 10) || 0,
      uri: t.uri as string,
      albumArt: t.album?.images?.[0]?.url || null,
    }))
    .filter((s) => s.year > 0)
    .filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

  return { name: meta.name || "Playlist personalizada", songs };
}
