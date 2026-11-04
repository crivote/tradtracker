import { createSignal } from 'solid-js';
import { abcFromRow, resolveAbc } from './abc-source';
import { LOOP_GAP_MS, TEMPO_STEP, clampTempo, tempoFor } from './abc-player';
import {
  ABORTED,
  renderScore,
  startEngine,
  stopEngine,
} from './player-engine';
import {
  INSTRUMENT_LABELS,
  INSTRUMENT_PROGRAM,
  canPlay,
  dockReserve,
  metaParts,
  statusText,
  type DockMeta,
  type DockState,
} from './player-model';
import {
  DEFAULT_PREFS,
  INSTRUMENTS,
  readPrefs,
  writePrefs,
  type KeyValueStore,
  type PracticeInstrument,
} from './practice-storage';
import { cardKey, displayRhythm, displayTitle, type RepertoireRow } from './repertoire-model';
import { fetchSegments, type TuneSegment } from './tradtube';

/**
 * El estado del reproductor flotante (#49), **uno solo para toda la app**.
 *
 * Vive en el módulo, no en una vista: es lo que permite que la música siga
 * sonando al navegar de la home a la ficha. El `<PlayerDock>` del layout solo
 * pinta; toda la política —qué tune, qué estado, qué tempo, cuándo se para—
 * está aquí.
 *
 * **Cerrar no es pausar.** `pause()` deja la tune cargada y el ▶ listo;
 * `close()` sube el token, para el motor, cancela el loop, olvida la tune y
 * desmonta el vídeo. Después de cerrar, el siguiente disparador empieza de cero.
 *
 * El `sink` es el blanco donde `abcjs` dibuja el `TuneObject` que necesita el
 * sintetizador. Lo pone el dock al montarse (y vive tanto como el layout): aquí
 * solo se guarda la referencia, porque crear el DOM no es asunto del store.
 */

const [state, setState] = createSignal<DockState>('closed');
const [track, setTrack] = createSignal<RepertoireRow | null>(null);
const [segments, setSegments] = createSignal<readonly TuneSegment[]>([]);
const [panelOpen, setPanelOpen] = createSignal(false);
const [videoOpen, setVideoOpen] = createSignal(false);
const [scoreOpen, setScoreOpen] = createSignal(false);
const [tempo, setTempo] = createSignal(tempoFor(null));
const [instrument, setInstrument] = createSignal<PracticeInstrument>(storedInstrument());
const [looping, setLooping] = createSignal(false);
const [durationSec, setDurationSec] = createSignal<number | null>(null);

/** El ABC ya resuelto de la tune cargada; la red solo se toca si la fila no lo traía. */
let abcText: string | null = null;
/** El blanco de `renderAbc`. Lo pone el dock. */
let sink: HTMLElement | null = null;
/** El temporizador del loop. `null` = no hay vuelta pendiente. */
let loopTimer: number | null = null;
/** Token de la operación en vuelo: un `resolveAbc` lento no puede reabrir un dock cerrado. */
let token = 0;

/** El almacén del navegador, o `null` si no está (modo privado). */
function browserStore(): KeyValueStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** El instrumento guardado, con la preferencia por defecto como red. */
function storedInstrument(): PracticeInstrument {
  const store = browserStore();
  if (!store) return DEFAULT_PREFS.instrument;
  try {
    return readPrefs(store).instrument;
  } catch {
    return DEFAULT_PREFS.instrument;
  }
}

const clearLoop = () => {
  if (loopTimer === null) return;
  window.clearTimeout(loopTimer);
  loopTimer = null;
};

/**
 * El final de una vuelta. Con loop, espera `LOOP_GAP_MS` y vuelve a arrancar —
 * y el temporizador se cancela al parar, o la tune volvería a sonar un segundo
 * después de haberla parado, que es el fallo clásico.
 */
function onTuneEnded(): void {
  if (state() !== 'playing') return;
  if (!looping()) {
    // Parar el motor al terminar: si no, el `synth` sigue vivo y el siguiente
    // ▶ lo reutilizaría sin volver a montarlo con el tempo actual.
    stopEngine();
    setState('idle');
    return;
  }
  loopTimer = window.setTimeout(() => {
    loopTimer = null;
    if (state() !== 'playing') return;
    setState('idle');
    void play();
  }, LOOP_GAP_MS);
}

/** El ABC de la tune cargada, resolviendo la red la primera vez. */
async function ensureAbc(): Promise<string | null> {
  if (abcText) return abcText;
  const row = track();
  if (!row) return null;
  abcText = await resolveAbc(row);
  return abcText;
}

/** Arranca o para según el estado. Es el ▶ del dock y el de los disparadores. */
export async function play(): Promise<void> {
  if (state() === 'playing') {
    pause();
    return;
  }
  if (!canPlay(state())) return;

  const row = track();
  if (!row || !sink) return;

  const mine = ++token;
  setState('loading');
  try {
    const abc = await ensureAbc();
    if (mine !== token) return;
    if (!abc) {
      setState('no-abc');
      return;
    }
    const result = await startEngine({
      abc,
      sink,
      qpm: tempo(),
      program: INSTRUMENT_PROGRAM[instrument()],
      onEnded: onTuneEnded,
    });
    if (mine !== token || result === ABORTED) return;
    if (result.result === 'ok') {
      setDurationSec(result.durationSec);
      setState('playing');
      return;
    }
    setState(result.result);
  } catch {
    stopEngine();
    setState('failed');
  }
}

/** Para sin cerrar: la tune sigue cargada y el ▶ vuelve a arrancar donde toca. */
export function pause(): void {
  stopEngine();
  clearLoop();
  setState('idle');
}

/**
 * El disparador ubicuo: carta, fila de tabla, ficha y lista de ensayo.
 *
 * Sobre la misma tune que ya está en el dock, alterna (es el gesto natural:
 * pulsar ▶ otra vez para). Sobre otra, para lo que hubiera y empieza de cero,
 * en `idle` y con el tempo del ritmo de esa tune.
 */
export function openFrom(row: RepertoireRow): void {
  if (track()?.id === row.id && state() !== 'closed') {
    void play();
    return;
  }

  token += 1;
  stopEngine();
  clearLoop();

  abcText = null;
  setTrack(row);
  setSegments([]);
  setVideoOpen(false);
  setScoreOpen(false);
  setPanelOpen(false);
  setLooping(false);
  setDurationSec(null);
  setTempo(tempoFor(displayRhythm(row)));
  setState('idle');

  void loadSegments(row);
  void play();
}

/** Cerrar de verdad: para, desmonta el vídeo, olvida la tune y oculta el dock. */
export function close(): void {
  token += 1;
  stopEngine();
  clearLoop();
  abcText = null;
  setTrack(null);
  setSegments([]);
  setState('closed');
  setVideoOpen(false);
  setScoreOpen(false);
  setPanelOpen(false);
  setLooping(false);
  setDurationSec(null);
}

/**
 * Los segmentos de TradTube de la tune, **cuando se abre**, no al montar la
 * pantalla: una petición por tune abierta (el adaptador cachea por sesión) en
 * vez de una por lista. Sin segmento, el control de vídeo no se pinta.
 */
async function loadSegments(row: RepertoireRow): Promise<void> {
  const ref = row.tune?.origin_ref;
  if (!ref) return;
  try {
    const map = await fetchSegments([ref]);
    if (track()?.id !== row.id) return;
    setSegments(map.get(ref) ?? []);
  } catch {
    // TradTube caído no es un fallo del reproductor: se sigue sin vídeo.
    if (track()?.id === row.id) setSegments([]);
  }
}

/**
 * El vídeo y el sintetizador **nunca suenan a la vez**. Abrir el vídeo para el
 * motor (y deja el dock en `idle`, no en `playing`: lo que suena es el iframe).
 */
export function openVideo(): void {
  if (segments().length === 0) return;
  stopEngine();
  clearLoop();
  setState('idle');
  setVideoOpen(true);
}

/** Cerrar el vídeo **no** cierra el dock: deja la bandeja y la tune. */
export function closeVideo(): void {
  setVideoOpen(false);
}

export function togglePanel(): void {
  setPanelOpen((open) => !open);
}

/** El tempo se fija al montar el motor: para que el cambio se oiga hay que volver a montarlo. */
export function shiftTempo(delta: number): void {
  const next = clampTempo(tempo() + delta);
  if (next === tempo()) return;
  setTempo(next);
  if (state() === 'playing' || state() === 'loading') void restart();
}

export function cycleInstrument(): void {
  const list = INSTRUMENTS;
  const next = list[(list.indexOf(instrument()) + 1) % list.length];
  setInstrument(next);

  const store = browserStore();
  if (store) {
    try {
      // La preferencia es global, no por tune: se conserva el objetivo diario.
      writePrefs(store, { ...readPrefs(store), instrument: next });
    } catch {
      /* almacenamiento bloqueado: el selector funciona, solo no recuerda */
    }
  }

  if (state() === 'playing' || state() === 'loading') void restart();
}

/** Vuelve a montar el motor con el tempo o el instrumento actuales. */
async function restart(): Promise<void> {
  const abc = abcText;
  if (!abc) return;
  const mine = ++token;
  setState('loading');
  try {
    const result = await startEngine({
      abc,
      sink: sink!,
      qpm: tempo(),
      program: INSTRUMENT_PROGRAM[instrument()],
      onEnded: onTuneEnded,
    });
    if (mine !== token || result === ABORTED) return;
    if (result.result === 'ok') {
      setDurationSec(result.durationSec);
      setState('playing');
      return;
    }
    setState(result.result);
  } catch {
    stopEngine();
    setState('failed');
  }
}

export function toggleLoop(): void {
  const next = !looping();
  setLooping(next);
  if (next) return;
  // Sin loop no hay vuelta pendiente: cancelarla es lo que evita que la tune
  // vuelva a sonar sola después de haberlo apagado.
  if (loopTimer !== null) {
    clearLoop();
    setState('idle');
  }
}

export function toggleScore(): void {
  setScoreOpen((open) => !open);
}

/** La partitura se dibuja al desplegarla, nunca antes. */
export async function paintScore(host: HTMLElement): Promise<void> {
  const abc = await ensureAbc();
  if (!abc) {
    setState('no-abc');
    return;
  }
  const painted = await renderScore(host, abc);
  if (!painted) setState('failed');
}

/** El dock guarda el blanco de `renderAbc`; lo llama el componente al montarse. */
export function setSink(element: HTMLElement | null): void {
  sink = element;
}

/* ── Lectura ───────────────────────────────────────────────────────────── */

export const dockState = state;
export const currentTrack = track;
export const currentSegments = segments;
export const isPanelOpen = panelOpen;
export const isVideoOpen = videoOpen;
export const isScoreOpen = scoreOpen;
export const currentTempo = tempo;
export const currentInstrument = instrument;
export const isLooping = looping;
export const currentDuration = durationSec;
export const currentStatus = () => statusText(state());
export const currentPlayable = () => canPlay(state());
export const reserve = () => dockReserve(state(), panelOpen());

/** «Play <tune>» / «Pause <tune>» / «Loading <tune>». */
export function playLabel(): string {
  const row = track();
  const title = row ? displayTitle(row) : '';
  if (state() === 'playing') return `Pause ${title}`;
  if (state() === 'loading') return `Loading ${title}`;
  return `Play ${title}`;
}

/** La línea de metadatos del dock: ritmo, tonalidad, procedencia, instrumento, duración. */
export function metaLine(): string[] {
  const row = track();
  if (!row) return [];
  const meta: DockMeta = {
    rhythm: displayRhythm(row),
    key: cardKey(row),
    source: videoOpen() ? 'TradTube' : state() === 'no-abc' ? null : 'ABC',
    instrument: INSTRUMENT_LABELS[instrument()],
    durationSec: durationSec(),
  };
  return metaParts(meta);
}

/** El `title` del dock, con la canción ya resuelta. */
export const currentTitle = () => {
  const row = track();
  return row ? displayTitle(row) : '';
};

/** La etiqueta del instrumento activo, sin repetir el mapa en el componente. */
export const currentInstrumentLabel = () => INSTRUMENT_LABELS[instrument()];

/** Solo para pruebas: deja el módulo como recién cargado. */
export function resetPlayerForTests(): void {
  close();
  setInstrument(DEFAULT_PREFS.instrument);
  setTempo(tempoFor(null));
}
