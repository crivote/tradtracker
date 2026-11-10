import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { A } from '@solidjs/router';
import {
  BACKLOG_SCOPE,
  bandFor,
  backlogCount,
  displayTitle,
  dwellDays,
  invariantsText,
  learningSlots,
  workbenchRows,
  type RepertoireRow,
} from '../lib/repertoire';
import { LEARNING_SLOTS_MAX, LEARNING_SLOTS_MIN, readPrefs, writePrefs } from '../lib/practice-storage';
import { createRepertoireStore } from '../lib/repertoire-store';
import PlayTrigger from '../components/PlayTrigger';
import AddTuneAside from '../components/AddTuneAside';
import './repertoire.css';
import './learning.css';

/**
 * El banco de trabajo (#52), ahora con pantalla propia.
 *
 * `learning` no es un peldaño de biblioteca: no se mira «qué puedo tocar esta
 * noche» sino «qué se ha movido». Compartía pantalla con las cartas de los otros
 * niveles y pagaba dos cosas: su lista —con otro reloj, el dwell— se leía como
 * una banda más, y compartía cabecera con unas cifras que no son las suyas. Aquí
 * la pregunta de la pantalla es una sola.
 *
 * Tres reglas del diseño que se conservan tal cual:
 *   · La fila es una **lista**, no una carta: la foto es una mnemotecnia para la
 *     sesión, y una tune que no se pasa entera no se toca en sesión, se trabaja.
 *   · El orden es el **dwell** descendente —la más atascada primero—, no el
 *     abandono.
 *   · Las salidas son explícitas: promocionar a `shaky` o devolver al backlog,
 *     porque el tope solo sirve si sacar una cuesta un clic.
 *
 * Lo que añade el corte: **un disparador de reproducción por fila**. Trabajar una
 * tune es escucharla y probarla; sin el botón, el gesto más frecuente de la
 * pantalla exigía pasar por la ficha.
 */
export default function Learning() {
  const store = createRepertoireStore();
  const [addOpen, setAddOpen] = createSignal(false);

  /** El tope vive en las preferencias del navegador, junto al objetivo diario. */
  const [limit, setLimit] = createSignal(readPrefs(window.localStorage).learningSlots);
  const slots = createMemo(() => learningSlots(store.rows(), limit()));
  const bench = createMemo(() => workbenchRows(store.rows(), store.now()));
  const backlogTotal = createMemo(() => backlogCount(store.rows()));
  const band = bandFor('learning');

  const ownedRefs = createMemo(
    () =>
      new Set(
        store
          .rows()
          .filter((row) => row.tune.origin === 'thesession' && row.tune.origin_ref)
          .map((row) => row.tune.origin_ref!)
      )
  );

  /**
   * Bajar el tope por debajo de lo que ya hay **no mueve filas**: la cabecera
   * avisa de cuánto sobra y el dueño decide cuál sale.
   */
  const shiftSlots = (delta: number) => {
    const next = Math.min(LEARNING_SLOTS_MAX, Math.max(LEARNING_SLOTS_MIN, limit() + delta));
    if (next === limit()) return;
    setLimit(next);
    try {
      writePrefs(window.localStorage, { ...readPrefs(window.localStorage), learningSlots: next });
    } catch {
      /* almacenamiento bloqueado: el cambio vale para esta visita */
    }
  };

  /** Días en el peldaño, en palabras. Sin fecha no se inventa un cero. */
  const dwellText = (row: RepertoireRow): string => {
    const days = dwellDays(row, store.now());
    if (days === null) return '—';
    if (days === 0) return 'today';
    return days === 1 ? '1 day' : `${days} days`;
  };

  onMount(() => void store.load());

  return (
    <div class="repertoire-home learning">
      <header class="page-head">
        <div>
          <h1>Learning</h1>
          <p class="sub">
            {band.definition}{' '}
            <span class="sub-sep">·</span>{' '}
            <A class="shelved-link" href={`/level/${BACKLOG_SCOPE}`}>
              {backlogTotal()} to learn
            </A>
          </p>
        </div>

        <div class="head-tools">
          {/* El tope se ajusta donde el número se entiende sin explicación. En
              `/practice` sería un segundo número suelto al lado del objetivo. */}
          <div class="wb-slots" role="group" aria-label="Learning slots">
            <button type="button" aria-label="Fewer learning slots" onClick={() => shiftSlots(-1)}>
              −
            </button>
            <span class="count" classList={{ 'count--over': slots().over > 0 }}>
              {slots().used} of {slots().limit} slots
              <Show when={slots().over > 0}> · over by {slots().over}</Show>
            </span>
            <button type="button" aria-label="More learning slots" onClick={() => shiftSlots(1)}>
              +
            </button>
          </div>
          <button type="button" class="add" onClick={() => setAddOpen(true)}>
            Add a tune
          </button>
        </div>
      </header>

      <Show when={store.error()}>
        <p class="notice notice-error" role="alert">
          {store.error()}
        </p>
      </Show>

      <Show when={!store.loading()} fallback={<p class="notice">Loading your workbench…</p>}>
        <Show
          when={bench().length > 0}
          fallback={
            <p class="band-empty">
              Nothing in the workbench. Pick one from the{' '}
              <A href={`/level/${BACKLOG_SCOPE}`}>backlog</A> to start learning it.
            </p>
          }
        >
          <ul class="workbench">
            <For each={bench()}>
              {(row) => (
                <li>
                  <div class="wb-title">
                    {/* El gesto más frecuente de la pantalla (#49): trabajar una
                        tune es escucharla y probarla. Sin este botón había que
                        pasar por la ficha para oírla. */}
                    <PlayTrigger row={row} />
                    <div class="wb-name">
                      <A href={`/repertoire/${row.id}`}>{displayTitle(row)}</A>
                      <Show when={invariantsText(row)}>
                        <small>{invariantsText(row)}</small>
                      </Show>
                    </div>
                  </div>
                  <span class="wb-cell">
                    <b>{dwellText(row)}</b>
                    <small>in learning</small>
                  </span>
                  <span class="wb-cell">
                    <b>{row.practice_count ?? 0}</b>
                    <small>{(row.practice_count ?? 0) === 1 ? 'practice' : 'practices'}</small>
                  </span>
                  <span class="wb-actions">
                    <button
                      type="button"
                      disabled={store.busyId() === row.id}
                      onClick={() => void store.practise(row)}
                    >
                      Practise
                    </button>
                    <button type="button" onClick={() => void store.changeStatus(row, 'shaky')}>
                      To shaky
                    </button>
                    <button type="button" onClick={() => void store.changeStatus(row, 'to_learn')}>
                      Back to backlog
                    </button>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>

      <Show when={addOpen()}>
        <AddTuneAside
          existingRefs={ownedRefs()}
          slots={slots()}
          onAdded={store.reload}
          onClose={() => setAddOpen(false)}
        />
      </Show>
    </div>
  );
}
