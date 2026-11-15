/**
 * El reproductor de vídeo del dock (#53): **velocidad propia en % y control
 * desde el mismo ▶/❚❚ de la barra**.
 *
 * Lo puro —el escalón, el rótulo en %, el estado que llega de YouTube— se prueba
 * sin navegador (`video-player.test.ts`). Lo que monta el reproductor es una
 * capa fina sobre la IFrame API (`youtube-api.ts`) y se prueba con un doble en
 * la suite del dock: en `jsdom` no hay YouTube.
 *
 * **La velocidad se mueve en pasos del 5 % (#59), no en la escalera de
 * YouTube.** Hasta este corte el control recorría `getAvailablePlaybackRates()`
 * —ocho peldaños, y de 75 % a 100 % había un salto de 25 puntos—, que es
 * demasiado grueso para ensayar: el paso útil para bajar un reel es pequeño.
 * Ahora el dominio es continuo entre `MIN` y `MAX` y el mando pide el valor
 * exacto; el rótulo se corrige con lo que el reproductor confirma por
 * `onPlaybackRateChange`, así que si YouTube cuantiza, la pantalla lo dice en
 * vez de mentir.
 *
 * El dominio es el de TradTube —0,50 a 1,00, el mismo control que el dueño usa
 * a diario—: aquí se ralentiza para aprender, no se acelera para escuchar.
 *
 * El dominio del iframe **no cambia**: se monta con `youtube-nocookie.com`.
 * La API (el script) viene de `youtube.com`, que es lo que impone YouTube.
 */

import { embedUrl, type TuneSegment } from './tradtube';
import { loadYoutubeApi, type YoutubePlayerLike } from './youtube-api';

/** Suelo de la velocidad: por debajo, el vídeo deja de ser un tempo de ensayo. */
export const VIDEO_RATE_MIN = 0.5;

/** Techo: 100 %, el vídeo como suena. */
export const VIDEO_RATE_MAX = 1;

/** El paso del mando: 5 % (una veinteava parte del rango). */
export const VIDEO_RATE_STEP = 0.05;

/** Arranque natural: el vídeo como suena. */
export const DEFAULT_VIDEO_RATE = VIDEO_RATE_MAX;

/** El dominio sin cookies del reproductor: el mismo que usaba el iframe plano. */
const NOCOOKIE_HOST = 'https://www.youtube-nocookie.com';

/**
 * Lo que se espera a que el player diga «listo». Si no lo dice —script
 * bloqueado, red caída, vídeo que no carga—, el dock degrada a iframe plano en
 * vez de quedarse en `loading` para siempre.
 */
export const VIDEO_READY_TIMEOUT_MS = 10_000;

/** El estado de YouTube, ya traducido a lo que entiende el dock. */
export type VideoEvent = 'playing' | 'paused' | 'ended' | 'buffering' | 'unstarted';

export interface VideoPlayerHandle {
  play(): void;
  pause(): void;
  setRate(rate: number): void;
  /** Salta a un segundo del vídeo (no del tune): el «inicio del tune» lo calcula el store. */
  seek(sec: number): void;
  destroy(): void;
}

export interface MountVideoPlayerOptions {
  /** El nodo que YouTube sustituye por su iframe. */
  host: HTMLElement;
  segment: TuneSegment;
  onState: (event: VideoEvent) => void;
  /** Velocidad cambiada desde los controles nativos de YouTube. */
  onRate: (rate: number) => void;
  /** El vídeo no se puede reproducir (borrado, privado, sin permiso). */
  onError: (code: number) => void;
}

// ── puro ────────────────────────────────────────────────────────────

/** `0.75` → `75%`. Un rótulo, no una medida: los pasos son discretos. */
export function rateLabel(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * Un valor del dominio: redondeado al 1 % (los pasos son del 5, pero YouTube
 * puede devolver `0.8500000000000001`) y acotado en los dos extremos. Un número
 * que no sirve cae al 100 %, que es el arranque natural.
 */
export function clampRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return DEFAULT_VIDEO_RATE;
  const rounded = Math.round(rate * 100) / 100;
  return Math.min(VIDEO_RATE_MAX, Math.max(VIDEO_RATE_MIN, rounded));
}

/** El paso siguiente (`delta > 0`) o anterior, acotado en los dos extremos. */
export function stepRate(rate: number, delta: number): number {
  const current = clampRate(rate);
  if (delta === 0) return current;
  const motion = delta > 0 ? 1 : -1;
  // Se redondea a 2 decimales en cada paso: sumar 0,05 veinte veces acumula
  // error de coma flotante y el rótulo acabaría enseñando `84%`.
  const next = Math.round((current + motion * VIDEO_RATE_STEP) * 100) / 100;
  return clampRate(next);
}

/** ¿Queda paso en esa dirección? Es lo que deshabilita el botón en los extremos. */
export function canStepRate(rate: number, delta: number): boolean {
  return stepRate(rate, delta) !== clampRate(rate);
}

/** `1` → `playing`, `2` → `paused`… Los números son los de `YT.PlayerState`. */
export function videoEventFromState(state: number): VideoEvent {
  if (state === 1) return 'playing';
  if (state === 2) return 'paused';
  if (state === 0) return 'ended';
  if (state === 3) return 'buffering';
  return 'unstarted';
}

/** La URL del iframe plano del «sin control»: la de siempre, sin `enablejsapi`. */
export function fallbackEmbedUrl(segment: TuneSegment): string {
  return `${embedUrl(segment)}&autoplay=1`;
}

// ── el reproductor ──────────────────────────────────────────────────

function wrapPlayer(player: YoutubePlayerLike): VideoPlayerHandle {
  return {
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    setRate: (rate) => player.setPlaybackRate(rate),
    /* `seekTo` con `allowSeekAhead` en `true`: sin él, YouTube se queda
       buffereando y el ▶ parece muerto unos segundos. */
    seek: (sec) => player.seekTo(Math.max(0, sec), true),
    destroy: () => player.destroy(),
  };
}

/**
 * Monta el reproductor sobre `host` y resuelve **cuando está listo**. Rechaza si
 * la API no carga o si no dice «listo» a tiempo: el dock lo trata como «sin
 * control» y deja el iframe plano.
 */
export function mountVideoPlayer(options: MountVideoPlayerOptions): Promise<VideoPlayerHandle> {
  return loadYoutubeApi().then(
    (api) =>
      new Promise<VideoPlayerHandle>((resolve, reject) => {
        let settled = false;
        let player: YoutubePlayerLike | null = null;

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            player?.destroy();
          } catch {
            /* el player nunca llegó a nacer */
          }
          reject(new Error('YouTube player did not become ready'));
        }, VIDEO_READY_TIMEOUT_MS);

        const playerVars: Record<string, string | number> = {
          autoplay: 1,
          playsinline: 1,
          rel: 0,
          /* La API exige el origen del padre para el `postMessage`; sin él, las
             órdenes se ignoran en silencio. */
          origin: window.location.origin,
        };
        const start = Math.max(0, Math.floor(options.segment.startSec));
        playerVars.start = start;
        // `end` se OMITE cuando el segmento no declara fin: `end=null` lo rompe.
        if (options.segment.endSec !== null && Number.isFinite(options.segment.endSec)) {
          playerVars.end = Math.max(start, Math.floor(options.segment.endSec));
        }

        try {
          player = new api.Player(options.host, {
            videoId: options.segment.youtubeId,
            host: NOCOOKIE_HOST,
            width: '100%',
            height: '100%',
            playerVars,
            events: {
              onReady: (event) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(wrapPlayer(event.target));
              },
              onStateChange: (event) => options.onState(videoEventFromState(event.data)),
              onPlaybackRateChange: (event) => options.onRate(event.data),
              onError: (event) => options.onError(event.data),
            },
          });
        } catch (error) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      })
  );
}
