/**
 * La YouTube IFrame API, cargada **una sola vez** por página (#53).
 *
 * El vídeo del dock deja de ser un `<iframe>` mudo: para mandarle `playVideo`,
 * `pauseVideo` o `setPlaybackRate` hace falta el reproductor de YouTube, no el
 * `<iframe>` a pelo. La API se pide a `youtube.com/iframe_api` (el script) y el
 * reproductor se monta con `host: youtube-nocookie.com`, así que el iframe que
 * suena —y sus cookies— siguen en el dominio sin cookies, como hasta ahora.
 *
 * Aquí solo vive la **carga**: el envoltorio del reproductor está en
 * `video-player.ts` y el estado del dock en `player-store.ts`. Los tipos son el
 * mínimo que se usa: no se instala `@types/youtube` para cuatro métodos.
 *
 * Un fallo **no se cachea**: si la red o una extensión bloquean el script, el
 * siguiente intento vuelve a probar en vez de quedarse condenado hasta recargar
 * la página.
 */

export interface YoutubePlayerLike {
  playVideo(): void;
  pauseVideo(): void;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
  destroy(): void;
}

export interface YoutubePlayerEvent {
  target: YoutubePlayerLike;
  /** Estado del reproductor (`-1` sin empezar, `0` fin, `1` sonando…). */
  data: number;
}

export interface YoutubePlayerOptions {
  videoId: string;
  host?: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: YoutubePlayerEvent) => void;
    onStateChange?: (event: YoutubePlayerEvent) => void;
    onPlaybackRateChange?: (event: YoutubePlayerEvent) => void;
    onError?: (event: YoutubePlayerEvent) => void;
  };
}

export interface YoutubeApi {
  Player: new (host: HTMLElement | string, options: YoutubePlayerOptions) => YoutubePlayerLike;
}

declare global {
  interface Window {
    YT?: YoutubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** El script oficial. No hay copia local: YouTube no lo permite. */
const API_SRC = 'https://www.youtube.com/iframe_api';

/** Una sola promesa por página: dos vídeos abiertos no piden el script dos veces. */
let apiPromise: Promise<YoutubeApi> | null = null;

/** ¿Está ya disponible sin pedir nada? (segundo vídeo, o script cargado por otro). */
function readyApi(): YoutubeApi | null {
  if (typeof window === 'undefined') return null;
  return window.YT?.Player ? window.YT : null;
}

/**
 * La API, cargada o en camino. Rechaza si el script no llega o si llega sin
 * `YT.Player` — el caso de un bloqueo de red, que el dock trata como «sin
 * control», no como un fallo del reproductor.
 */
export function loadYoutubeApi(): Promise<YoutubeApi> {
  if (apiPromise) return apiPromise;

  const ready = readyApi();
  if (ready) {
    apiPromise = Promise.resolve(ready);
    return apiPromise;
  }

  if (typeof document === 'undefined') {
    return Promise.reject(new Error('YouTube IFrame API needs a document'));
  }

  apiPromise = new Promise<YoutubeApi>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;

    /* El script llama a esta global. Se respeta la que hubiera: puede ser de
       otro reproductor de la misma página (TradTube, por ejemplo). */
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      const api = readyApi();
      if (api) resolve(api);
      else reject(new Error('YouTube IFrame API loaded without YT.Player'));
    };

    const script = document.createElement('script');
    script.src = API_SRC;
    script.async = true;
    script.addEventListener('error', () => reject(new Error('YouTube IFrame API failed to load')));
    document.head.append(script);
  }).catch((error: unknown) => {
    // Un fallo de red no es definitivo: el siguiente intento vuelve a pedirlo.
    apiPromise = null;
    throw error;
  });

  return apiPromise;
}

/** Solo para pruebas: olvida la carga (el script del DOM no se toca). */
export function resetYoutubeApiForTests(): void {
  apiPromise = null;
}
