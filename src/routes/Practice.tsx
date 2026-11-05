import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
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
  readPlan,
  readPrefs,
  recordRecentList,
  todayKeyFor,
  writePlan,
  writePrefs,
  type KeyValueStore,
  type PracticePlan,
  type PracticePrefs,
} from '../lib/practice-storage';
import {
  addSessionMarks,
  createSessionWithMarks,
  fetchSessionMarks,
  unmarkSessionTune,
} from '../lib/practice';
import PlayTrigger from '../components/PlayTrigger';
import './repertoire.css';
import './practice.css';

/**
 * Lista de ensayo (#36).
 *
 * Es una **cola de trabajo**, no una rejilla de cartas: filas a lo ancho, una
 * debajo de otra, con la posición a la izquierda. La pantalla se pinta sobre el
 * mismo papel que la home (`repertoire-home` trae las variables) y no sobre la
 * paleta oscura del resto de la app.
 *
 * La lista es una **caché inmutable que solo el usuario revoca**:
 *   · Si no hay lista guardada, se genera una y se queda. Recargar, ir a The
 *     Session y volver, cerrar el navegador: la lista sigue siendo la misma,
 *     con sus marcas. No hay «lista de hoy» que caduque a medianoche.
 *   · **New list** es la única acción que la sustituye: borra la guardada y
 *     genera otra sin marcas. El objetivo diario solo decide el tamaño de la
 *     **próxima** lista; cambiarlo no toca la actual.
 *   · La lista lleva **su** sesión (`sessionId` en la caché). La primera marca
 *     la abre y la deja escrita ahí mismo, así que una recarga posterior lee las
 *     marcas de esa sesión y no de «la última sesión abierta de hoy». Esa
 *     heurística era el bug: repartía las marcas en sesiones de una línea y solo
 *     se veía la última.
 *   · Desmarcar es **una sola operación** de la capa de datos: borra la línea y
 *     recalcula `last_practiced_at`. Aquí no se puede olvidar la segunda mitad.
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
  /** La lista viva, con la sesión que le pertenece. `null` mientras carga. */
  const [plan, setPlan] = createSignal<PracticePlan | null>(null);
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
   * «New list» es destructivo —la lista actual no se puede recuperar—, así que
   * pide dos pulsaciones: la primera arma, la segunda sustituye. Un clic suelto
   * a mitad de sesión no se lleva por delante la cola.
   */
  const [armed, setArmed] = createSignal(false);
  let disarmTimer: ReturnType<typeof setTimeout> | undefined;

  const listIds = () => plan()?.ids ?? [];
  const overflow = () => plan()?.overflow ?? 0;
  /** Instante de referencia de la lista: el suyo, no el del montaje. */
  const planAt = () => plan()?.createdAt ?? nowMs;
  /** Las filas de la lista, en el orden guardado (no el del generador). */
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

  const generatedLabel = createMemo(() =>
    new Date(planAt()).toLocaleString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }),
  );

  /**
   * Genera una lista nueva para un objetivo concreto.
   *
   * La semilla es el **instante de generación**, no la fecha: así dos listas
   * pedidas el mismo día salen distintas, que es lo que espera quien pulsa «New
   * list» dos veces. `excludeIds` es la penalización ×0,5 de D3: lo que salió en
   * las últimas listas —y en la que se acaba de tirar— no vuelve a salir.
   */
  const buildPlan = (
    source: readonly RepertoireRow[],
    dailyTarget: number,
    excludeIds: ReadonlySet<string>,
    createdAt: number,
  ): PracticePlan => {
    const built = buildPracticeList(toCandidates(source), {
      seed: hashSeed(session.session()?.user.id ?? '', String(createdAt)),
      nowMs: createdAt,
      dailyTarget,
      recentIds: excludeIds,
    });
    const ids = rowsByIds(
      source,
      built.entries.map((entry) => entry.candidate.id),
    ).map((row) => row.id);
    return { createdAt, ids, overflow: built.overflow, sessionId: null };
  };

  /**
   * Guarda la lista **y la deja en el histórico**. Sin el histórico la
   * penalización ×0,5 de D3 no tiene de dónde leer, y la anti-repetición no llega
   * a existir. `recordRecentList` deduplica por fecha, así que regenerar hoy
   * reemplaza la entrada de hoy en vez de duplicarla.
   */
  const persistPlan = (next: PracticePlan) => {
    tryPersist(() => {
      writePlan(storage(), next);
      recordRecentList(storage(), { date: todayKeyFor(next.createdAt), ids: [...next.ids] });
    });
  };

  /**
   * Deja escrita la sesión en cuanto la primera marca la abre. Es lo que hace
   * que una recarga posterior sepa de qué sesión leer las marcas: sin esto se
   * volvería a «la última sesión abierta de hoy», que es justo el bug.
   */
  const attachSession = (id: string) => {
    const current = plan();
    if (!current || current.sessionId === id) return;
    const next: PracticePlan = { ...current, sessionId: id };
    setPlan(next);
    tryPersist(() => writePlan(storage(), next));
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

      // 1. La lista guardada manda: no caduca con la fecha ni se regenera al
      //    recargar. Si sus tunes ya no están en el repertorio, no sirve.
      const stored = readPlan(storage(), nowMs);
      let current = stored && rowsByIds(loaded, stored.ids).length > 0 ? stored : null;

      // 2. Sin lista utilizable se genera y se guarda. Es la única generación
      //    automática: a partir de aquí, solo «New list» la sustituye.
      if (!current) {
        const fresh = buildPlan(
          loaded,
          storedPrefs.dailyTarget,
          previousIds(storage(), dateKey),
          nowMs,
        );
        persistPlan(fresh);
        current = fresh;
      }
      setPlan(current);

      // 3. Las marcas son las de la sesión **de esta lista**, por id.
      setSessionId(null);
      setMarked(new Set<string>());
      const openSessionId = current.sessionId;
      if (!openSessionId) return; // sin primera marca no hay sesión que leer

      setSessionId(openSessionId);
      try {
        setMarked(new Set(await fetchSessionMarks(openSessionId)));
      } catch (marksError) {
        // La sesión existe pero sus marcas no se pudieron leer. Se avisa y se
        // sigue: marcar volverá a colgar de la misma sesión.
        setNotice(messageOf(marksError));
      }
    } catch (loadError) {
      setError(messageOf(loadError));
    } finally {
      setLoading(false);
    }
  };

  onMount(() => void load());
  onCleanup(() => disarmNewList());

  // ── objetivo diario ───────────────────────────────────────────────

  /**
   * El objetivo ya **no** reconstruye la lista: la lista es inmutable. Solo
   * queda guardado y decide el tamaño de la próxima que se pida con «New list».
   */
  const shiftTarget = (delta: number) => {
    const current = prefs().dailyTarget;
    const next = Math.min(DAILY_TARGET_MAX, Math.max(DAILY_TARGET_MIN, current + delta));
    if (next === current) return;

    const updated: PracticePrefs = { ...prefs(), dailyTarget: next };
    setPrefs(updated);
    tryPersist(() => writePrefs(storage(), updated));
  };

  // ── revocar la lista ──────────────────────────────────────────────

  const disarmNewList = () => {
    setArmed(false);
    if (disarmTimer !== undefined) {
      clearTimeout(disarmTimer);
      disarmTimer = undefined;
    }
  };

  /**
   * «New list»: borra la lista guardada y genera otra **sin marcas**. Es la
   * única salida de la caché, y por eso pide dos pulsaciones: la primera arma y
   * se desarma sola a los cinco segundos.
   */
  const requestNewList = () => {
    if (!armed()) {
      setArmed(true);
      disarmTimer = setTimeout(() => {
        disarmTimer = undefined;
        setArmed(false);
      }, 5000);
      return;
    }
    disarmNewList();

    const createdAt = Date.now();
    const current = plan();
    // La lista que se tira tampoco vuelve a salir: a la penalización de las
    // últimas fechas se le suman sus propios ids.
    const exclude = new Set([
      ...previousIds(storage(), todayKeyFor(createdAt)),
      ...(current?.ids ?? []),
    ]);
    const fresh = buildPlan(rows(), prefs().dailyTarget, exclude, createdAt);

    persistPlan(fresh);
    setPlan(fresh);
    setSessionId(null);
    setMarked(new Set<string>());
    setNotice(null);
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
        const created = await createSessionWithMarks([{ repertoireId: row.id, position }]);
        setSessionId(created);
        attachSession(created);
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
        const created = await createSessionWithMarks(pending);
        setSessionId(created);
        attachSession(created);
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
          <h1>Practice list</h1>
          <p class="sub">
            <Show when={!loading() && plan()} fallback="Loading…">
              Generated {generatedLabel()} · <b>{tuneCountLabel(listIds().length)}</b> ·{' '}
              {markedInList()} marked
            </Show>
          </p>
        </div>

        <div class="head-tools practice-tools">
          <div class="practice-target" role="group" aria-label="Daily target for the next list">
            <button
              type="button"
              class="practice-target__step"
              aria-label="Decrease daily target"
              onClick={() => shiftTarget(-1)}
            >
              −
            </button>
            <span class="practice-target__value" title="Decides the size of the next list">
              {prefs().dailyTarget}
            </span>
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
          <button
            type="button"
            class="add add--quiet"
            title="Clear this list and generate a new one without marks"
            onClick={() => requestNewList()}
          >
            {armed() ? 'Replace this list?' : 'New list'}
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

        <ol class="practice-list">
          <For each={listRows()}>
            {(row, index) => {
              const days = () => stalenessDays(row, planAt());
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
                    {/* Un solo disparador (#49): la barra por fila se retiró. */}
                    <PlayTrigger row={row} />
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

                </li>
              );
            }}
          </For>
        </ol>

        {/* La lista no se refresca sola: con todo marcado se dice dónde está la salida. */}
        <Show when={listRows().length > 0 && markedInList() === listRows().length}>
          <p class="practice-done">
            All {tuneCountLabel(listRows().length)} marked. This list stays as it is — press{' '}
            <b>New list</b> when you want the next one.
          </p>
        </Show>

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
