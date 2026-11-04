import type { TuneSegment } from './tradtube';
import type { PracticeInstrument } from './practice-storage';

/**
 * El estado del reproductor flotante (#49), en **puro**.
 *
 * Aquí no hay señales, ni DOM, ni `abcjs`: solo las decisiones que se pueden
 * probar sin navegador —qué dice la línea de metadatos, cuándo el ▶ está
 * disponible, cuánto relleno pide el cuerpo y qué segmento abre el vídeo—.
 * El store y el dock se limitan a consumir esto.
 *
 * La máquina de estados es corta a propósito:
 *
 * ```
 *   closed ──openFrom──▶ loading ──ok──▶ playing ──▶ idle
 *                          │                        │
 *                          ├─▶ no-abc               └─▶ (loop) playing
 *                          ├─▶ no-audio
 *                          └─▶ failed
 *   cualquiera ──✕ / Esc──▶ closed
 * ```
 *
 * **`closed` no es `idle`.** En `idle` la tune sigue cargada y el ▶ continúa;
 * en `closed` el motor está parado, el `<iframe>` desmontado y la tune
 * olvidada. Es la distinción que el ✕ tiene que respetar.
 */
export type DockState = 'closed' | 'idle' | 'loading' | 'playing' | 'no-abc' | 'no-audio' | 'failed';

/** Lo que se lee en la línea de metadatos cuando algo no se puede reproducir. */
export function statusText(state: DockState): string | null {
  if (state === 'no-abc') return 'no ABC';
  if (state === 'no-audio') return 'audio unavailable';
  if (state === 'failed') return 'could not play';
  return null;
}

/**
 * Un ▶ que se pueda pulsar. `loading` no: ya hay una petición en vuelo.
 * `no-abc` y `no-audio` tampoco: son «no» definitivos para esta tune.
 * `failed` sí, porque un fallo puede ser pasajero y reintentar es barato.
 */
export function canPlay(state: DockState): boolean {
  return state === 'idle' || state === 'playing' || state === 'failed';
}

/**
 * `m:ss`, y `h:mm:ss` solo si alguna vez hiciera falta. Un valor que no sea un
 * número positivo no es una duración: se omite antes que enseñar `NaN:NaN` o
 * un `0:00` que miente.
 */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** La procedencia del sonido que se está oyendo (o se podría oír). */
export type DockSource = 'ABC' | 'TradTube';

/**
 * Programa General MIDI de cada instrumento, **tal y como los nombra `abcjs`**:
 * su tabla `instrumentIndexToName` del paquete instalado llama `violin` al 40,
 * `recorder` al 74, `accordion` al 21 y `banjo` al 105. De ahí sale el nombre que
 * `abcjs` pega en la URL (`<instrumento>-mp3/<nota>.mp3`), así que este número
 * decide **qué carpeta de samples suena**.
 *
 * **`fiddle` (110) y `whistle` (78) no se usan a propósito.** Los dos parches de
 * FluidR3 son de orquesta —swell de cuerda y aire sin ataque— y con figuras de
 * 280 ms la nota se apaga antes de que la muestra hable. Se sirven `violin` y
 * `recorder` de MusyngKite, medidos: a 50 ms el violín está al 72 % de su
 * energía y el recorder al 92-100 % en todo el registro. El detalle y las
 * licencias, en `public/soundfonts/LICENSE.md`.
 */
export const INSTRUMENT_PROGRAM: Readonly<Record<PracticeInstrument, number>> = {
  fiddle: 40,
  whistle: 74,
  accordion: 21,
  banjo: 105,
};

/** Lo que se lee en el dock; las claves de las preferencias van en minúsculas. */
export const INSTRUMENT_LABELS: Readonly<Record<PracticeInstrument, string>> = {
  fiddle: 'Fiddle',
  whistle: 'Whistle',
  accordion: 'Accordion',
  banjo: 'Banjo',
};


/** Las piezas de la línea de metadatos, ya resueltas por quien tiene la fila. */
export interface DockMeta {
  rhythm: string | null;
  key: string | null;
  source: DockSource | null;
  instrument: string | null;
  durationSec: number | null;
}

/**
 * `Reel · D · ABC · Fiddle · 0:52`, sin huecos: lo que falte se omite, nunca se
 * rellena con un guion. El orden es el del diseño y no se reordena según qué
 * falte — la procedencia va siempre detrás de la tonalidad.
 */
export function metaParts(meta: DockMeta): string[] {
  const parts: string[] = [];
  if (meta.rhythm) parts.push(meta.rhythm);
  if (meta.key) parts.push(meta.key);
  if (meta.source) parts.push(meta.source);
  if (meta.instrument) parts.push(meta.instrument);
  const duration = formatDuration(meta.durationSec);
  if (duration) parts.push(duration);
  return parts;
}

/**
 * El segmento que abre el vídeo: el primero **disponible**. Una entrada caída
 * no debe tapar otra que sí se puede ver; si no hay ninguna disponible queda la
 * primera y el control sale deshabilitado (aquí las caídas se enseñan, a
 * diferencia del frontal de TradTube).
 */
export function pickSegment(segments: readonly TuneSegment[]): TuneSegment | null {
  return segments.find((segment) => !segment.unavailable) ?? segments[0] ?? null;
}

/**
 * «Hay control de vídeo» = hay algún segmento, aunque esté caído. Sin segmento
 * el control **no se pinta**; no se pinta deshabilitado, que es otra cosa.
 */
export function hasVideoControl(segments: readonly TuneSegment[]): boolean {
  return segments.length > 0;
}

/**
 * Relleno inferior que el cuerpo reserva para que el dock no tape el final del
 * contenido. Son las medidas del diseño: 190 px con la bandeja abierta y 90 px
 * con el dock en reposo. Cerrado no reserva nada — no hay nada que tapar.
 *
 * Las pantallas de papel ya traen sus propios 90 px, así que esto es la red
 * debajo: con el dock en reposo su suma sobra, y con la bandeja abierta es lo
 * que evita que la última carta quede debajo del vídeo.
 */
export function dockReserve(state: DockState, panelOpen: boolean): number {
  if (state === 'closed') return 0;
  return panelOpen ? 190 : 90;
}
