import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { A } from '@solidjs/router';
import { useSession } from '../lib/session';
import {
  STATUS_LABELS,
  cardKey,
  displayRhythm,
  displayTitle,
  fetchRepertoire,
  saveFavorite,
  stalenessColor,
  stalenessDays,
  stalenessTag,
  stalenessTitle,
  type RepertoireRow,
} from '../lib/repertoire';
import {
  FAVORITE_SATURATION_THRESHOLD,
  buildPracticeList,
  favoriteSaturation,
  hashSeed,
  rowsByIds,
  toCandidates,
} from '../lib/practice-plan';
import {
  DAILY_TARGET_MAX,
  DAILY_TARGET_MIN,
  DEFAULT_PREFS,
  previousIds,
  readPrefs,
  readTodayList,
  recordRecentList,
  startOfLocalDay,
  todayKeyFor,
  writePrefs,
  writeTodayList,
  type KeyValueStore,
  type PracticePrefs,
} from '../lib/practice-storage';
import {
  addSessionMarks,
  createSessionWithMarks,
  findTodaySession,
  unmarkSessionTune,
} from '../lib/practice';
import { fetchSegments, type TuneSegment } from '../lib/tradtube';
import { PracticeVideo } from '../components/PracticeVideo';
import { PracticePlayer } from '../components/PracticePlayer';
import './repertoire.css';
import './practice.css';

/**
 * Lista de ensayo del día (#36).
 *
 * Es una **cola de trabajo**, no una rejilla de cartas: filas a lo ancho, una
 * debajo de otra, con la posición a la izquierda. La pantalla se pinta sobre el
 * mismo papel que la home (`repertoire-home` trae las variables) y no sobre la
 * paleta oscura del resto de la app.
 *
 * Cuatro reglas mandan sobre el resto:
 *   · La lista se **congela** en `tt-practice-today` al montar. Sin congelarla,
 *     marcar movería `last_practiced_at` y al recargar el generador devolvería
 *     otra lista: el criterio «no cambia al recargar» sería falso.
 *   · La **sesión es perezosa**: abrir la lista no crea nada. La primera marca
 *     abre la sesión del día y las siguientes se cuelgan de ella; si ya había
 *     una abierta hoy, se reanuda.
 *   · Desmarcar es **una sola operación** de la capa de datos: borra la línea y
 *     recalcula `last_practiced_at`. Aquí no se puede olvidar la segunda mitad.
 *   · El **objetivo diario** es la única acción que reconstruye y vuelve a
 *     congelar la lista: una decisión explícita del usuario manda sobre la
 *     congelación. Las marcas de la sesión no se tocan.
 */

/** El almacenamiento del navegador, tal y como lo pide `practice-storage`. */
function storage(): KeyValueStore {
  return window.localStorage;
}

/**
 * Una escritura en el almacenamiento no puede tumbar la pantalla: en modo
 * privado o con la cuota llena la lista vive solo en memoria y se sigue
 * pudiendo ensayar.
 */
function tryPersist(write: () => void): void {
  try {
    write();
  } catch {
    /* almacenamiento bloqueado: la lista del día no se congela, y ya está */
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** «1 tune» / «12 tunes». */
function tuneCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'tune' : 'tunes'}`;
}

export default function Practice() {
  const session = useSession();

  /**
   * El instante se captura **una vez**: el día, la semilla y el tag de abandono
   * salen del mismo reloj. Si cambiara a mitad de sesión, la lista congelada y
   * la fecha de la cabecera podrían hablar de días distintos.
   */
  const nowMs = Date.now();
  const dateKey = todayKeyFor(nowMs);

  const [rows, setRows] = createSignal<RepertoireRow[]>([]);
  const [listIds, setListIds] = createSignal<string[]>([]);
  const [overflow, setOverflow] = createSignal(0);
  const [prefs, setPrefs] = createSignal<PracticePrefs>(DEFAULT_PREFS);
  const [sessionId, setSessionId] = createSignal<string | null>(null);
  const [marked, setMarked] = createSignal<ReadonlySet<string>>(new Set<string>());
  /**
   * Capa optimista por encima de las filas (id → favorita). Las filas **no** se
   * reemplazan al tocar el corazón: si cambiara su identidad, `<For>` volvería a
   * crear la fila entera y el foco se perdería en mitad de la cola.
   */
  const [favorites, setFavorites] = createSignal<Record<string, boolean>>({});
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  /** Una escritura en vuelo: evita que un doble toque abra dos sesiones. */
  const [busy, setBusy] = createSignal(false);
  /**
   * Vídeos de la lista (#37): **una sola petición** para todas las tunes, con
   * caché en memoria por sesión. Un fallo de TradTube no es un fallo de la
   * lista: se avisa en una línea y se ensaya igual.
   */
  const [segments, setSegments] = createSignal<ReadonlyMap<string, TuneSegment[]>>(new Map());
  const [videosDown, setVideosDown] = createSignal(false);

  /** Las filas de la lista, en el orden congelado (no el del generador). */
  const listRows = createMemo(() => rowsByIds(rows(), listIds()));

  const markedInList = createMemo(() => {
    const set = marked();
    let count = 0;
    for (const row of listRows()) if (set.has(row.id)) count += 1;
    return count;
  });

  const isFavorite = (row: RepertoireRow): boolean => favorites()[row.id] ?? row.favorite;

  const saturation = createMemo(() =>
    favoriteSaturation(rows().map((row) => ({ ...row, favorite: isFavorite(row) }))),
  );

  const dateLabel = createMemo(() =>
    new Date(nowMs).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
  );

  /**
   * Genera la lista del día para un objetivo concreto. `nowMs` y la semilla son
   * los del montaje: misma fecha, misma semilla, misma lista.
   */
  const generate = (source: readonly RepertoireRow[], dailyTarget: number) => {
    const built = buildPracticeList(toCandidates(source), {
      seed: hashSeed(session.session()?.user.id ?? '', dateKey),
      nowMs,
      dailyTarget,
      recentIds: previousIds(storage(), dateKey),
    });
    const ids = rowsByIds(
      source,
      built.entries.map((entry) => entry.candidate.id),
    ).map((row) => row.id);
    return { ids, overflow: built.overflow };
  };

  const loadSegments = async (ids: readonly string[], source: readonly RepertoireRow[]) => {
    const refs = rowsByIds(source, ids)
      .map((row) => row.tune?.origin_ref)
      .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);
    if (refs.length === 0) return;
    try {
      setSegments(await fetchSegments(refs));
      setVideosDown(false);
    } catch {
      setVideosDown(true);
    }
  };

  const segmentsFor = (row: RepertoireRow): readonly TuneSegment[] =>
    segments().get(row.tune?.origin_ref ?? '') ?? [];

  /**
   * Congela la lista del día **y la deja en el histórico**. Sin el histórico la
   * penalización ×0,5 de D3 —la tune que salió ayer no vuelve a salir hoy— no
   * tiene de dónde leer, y la anti-repetición no llega a existir: la penalización
   * siempre vería un conjunto vacío. `recordRecentList` deduplica por fecha, así
   * que re-congelar hoy reemplaza la entrada de hoy en vez de duplicarla.
   */
  const freezeToday = (ids: readonly string[], overflowNow: number) => {
    tryPersist(() => {
      writeTodayList(storage(), dateKey, ids, overflowNow);
      recordRecentList(storage(), { date: dateKey, ids: [...ids] });
    });
  };

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      // Una sola carga: `fetchRepertoire` ya trae los agregados en paralelo.
      const loaded = await fetchRepertoire();
      setRows(loaded);
      // La capa optimista se vacía en cada carga: manda lo que dice la base.
      setFavorites({});

      const storedPrefs = readPrefs(storage());
      setPrefs(storedPrefs);

      // 1. La lista congelada manda. Si existe, se materializa tal cual.
      const frozen = readTodayList(storage(), dateKey);
      let ids = frozen ? rowsByIds(loaded, frozen.ids).map((row) => row.id) : [];
      let overflowNow = frozen?.overflow ?? 0;

      // 2. Sin lista utilizable se genera y se congela.
      if (ids.length === 0) {
        const built = generate(loaded, storedPrefs.dailyTarget);
        ids = built.ids;
        overflowNow = built.overflow;
        freezeToday(ids, overflowNow);
      }

      setListIds(ids);
      setOverflow(overflowNow);
      void loadSegments(ids, loaded);

      // 3. La sesión no se crea: solo se busca la de hoy, si la hay.
      const today = await findTodaySession(startOfLocalDay(nowMs));
      if (today) {
        setSessionId(today.sessionId);
        setMarked(new Set(today.markedIds));
      }
    } catch (loadError) {
      setError(messageOf(loadError));
    } finally {
      setLoading(false);
    }
  };

  onMount(() => void load());

  // ── objetivo diario ───────────────────────────────────────────────

  const shiftTarget = (delta: number) => {
    const current = prefs().dailyTarget;
    const next = Math.min(DAILY_TARGET_MAX, Math.max(DAILY_TARGET_MIN, current + delta));
    if (next === current) return;

    const updated: PracticePrefs = { ...prefs(), dailyTarget: next };
    setPrefs(updated);
    tryPersist(() => writePrefs(storage(), updated));

    // Acción explícita del usuario: reconstruye y re-congela. Las marcas no se tocan.
    const built = generate(rows(), next);
    setListIds(built.ids);
    setOverflow(built.overflow);
    freezeToday(built.ids, built.overflow);
    void loadSegments(built.ids, rows());
  };

  // ── marcas ────────────────────────────────────────────────────────

  const addMark = (id: string) => setMarked((previous) => new Set([...previous, id]));

  const dropMark = (id: string) =>
    setMarked((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });

  /**
   * Marca una fila. Sin sesión, la primera marca la **crea**; con sesión, la
   * cuelga de la que ya está abierta.
   */
  const markOne = async (row: RepertoireRow, position: number) => {
    if (busy() || marked().has(row.id)) return;

    setBusy(true);
    setNotice(null);
    try {
      const openSession = sessionId();
      if (openSession) {
        await addSessionMarks(openSession, [{ repertoireId: row.id, position }]);
      } else {
        setSessionId(await createSessionWithMarks([{ repertoireId: row.id, position }]));
      }
      addMark(row.id);
    } catch (markError) {
      setNotice(messageOf(markError));
    } finally {
      setBusy(false);
    }
  };

  /**
   * «Mark all»: una sola tanda con **las que faltan** respecto de la sesión. Con
   * todo marcado no escribe nada, así que pulsarlo dos veces no duplica nada.
   */
  const markAll = async () => {
    if (busy()) return;

    const already = marked();
    const pending = listRows()
      .map((row, position) => ({ repertoireId: row.id, position }))
      .filter((mark) => !already.has(mark.repertoireId));

    if (pending.length === 0) return;

    setBusy(true);
    setNotice(null);
    try {
      const openSession = sessionId();
      if (openSession) {
        await addSessionMarks(openSession, pending);
      } else {
        setSessionId(await createSessionWithMarks(pending));
      }
      setMarked((previous) => new Set([...previous, ...pending.map((mark) => mark.repertoireId)]));
    } catch (markError) {
      setNotice(messageOf(markError));
    } finally {
      setBusy(false);
    }
  };

  const unmarkOne = async (row: RepertoireRow) => {
    const openSession = sessionId();
    if (!openSession || !marked().has(row.id)) return;

    setNotice(null);
    try {
      // Borra la línea y recalcula `last_practiced_at`: una sola operación.
      await unmarkSessionTune(openSession, row.id);
      dropMark(row.id);
    } catch (unmarkError) {
      setNotice(messageOf(unmarkError));
    }
  };

  // ── favorita ──────────────────────────────────────────────────────

  const setFavorite = (id: string, value: boolean) =>
    setFavorites((previous) => ({ ...previous, [id]: value }));

  const toggleFavorite = async (row: RepertoireRow) => {
    const current = isFavorite(row);
    const next = !current;
    // Optimista: el corazón responde al toque; si el guardado falla, se revierte
    // y se dice, porque una favorita fantasma envenenaría el ×1,4 del generador.
    setFavorite(row.id, next);
    setNotice(null);

    try {
      await saveFavorite(row.id, next);
    } catch (favoriteError) {
      setFavorite(row.id, current);
      setNotice(messageOf(favoriteError));
    }
  };

  return (
    <div class="repertoire-home practice">
      <header class="page-head">
        <div>
          <h1>Today's practice</h1>
          <p class="sub">
            {dateLabel()} ·{' '}
            <Show when={!loading()} fallback="Loading…">
              <b>{tuneCountLabel(listIds().length)}</b> · {markedInList()} marked
            </Show>
          </p>
        </div>

        <div class="head-tools practice-tools">
          <div class="practice-target" role="group" aria-label="Daily target">
            <button
              type="button"
              class="practice-target__step"
              aria-label="Decrease daily target"
              onClick={() => shiftTarget(-1)}
            >
              −
            </button>
            <span class="practice-target__value">{prefs().dailyTarget}</span>
            <button
              type="button"
              class="practice-target__step"
              aria-label="Increase daily target"
              onClick={() => shiftTarget(1)}
            >
              +
            </button>
          </div>
          <button type="button" class="add" onClick={() => void markAll()}>
            Mark all
          </button>
        </div>
      </header>

      <Show when={notice()}>
        <p class="practice-notice" role="alert">
          {notice()}
        </p>
      </Show>

      <Show when={error()}>
        <div class="practice-state">
          <p>{error()}</p>
          <button type="button" class="practice-retry" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </Show>

      <Show when={!error() && loading()}>
        <p class="practice-state">Loading today's list…</p>
      </Show>

      <Show when={!error() && !loading() && rows().length === 0}>
        <p class="practice-state">
          Nothing to practice yet. <A href="/">Add some tunes</A> and come back.
        </p>
      </Show>

      <Show when={!error() && !loading() && rows().length > 0}>
        {/* La cifra viene congelada con la lista: no se recalcula al marcar. */}
        <Show when={overflow() > 0}>
          <p class="practice-overflow">
            {overflow() + listIds().length} overdue, {listIds().length} in the list — the rest stays
            for tomorrow.
          </p>
        </Show>

        <Show when={videosDown()}>
          <p class="practice-media-hint">Videos are unavailable right now — you can still practise.</p>
        </Show>

        <ol class="practice-list">
          <For each={listRows()}>
            {(row, index) => {
              const days = () => stalenessDays(row, nowMs);
              const tag = () => stalenessTag(days());
              const color = () => stalenessColor(days());
              const key = () => cardKey(row);

              return (
                <li class="practice-row" classList={{ 'is-marked': marked().has(row.id) }}>
                  <span class="practice-row__pos">{index() + 1}</span>

                  <div class="practice-row__main">
                    <A class="practice-row__title" href={`/repertoire/${row.id}`}>
                      {displayTitle(row)}
                    </A>
                    <p class="practice-row__meta">
                      {displayRhythm(row)}
                      <Show when={key()}>
                        {(value) => <> · {value()}</>}
                      </Show>{' '}
                      · {STATUS_LABELS[row.status]}
                    </p>
                  </div>

                  {/* La razón por la que la tune está en la lista: mismo gradiente que la home. */}
                  <span
                    class="practice-row__stale"
                    style={{ background: color().background, color: color().foreground }}
                    title={stalenessTitle(tag())}
                  >
                    {tag().value}
                    <Show when={tag().unit}>{(unit) => <> {unit()}</>}</Show>
                  </span>

                  <div class="practice-row__actions">
                    <button
                      type="button"
                      class="practice-row__fav"
                      aria-pressed={isFavorite(row) ? 'true' : 'false'}
                      aria-label={
                        isFavorite(row)
                          ? `Remove ${displayTitle(row)} from favourites`
                          : `Add ${displayTitle(row)} to favourites`
                      }
                      onClick={() => void toggleFavorite(row)}
                    >
                      <span aria-hidden="true">{isFavorite(row) ? '♥' : '♡'}</span>
                    </button>

                    <button
                      type="button"
                      class="practice-row__mark"
                      classList={{ 'is-marked': marked().has(row.id) }}
                      aria-label={
                        marked().has(row.id)
                          ? `Unmark ${displayTitle(row)}`
                          : `Mark ${displayTitle(row)}`
                      }
                      onClick={() =>
                        marked().has(row.id) ? void unmarkOne(row) : void markOne(row, index())
                      }
                    >
                      {marked().has(row.id) ? 'Marked ✓' : 'Mark'}
                    </button>
                  </div>

                  {/* Piezas opt-in de la fila: nada suena ni carga solo. */}
                  <div class="practice-row__media">
                    <PracticeVideo segments={segmentsFor(row)} />
                    <PracticePlayer row={row} />
                  </div>
                </li>
              );
            }}
          </For>
        </ol>

        <Show when={saturation().overThreshold}>
          <p class="practice-saturation">
            {saturation().favoriteCount} of {saturation().activeCount} tunes are favourites — over{' '}
            {Math.round(FAVORITE_SATURATION_THRESHOLD * 100)}% the ×1.4 bonus stops telling them
            apart.
          </p>
        </Show>
      </Show>
    </div>
  );
}
