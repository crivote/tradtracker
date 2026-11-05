/**
 * El reproductor de vídeo del dock (#53): **velocidad propia en % y control
 * desde el mismo ▶/❚❚ de la barra**.
 *
 * Lo puro —escalones, rótulos en %, el estado que llega de YouTube— se prueba
 * sin navegador (`video-player.test.ts`). Lo que monta el reproductor es una
 * capa fina sobre la IFrame API (`youtube-api.ts`) y se prueba con un doble en
 * la suite del dock: en `jsdom` no hay YouTube.
 *
 * **La escalera la manda el reproductor, no una constante.** YouTube sirve
 * velocidades discretas (`0.25 · 0.5 · 0.75 · 1 · 1.25 · 1.5 · 1.75 · 2`) y
 * `setPlaybackRate` las cuantiza: pedir «85 %» no da 85 %. Por eso el control
 * propio es un recorrido de escalones rotulados en %, no un deslizador que
 * prometería un número que el vídeo no va a cumplir. `getAvailablePlaybackRates()`
 * es la fuente; la constante es solo la red cuando el player no contesta.
 *
 * El dominio del iframe **no cambia**: se monta con `youtube-nocookie.com`.
 * La API (el script) viene de `youtube.com`, que es lo que impone YouTube.
 */

import { embedUrl, type TuneSegment } from './tradtube';
import { loadYoutubeApi, type YoutubePlayerLike } from './youtube-api';

/** Los escalones de referencia, en tanto por uno. */
export const VIDEO_RATES: readonly number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** Arranque natural: el vídeo como suena. */
export const DEFAULT_VIDEO_RATE = 1;

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
  destroy(): void;
}

export interface MountedVideoPlayer {
  handle: VideoPlayerHandle;
  /** Los escalones que el reproductor declara, ya normalizados. */
  rates: readonly number[];
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

/** `0.75` → `75%`. Un rótulo, no una medida: los escalones son discretos. */
export function rateLabel(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * Una escalera utilizable: números finitos y positivos, sin repetir, de menor a
 * mayor. Si lo que llega no sirve, la de referencia — nunca una vacía, porque
 * el `+`/`−` se quedaría sin destino.
 */
export function usableRates(rates?: readonly number[] | null): readonly number[] {
  const source = rates && rates.length > 0 ? rates : VIDEO_RATES;
  const clean = source.filter((rate) => Number.isFinite(rate) && rate > 0);
  const unique = [...new Set(clean)].sort((a, b) => a - b);
  return unique.length > 0 ? unique : VIDEO_RATES;
}

/** El escalón más cercano: la velocidad guardada puede no existir en este player. */
export function nearestRate(rate: number, rates?: readonly number[] | null): number {
  const ladder = usableRates(rates);
  const target = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_VIDEO_RATE;
  return ladder.reduce(
    (best, candidate) => (Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best),
    ladder[0]
  );
}

/** El escalón siguiente (`delta > 0`) o anterior, acotado en los dos extremos. */
export function stepRate(rate: number, delta: number, rates?: readonly number[] | null): number {
  const ladder = usableRates(rates);
  const index = ladder.indexOf(nearestRate(rate, ladder));
  const motion = delta === 0 ? 0 : delta > 0 ? 1 : -1;
  const next = Math.min(ladder.length - 1, Math.max(0, index + motion));
  return ladder[next];
}

/** ¿Queda escalón en esa dirección? Es lo que deshabilita el botón en los extremos. */
export function canStepRate(rate: number, delta: number, rates?: readonly number[] | null): boolean {
  return stepRate(rate, delta, rates) !== nearestRate(rate, rates);
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
    destroy: () => player.destroy(),
  };
}

/**
 * Monta el reproductor sobre `host` y resuelve **cuando está listo**, con sus
 * escalones de velocidad. Rechaza si la API no carga o si no dice «listo» a
 * tiempo: el dock lo trata como «sin control» y deja el iframe plano.
 */
export function mountVideoPlayer(options: MountVideoPlayerOptions): Promise<MountedVideoPlayer> {
  return loadYoutubeApi().then(
    (api) =>
      new Promise<MountedVideoPlayer>((resolve, reject) => {
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
                resolve({
                  handle: wrapPlayer(event.target),
                  rates: usableRates(event.target.getAvailablePlaybackRates()),
                });
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
