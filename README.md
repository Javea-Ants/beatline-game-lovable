# Beatline Game (Hitster con Spotify)

Réplica del juego de mesa **Hitster** integrada con la API de Spotify, convertida en **PWA instalable** (funciona en Android e iOS).

## Requisitos

- Node.js 22+ (recomendado gestionado con [nvm](https://github.com/nvm-sh/nvm))
- Cuenta de **Spotify Premium** para reproducir música
- App de Spotify Developer con tu `CLIENT_ID`

## Configuración

1. Instala dependencias:

   ```bash
   npm install
   ```

2. Crea una app en [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) y copia tu `CLIENT_ID` en `src/lib/spotify.ts` (constante `CLIENT_ID`).
3. En la misma app, añade tu URL en **Redirect URIs** (para local: `http://localhost:8080/`).

## Desarrollo

```bash
npm run dev
```

## Compilar

```bash
npm run build   # genera dist/ con el service worker (sw.js)
npm run preview # sirve el build para probar
```

## Desplegar (Cloudflare Pages)

- Repo conectado a GitHub; en Cloudflare Pages importa el repo, comando de build `npm run build` y directorio `dist`.
- La URL final (`*.pages.dev`) debe añadirse como Redirect URI en tu app de Spotify.