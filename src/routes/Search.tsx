import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import {
  alphabeticalRows,
  fetchRepertoire,
  rhythmOptions,
  searchRepertoire,
  type RepertoireRow,
} from '../lib/repertoire';
import {
  facetTree,
  filterBySelectedTags,
  type Tag,
  type TagFacetInfo,
} from '../lib/tags';
import { fetchTuneTags, loadVocabulary, type TagVocabulary } from '../lib/tags-db';
import { logPractice } from '../lib/practice';
import TuneCard from '../components/TuneCard';
import './repertoire.css';

/** Una fila de `pr_user_tune_tags`: la etiqueta cuelga de la tune, no del repertorio. */
type TagAssignment = { tune_id: string; tag_id: number };

/**
 * Vista de búsqueda del repertorio (#9; facetas en #48).
 *
 * Es una superficie propia, no un filtro de la home: la home ya no busca y su
 * hueco de búsqueda es una puerta a esta ruta. Tres reglas mandan sobre el resto:
 *
 *   · **Arranca vacía.** Sin texto, sin ritmo y sin etiquetas no se pinta ninguna
 *     carta, solo la línea de ayuda: el repertorio entero no es una respuesta a
 *     nada.
 *   · **Cruza todos los peldaños**, aparcadas incluidas, y el orden es
 *     alfabético por título mostrado —es una consulta, no una cola de trabajo—.
 *   · **El filtrado es del modelo puro** (`searchRepertoire`, `rhythmOptions`,
 *     `filterBySelectedTags`): aquí solo se guardan las señales y se pinta. No
 *     hay red por pulsación; `fetchRepertoire()` se llama una vez al montar y
 *     otra al apuntar un ensayo, y las etiquetas —vocabulario y asignaciones—
 *     **una sola vez al montar, para todas las filas**.
 *
 * El estilo vive en `repertoire.css` dentro del ámbito `.repertoire-home`: esta
 * pantalla se pinta sobre el mismo papel que la home, panel de etiquetas incluido.
 */
export default function Search() {
  /** El instante de la vista: todas las cartas hablan del mismo «hoy». */
  const [now, setNow] = createSignal(Date.now());

  const [rows, setRows] = createSignal<RepertoireRow[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  /**
   * Los criterios viven en señales locales, sin `?q=`, `?rhythm=` ni `?tags=`:
   * recargar deja la vista vacía, que es literalmente su estado por defecto.
   * `rhythm` es `null` para «todos» —no la cadena vacía, que podría ser un ritmo
   * real— y `selected` son ids del vocabulario, no valores.
   */
  const [term, setTerm] = createSignal('');
  const [rhythm, setRhythm] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<number[]>([]);
  const [panelOpen, setPanelOpen] = createSignal(false);

  /**
   * Vocabulario y asignaciones. El vocabulario es común y lo cachea el adaptador
   * por sesión de navegador (`loadVocabulary`); las asignaciones se piden de una
   * vez con los ids de todas las filas, nunca una consulta por carta.
   */
  const [vocabulary, setVocabulary] = createSignal<TagVocabulary | null>(null);
  const [assignments, setAssignments] = createSignal<TagAssignment[]>([]);

  const options = createMemo(() => rhythmOptions(rows()));

  /**
   * La base de la consulta. Con texto o ritmo es `searchRepertoire`; sin ninguno
   * de los dos, y solo si hay etiquetas, el repertorio entero en el mismo orden
   * alfabético: una etiqueta sola **es** una consulta, y `searchRepertoire`
   * devuelve `[]` en reposo a propósito.
   */
  const base = createMemo(() => {
    if (term().trim().length === 0 && rhythm() === null) {
      return selected().length > 0 ? alphabeticalRows(rows()) : [];
    }
    return searchRepertoire(rows(), term(), rhythm());
  });

  /**
   * El árbol listo para pintar, o `null` si no hay vocabulario. Sin facetas y sin
   * etiquetas el botón **no** se pinta: un «Tags» que abre un panel vacío es un
   * hueco que promete algo que no hay.
   */
  const tagGroups = createMemo(() => {
    const loaded = vocabulary();
    if (!loaded || loaded.facets.length === 0 || loaded.tags.length === 0) return null;
    const groups = facetTree(loaded.facets, loaded.tags);
    return groups.some((group) => group.nodes.length > 0) ? groups : null;
  });

  const results = createMemo(() =>
    filterBySelectedTags(
      base(),
      assignments(),
      selected(),
      vocabulary()?.tags ?? []
    )
  );

  /**
   * Con algún criterio hay consulta; sin ninguno, la vista está en reposo. Una
   * etiqueta sola ya es consulta: lista todo lo marcado con ella.
   */
  const searching = createMemo(
    () => term().trim().length > 0 || rhythm() !== null || selected().length > 0
  );

  /** Recuento de la consulta, o la frase del «no» cuando no casa nada. */
  const countLabel = createMemo(() => {
    const count = results().length;
    if (count === 0) return 'No tune matches that search.';
    return count === 1 ? '1 tune matches' : `${count} tunes match`;
  });

  /**
   * Dos etiquetas con el mismo texto en facetas distintas necesitan la faceta en
   * el nombre accesible; con texto único, el `aria-label` es solo la etiqueta.
   */
  const repeatedLabels = createMemo(() => {
    const counts = new Map<string, number>();
    for (const tag of vocabulary()?.tags ?? []) {
      counts.set(tag.label, (counts.get(tag.label) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, times]) => times > 1).map(([label]) => label));
  });

  const tagLabel = (tag: Tag, facet: TagFacetInfo) =>
    repeatedLabels().has(tag.label) ? `${facet.label}: ${tag.label}` : tag.label;

  const toggleTag = (tagId: number, checked: boolean) => {
    setSelected((previous) => {
      if (checked) return previous.includes(tagId) ? previous : [...previous, tagId];
      return previous.filter((id) => id !== tagId);
    });
  };

  const loadTags = async (loaded: RepertoireRow[]) => {
    try {
      setVocabulary(await loadVocabulary());
      if (loaded.length > 0) {
        setAssignments(await fetchTuneTags(loaded.map((row) => row.tune.id)));
      }
    } catch {
      // Sin etiquetas la búsqueda sigue funcionando como antes de F17: el botón
      // no se pinta y el resto de la vista no cambia. No es un error de la
      // consulta, así que no se le enseña al lector en el aviso rojo.
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await fetchRepertoire();
      setRows(loaded);
      setNow(Date.now());
      void loadTags(loaded);
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
            Every level, shelved tunes included — a title, a rhythm, or a tag.
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
        {/* Sin vocabulario no hay botón: no se pinta un hueco vacío. */}
        <Show when={tagGroups()}>
          <button
            type="button"
            class="tag-toggle"
            aria-expanded={panelOpen() ? 'true' : 'false'}
            aria-controls="tag-filter-panel"
            onClick={() => setPanelOpen((open) => !open)}
          >
            {selected().length > 0 ? `Tags · ${selected().length}` : 'Tags'}
          </button>
        </Show>
      </div>

      {/* El panel se pinta sobre papel, con las variables de `.repertoire-home`:
          hijos indentados bajo su raíz, una casilla por valor. */}
      <Show when={panelOpen() && tagGroups()}>
        {(groups) => (
          <div class="tag-panel" id="tag-filter-panel">
            <For each={groups()}>
              {(group) => (
                <div class="tag-facet">
                  <p class="facet-name">{group.facet.label}</p>
                  <For each={group.nodes}>
                    {(node) => (
                      <>
                        <label class="tag-check">
                          <input
                            type="checkbox"
                            aria-label={tagLabel(node.tag, group.facet)}
                            checked={selected().includes(node.tag.id)}
                            onChange={(event) => toggleTag(node.tag.id, event.currentTarget.checked)}
                          />
                          <span>{node.tag.label}</span>
                        </label>
                        <For each={node.children}>
                          {(child) => (
                            <label class="tag-check tag-check--child">
                              <input
                                type="checkbox"
                                aria-label={tagLabel(child, group.facet)}
                                checked={selected().includes(child.id)}
                                onChange={(event) => toggleTag(child.id, event.currentTarget.checked)}
                              />
                              <span>{child.label}</span>
                            </label>
                          )}
                        </For>
                      </>
                    )}
                  </For>
                </div>
              )}
            </For>
            <Show when={selected().length > 0}>
              <button type="button" class="tag-clear" onClick={() => setSelected([])}>
                Clear tags
              </button>
            </Show>
          </div>
        )}
      </Show>

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
