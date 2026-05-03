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

export async function playTrack(uri: string) {
  const token = await getAccessToken();
  const id = await initPlayer();
  await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ uris: [uri] }),
  });
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

export async function fetchTrack(uri: string): Promise<{ albumArt: string | null }> {
  const id = uri.split(":").pop();
  const token = await getAccessToken();
  if (!token || !id) return { albumArt: null };
  try {
    const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    const img = data?.album?.images?.[0]?.url || null;
    return { albumArt: img };
  } catch {
    return { albumArt: null };
  }
}

export function extractPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  let m = trimmed.match(/playlist[/:]([a-zA-Z0-9]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) return trimmed;
  return null;
}

export interface PlaylistResult {
  name: string;
  songs: { title: string; artist: string; year: number; uri: string }[];
}

export async function fetchPlaylistSongs(playlistId: string): Promise<PlaylistResult> {
  const token = await getAccessToken();
  if (!token) throw new Error("No token");
  const metaRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}?fields=name`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error("Playlist no encontrada");
  const meta = await metaRes.json();
  const tracksRes = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&fields=items(track(uri,name,artists(name),album(release_date)))`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const tracksData = await tracksRes.json();
  const songs = (tracksData.items || [])
    .map((it: any) => it.track)
    .filter((t: any) => t && t.uri && t.uri.startsWith("spotify:track:"))
    .map((t: any) => ({
      title: t.name,
      artist: (t.artists || []).map((a: any) => a.name).join(", "),
      year: parseInt((t.album?.release_date || "0").slice(0, 4), 10) || 0,
      uri: t.uri,
    }));
  return { name: meta.name || "Playlist personalizada", songs };
}
