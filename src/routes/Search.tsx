import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import {
  fetchRepertoire,
  rhythmOptions,
  searchRepertoire,
  type RepertoireRow,
} from '../lib/repertoire';
import { logPractice } from '../lib/practice';
import TuneCard from '../components/TuneCard';
import './repertoire.css';

/**
 * Vista de búsqueda del repertorio (#9).
 *
 * Es una superficie propia, no un filtro de la home: la home ya no busca y su
 * hueco de búsqueda es una puerta a esta ruta. Tres reglas mandan sobre el resto:
 *
 *   · **Arranca vacía.** Sin texto y sin ritmo no se pinta ninguna carta, solo
 *     la línea de ayuda: el repertorio entero no es una respuesta a nada.
 *   · **Cruza todos los peldaños**, aparcadas incluidas, y el orden es
 *     alfabético por título mostrado —es una consulta, no una cola de trabajo—.
 *   · **El filtrado es del modelo puro** (`searchRepertoire`, `rhythmOptions`):
 *     aquí solo se guardan las dos señales y se pinta. No hay red por pulsación;
 *     `fetchRepertoire()` se llama una vez al montar y otra al apuntar un ensayo.
 *
 * El estilo vive en `repertoire.css` dentro del ámbito `.repertoire-home`: esta
 * pantalla se pinta sobre el mismo papel que la home.
 */
export default function Search() {
  /** El instante de la vista: todas las cartas hablan del mismo «hoy». */
  const [now, setNow] = createSignal(Date.now());

  const [rows, setRows] = createSignal<RepertoireRow[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  /**
   * Los dos criterios viven en señales locales, sin `?q=` ni `?rhythm=`: recargar
   * deja la vista vacía, que es literalmente su estado por defecto. `rhythm` es
   * `null` para «todos» —no la cadena vacía, que podría ser un ritmo real—.
   */
  const [term, setTerm] = createSignal('');
  const [rhythm, setRhythm] = createSignal<string | null>(null);

  const results = createMemo(() => searchRepertoire(rows(), term(), rhythm()));
  const options = createMemo(() => rhythmOptions(rows()));
  /** Con algún criterio hay consulta; sin ninguno, la vista está en reposo. */
  const searching = createMemo(() => term().trim().length > 0 || rhythm() !== null);

  /** Recuento de la consulta, o la frase del «no» cuando no casa nada. */
  const countLabel = createMemo(() => {
    const count = results().length;
    if (count === 0) return 'No tune matches that search.';
    return count === 1 ? '1 tune matches' : `${count} tunes match`;
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchRepertoire());
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Recarga silenciosa tras apuntar un ensayo: no vuelve a poner `loading` para
   * que las cartas no parpadeen con el menú recién cerrado, igual que la home.
   */
  const reload = async () => {
    try {
      setRows(await fetchRepertoire());
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  /**
   * «Practise» del kebab: mismo gesto que en la home —apunta el ensayo de un
   * clic, sin puntuarlo— y misma recarga. La calidad se puntúa en el detalle.
   */
  const practise = async (row: RepertoireRow) => {
    setError(null);
    try {
      await logPractice(row.id, { quality: null, comment: null });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  onMount(() => {
    void load();
  });

  return (
    <div class="repertoire-home">
      <header class="page-head">
        <div>
          <h1>Search</h1>
          <p class="sub">
            Every level, shelved tunes included — a title, a rhythm, or both.
          </p>
        </div>
      </header>

      <div class="search-bar">
        <label class="search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder="Search by title"
            aria-label="Search tunes by title"
            autocomplete="off"
            autofocus
            value={term()}
            onInput={(event) => setTerm(event.currentTarget.value)}
          />
        </label>
        {/* El «todos» es una opción más del selector: elegir un ritmo sin texto
            ya es criterio suficiente para listar esa familia entera. */}
        <label class="rhythm-pick">
          <span class="lbl">Rhythm</span>
          <select
            aria-label="Filter by rhythm"
            value={rhythm() ?? ''}
            onChange={(event) => setRhythm(event.currentTarget.value || null)}
          >
            <option value="">All rhythms</option>
            <For each={options()}>{(option) => <option value={option}>{option}</option>}</For>
          </select>
        </label>
      </div>

      <Show when={error()}>
        <p class="notice notice-error" role="alert">
          {error()}
        </p>
      </Show>

      <Show when={!loading()} fallback={<p class="notice">Loading your repertoire…</p>}>
        <Show
          when={searching()}
          fallback={
            <p class="notice">Type a title — or pick a rhythm to narrow it down.</p>
          }
        >
          <div class="search-results">
            {/* Sin tope: todos los que casen, con su recuento encima. */}
            <p class="results-count">{countLabel()}</p>
            <Show when={results().length > 0}>
              <div class="grid-4">
                <For each={results()}>
                  {(row) => (
                    <TuneCard
                      row={row}
                      now={now()}
                      showLevel
                      onPractise={practise}
                    />
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}
