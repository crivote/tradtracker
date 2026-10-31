/**
 * El reproductor ABC mínimo (#38): tempo por ritmo y pausa del loop.
 *
 * Módulo **puro**: sin DOM, sin red y sin `abcjs`. Todo lo que el componente
 * necesita decidir antes de tocar un `AudioContext` se decide aquí, para que la
 * aritmética del tempo y el contrato de los números se prueben sin navegador.
 *
 * Los tempos son los del diseño (§2.3 del plan de F6): **tempo de ensayo**, no
 * de concierto. Reel y hornpipe comparten 84, jig y slip jig 108, slide y polka
 * 120, y el air va a 60 —un air se toca lento y sin prisa, que es justo lo que
 * se está entrenando—.
 */

/**
 * Tempo de partida por ritmo, en pulsos por minuto. Las claves van en
 * minúsculas y con un solo espacio entre palabras: la comparación pasa por
 * `tempoFor`, que normaliza antes de buscar, así que «Slip Jig», «slip  jig» y
 * «SLIP JIG» caen en la misma entrada.
 */
export const TEMPO_BY_RHYTHM: Readonly<Record<string, number>> = {
  reel: 84,
  hornpipe: 84,
  jig: 108,
  'slip jig': 108,
  slide: 120,
  polka: 120,
  air: 60,
};

/** El tempo de un ritmo que no está en la tabla (o de ninguno). */
export const DEFAULT_TEMPO = 84;

/** Suelo del tempo: por debajo, el metrónomo deja de ser un tempo de ensayo. */
export const MIN_TEMPO = 40;

/** Techo del tempo: por encima, el sintetizador suena a cinta acelerada. */
export const MAX_TEMPO = 200;

/** Paso de los botones −/+. Cuatro pulsos se oyen sin pulsar veinte veces. */
export const TEMPO_STEP = 4;

/** La pausa entre vueltas del loop: un compás de aire para volver a entrar. */
export const LOOP_GAP_MS = 1000;

/**
 * Dónde viven los samples (decisión D7: se versionan con la app, no se piden a
 * un CDN de terceros). **Tiene que terminar en `/`**: `abcjs` concatena
 * `soundFontUrl + instrumento + '-mp3/' + nota + '.mp3'`.
 */
export const SOUNDFONT_URL = '/soundfonts/';

/**
 * Clave de búsqueda de un ritmo: minúsculas, sin espacios de sobra y con los
 * espacios internos colapsados. `null`, vacío o basura caen en `''`, que no
 * está en la tabla y por tanto devuelve el tempo por defecto.
 */
function rhythmKey(rhythm: string | null): string {
  return (rhythm ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * El tempo de partida de un ritmo. Desconocido y `null` van al mismo sitio
 * (`DEFAULT_TEMPO`): el reproductor nunca se queda sin tempo, y adivinar el de
 * un ritmo que no está en la tabla sería inventar el dato.
 */
export function tempoFor(rhythm: string | null): number {
  return TEMPO_BY_RHYTHM[rhythmKey(rhythm)] ?? DEFAULT_TEMPO;
}

/**
 * Redondea y acota a `[MIN_TEMPO, MAX_TEMPO]`. Un valor no finito (`NaN`,
 * `Infinity`) no es un tempo: cae a `DEFAULT_TEMPO` en vez de propagarse hasta
 * el sintetizador, que dividiría por cero.
 */
export function clampTempo(bpm: number): number {
  if (!Number.isFinite(bpm)) return DEFAULT_TEMPO;
  return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Math.round(bpm)));
}
