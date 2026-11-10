import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { A, Navigate, useParams } from '@solidjs/router';
import {
  BACKLOG_SCOPE,
  LEVEL_OPTIONS,
  RUNG_BARS,
  SHELVED_SCOPE,
  SORT_DEFAULT_DIRECTION,
  SORT_LABELS,
  STATUS_LABELS,
  addedAge,
  backlogCount,
  bandFor,
  displayTitle,
  learningSlots,
  levelText,
  parseScope,
  rowInvariants,
  rungOf,
  shelvedCount,
  sortRepertoire,
  stalenessColor,
  stalenessDays,
  stalenessTag,
  stalenessTitle,
  type RepertoireRow,
  type RepertoireScope,
  type SortDirection,
  type SortKey,
  type TuneStatus,
} from '../lib/repertoire';
import { readPrefs } from '../lib/practice-storage';
import { createRepertoireStore } from '../lib/repertoire-store';
import { facetTree } from '../lib/tags';
import { addTuneTags, loadVocabulary, type TagVocabulary } from '../lib/tags-db';
import PlayTrigger from '../components/PlayTrigger';
import TagPicker from '../components/TagPicker';
import './repertoire.css';

/**
 * El listado de un peldaño (`/level/:band`), con pantalla propia.
 *
 * Era la tabla que se encendía con un conmutador dentro de la home. El
 * conmutador hacía dos trabajos con un solo botón —mirar la escalera y recorrer
 * un peldaño entero— y el ámbito vivía en `?band=`, así que recargar compartía
 * una pantalla que era dos. Aquí la tabla es la pantalla, entra por URL
 * (`/level/shelved`, `/level/to_learn`, `/level/solo_ready`) y no hay estado
 * escondido que decidir.
 *
 * Sigue siendo superficie de **consulta** (boceto 014-b, #42): ocho columnas,
 * cabeceras que ordenan de verdad, el peldaño en un submenú de segundo nivel y
 * el borrado en la ficha. Las etiquetas en bloque (#48) viven aquí porque
 * necesitan filas que se puedan marcar, y las filas solo existen aquí.
 *
 * `learning` no tiene listado: tiene su banco de trabajo (`/learning`), con otro
 * reloj y otras salidas. Pedirlo por URL redirige, en vez de pintar dos veces la
 * misma lista con dos aspectos distintos.
 */
export default function LevelList() {
  const params = useParams<{ band: string }>();
  const store = createRepertoireStore();
  const scope = createMemo<RepertoireScope | null>(() => parseScope(params.band));
  /** `/level/all`: el repertorio entero en la tabla. No es un ámbito del modelo
   *  —`parseScope` sigue devolviendo `null`—, es la **ausencia** de ámbito. */
  const isAll = () => params.band === 'all';
  const known = () => isAll() || scope() !== null;

  const [sortKey, setSortKey] = createSignal<SortKey>('urgency');
  const [sortDirection, setSortDirection] = createSignal<SortDirection>(
    SORT_DEFAULT_DIRECTION.urgency
  );

  /** Clic en una cabecera: la misma columna invierte; una nueva entra por su
   *  sentido natural (números descendente, título ascendente). */
  const chooseSort = (key: SortKey) => {
    if (sortKey() === key) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection(SORT_DEFAULT_DIRECTION[key]);
  };

  /**
   * Un peldaño excluye las aparcadas —aparcar no cambia el peldaño, pero las
   * saca de rotación—, así que la lista cuadra con su recuento en la home; el
   * cajón hace lo contrario y solo trae las aparcadas.
   */
  const tableRows = createMemo(() => {
    const current = scope();
    let pool = store.rows();
    if (isAll()) pool = store.rows();
    else if (current === SHELVED_SCOPE) pool = pool.filter((row) => row.shelved);
    else if (current !== null)
      pool = pool.filter((row) => row.status === current && !row.shelved);
    return sortRepertoire(pool, sortKey(), sortDirection());
  });

  const limit = readPrefs(window.localStorage).learningSlots;
  const slots = createMemo(() => learningSlots(store.rows(), limit));

  /** Título del ámbito: el peldaño, el cajón, el backlog o el repertorio entero. */
  const scopeLabel = createMemo(() => {
    if (isAll()) return 'All tunes';
    const current = scope();
    if (current === null) return '';
    if (current === SHELVED_SCOPE) return 'Shelved';
    if (current === BACKLOG_SCOPE) return bandFor(BACKLOG_SCOPE).label;
    return bandFor(current).label;
  });

  const scopeDefinition = createMemo(() => {
    if (isAll()) return 'Everything in your repertoire — every level, the shelf included.';
    const current = scope();
    if (current === null) return '';
    if (current === SHELVED_SCOPE)
      return 'Out of rotation — kept, not practised. Nothing here is counted as active.';
    return bandFor(current).definition;
  });

  /**
   * Etiquetado en bloque (#48). La selección guarda ids de **fila**
   * (`pr_repertoire`), que es lo que la tabla pinta; a la RPC se le pasan los ids
   * de **tune** (`row.tune.id`). Confundirlos no falla al leer y sí al escribir
   * (23503), así que la traducción se hace en un solo sitio —`applyTags`— y nunca
   * se pasa una fila al adaptador.
   */
  const [selectedIds, setSelectedIds] = createSignal<string[]>([]);
  const [tagPanelOpen, setTagPanelOpen] = createSignal(false);
  const [draftTags, setDraftTags] = createSignal<number[]>([]);
  const [savingTags, setSavingTags] = createSignal(false);
  const [tagError, setTagError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [vocabulary, setVocabulary] = createSignal<TagVocabulary | null>(null);

  /**
   * La selección que cuenta es la que **se está pintando**: si el ámbito cambia
   * con filas marcadas, las que ya no se ven no viajan al «Apply» ni suman en
   * «N selected».
   */
  const listedSelection = createMemo(() => {
    const listed = new Set(tableRows().map((row) => row.id));
    return selectedIds().filter((id) => listed.has(id));
  });

  /** El árbol de casillas, o `null` sin vocabulario: no se pinta un panel vacío. */
  const tagGroups = createMemo(() => {
    const loaded = vocabulary();
    if (!loaded || loaded.facets.length === 0 || loaded.tags.length === 0) return null;
    const groups = facetTree(loaded.facets, loaded.tags);
    return groups.some((group) => group.nodes.length > 0) ? groups : null;
  });

  const toggleRowSelection = (row: RepertoireRow, next: boolean) => {
    setNotice(null);
    setSelectedIds((previous) =>
      next
        ? previous.includes(row.id)
          ? previous
          : [...previous, row.id]
        : previous.filter((id) => id !== row.id)
    );
  };

  const toggleAllListed = (next: boolean) => {
    setNotice(null);
    const listed = tableRows().map((row) => row.id);
    setSelectedIds((previous) =>
      next
        ? [...new Set([...previous, ...listed])]
        : previous.filter((id) => !listed.includes(id))
    );
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setDraftTags([]);
    setTagPanelOpen(false);
    setTagError(null);
  };

  const toggleDraftTag = (tagId: number, next: boolean) => {
    setDraftTags((previous) =>
      next
        ? previous.includes(tagId)
          ? previous
          : [...previous, tagId]
        : previous.filter((id) => id !== tagId)
    );
  };

  /**
   * Una sola llamada para N tunes × M etiquetas. Primero se traducen las filas
   * marcadas a `tune.id`; el adaptador nunca ve un id de repertorio. Si falla, la
   * selección **no** se limpia: el lector reintenta sin volver a marcar.
   */
  const applyTags = async () => {
    if (draftTags().length === 0) return;
    const marked = new Set(listedSelection());
    const tuneIds = store
      .rows()
      .filter((row) => marked.has(row.id))
      .map((row) => row.tune.id);
    if (tuneIds.length === 0) return;

    setSavingTags(true);
    setTagError(null);
    setNotice(null);
    try {
      await addTuneTags(tuneIds, draftTags());
      setNotice(`${tuneIds.length} ${tuneIds.length === 1 ? 'tune' : 'tunes'} tagged`);
      setSelectedIds([]);
      setDraftTags([]);
      setTagPanelOpen(false);
    } catch (cause) {
      setTagError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingTags(false);
    }
  };

  onMount(() => {
    void store.load();
    // El vocabulario es común y lo cachea el adaptador por sesión de navegador.
    void loadVocabulary().then((loaded) => setVocabulary(loaded));
  });

  return (
    <Show when={known()} fallback={<Navigate href="/" />}>
      <Show when={scope() !== 'learning'} fallback={<Navigate href="/learning" />}>
        <div class="repertoire-home level-list">
          <header class="page-head">
            <div>
              <h1>{scopeLabel()}</h1>
              <p class="sub">
                <Show when={!store.loading()} fallback="Loading…">
                  <b>{tableRows().length}</b>{' '}
                  {tableRows().length === 1 ? 'tune' : 'tunes'}
                  <span class="sub-sep">·</span>
                  {scopeDefinition()}
                </Show>
              </p>
              {/* Las otras puertas del repertorio, dichas donde se usan: la
                  escalera entera y el banco de trabajo. Una lista acotada sin
                  salida es un callejón. */}
              <p class="sub sub--doors">
                <A href="/">Repertoire</A>
                <Show when={!isAll()}>
                  <span class="sub-sep">·</span>
                  <A href="/level/all">All tunes</A>
                </Show>
                <span class="sub-sep">·</span>
                <A href="/learning">Learning</A>
                <Show when={scope() !== BACKLOG_SCOPE}>
                  <span class="sub-sep">·</span>
                  <A href={`/level/${BACKLOG_SCOPE}`}>{backlogCount(store.rows())} to learn</A>
                </Show>
                <Show when={scope() !== SHELVED_SCOPE && shelvedCount(store.rows()) > 0}>
                  <span class="sub-sep">·</span>
                  <A href={`/level/${SHELVED_SCOPE}`}>{shelvedCount(store.rows())} shelved</A>
                </Show>
              </p>
            </div>
          </header>

          <Show when={store.error()}>
            <p class="notice notice-error" role="alert">
              {store.error()}
            </p>
          </Show>

          <div class="sortbar">
            <span class="lbl">Sort by</span>
            {/* El selector y las cabeceras mueven las mismas dos señales: aquí se
                elige columna (con su sentido natural) y en la tabla se invierte
                con un segundo clic. */}
            <select
              aria-label="Sort by"
              value={sortKey()}
              onChange={(event) => {
                const key = event.currentTarget.value as SortKey;
                setSortKey(key);
                setSortDirection(SORT_DEFAULT_DIRECTION[key]);
              }}
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option value={key}>{SORT_LABELS[key]}</option>
              ))}
            </select>
            <span class="spacer" />
          </div>

          {/* Etiquetar en bloque (#48). La barra solo existe con algo marcado —un
              «N selected» sin selección sería un control muerto— y el panel abre
              un **borrador** de etiquetas que no escribe nada hasta «Apply». */}
          <Show when={listedSelection().length > 0}>
            <div class="selection-bar">
              <span class="count">{listedSelection().length} selected</span>
              {/* Sin vocabulario no hay botón: un panel vacío promete algo que no hay. */}
              <Show when={tagGroups()}>
                <button
                  type="button"
                  class="tag-toggle"
                  aria-expanded={tagPanelOpen()}
                  aria-controls="bulk-tag-panel"
                  onClick={() => setTagPanelOpen((open) => !open)}
                >
                  Tag selection
                </button>
              </Show>
              <button type="button" class="tag-clear" onClick={clearSelection}>
                Clear
              </button>
            </div>
          </Show>

          <Show when={tagPanelOpen() && listedSelection().length > 0 && tagGroups()}>
            {(groups) => (
              <div class="tag-panel" id="bulk-tag-panel">
                {/* El mismo árbol que el detalle: una sola verdad del marcado. */}
                <TagPicker
                  groups={groups()}
                  selected={draftTags()}
                  disabled={savingTags()}
                  idPrefix="bulk-tags"
                  onToggle={toggleDraftTag}
                />
                <div class="tag-actions">
                  <button
                    type="button"
                    class="tag-apply"
                    disabled={draftTags().length === 0 || savingTags()}
                    onClick={() => void applyTags()}
                  >
                    {savingTags() ? 'Applying…' : 'Apply'}
                  </button>
                  <button
                    type="button"
                    class="tag-clear"
                    onClick={() => {
                      setDraftTags([]);
                      setTagPanelOpen(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Show>

          {/* Un fallo al escribir no limpia la selección: se dice y se reintenta. */}
          <Show when={tagError()}>
            <p class="notice notice-error" role="alert">
              {tagError()}
            </p>
          </Show>
          <Show when={notice()}>
            <p class="notice" role="status">
              {notice()}
            </p>
          </Show>

          <Show when={!store.loading()} fallback={<p class="notice">Loading the list…</p>}>
            <Show
              when={tableRows().length > 0}
              fallback={<p class="band-empty">Nothing at this level yet.</p>}
            >
              <RepertoireTable
                rows={tableRows()}
                now={store.now()}
                sortKey={sortKey()}
                sortDirection={sortDirection()}
                selected={listedSelection()}
                onToggleRow={toggleRowSelection}
                onToggleAll={toggleAllListed}
                onSort={chooseSort}
                onPractise={store.practise}
                onToggleFavorite={store.toggleFavorite}
                onStatusChange={store.changeStatus}
                learningFull={slots().free === 0}
              />
            </Show>
          </Show>
        </div>
      </Show>
    </Show>
  );
}

/**
 * Un solo menú abierto a la vez en toda la tabla, compartido por todas las
 * filas: abrir uno cierra el anterior sin que la pantalla lleve la cuenta. Es
 * el mecanismo de `TuneCard` (#29), no un segundo invento.
 */
let activeRowMenu: (() => void) | null = null;

/**
 * La fila del listado (#42): ocho columnas —casilla, corazón, Tune, Level,
 * Practices, Last played, Average, Added y el menú—.
 *
 * Lo que la fila NO es: una ficha. Dice los invariantes de la pieza bajo el
 * título y los metadatos del dueño en columnas, y solo se toca en dos sitios
 * —la favorita y el peldaño—; el resto de acciones están en el menú y el
 * borrado, en la ficha.
 */
function RepertoireRowView(props: {
  row: RepertoireRow;
  now: number;
  /** La fila está marcada para etiquetar en bloque (#48). */
  selected: boolean;
  onToggleSelect: (row: RepertoireRow, next: boolean) => void;
  onToggleFavorite: (row: RepertoireRow) => void | Promise<void>;
  onPractise: (row: RepertoireRow) => void | Promise<void>;
  onStatusChange: (row: RepertoireRow, status: TuneStatus) => void | Promise<void>;
  /** El taller está lleno (#52): «Start learning» queda cerrado hasta que salga una. */
  learningFull: boolean;
}) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [subOpen, setSubOpen] = createSignal(false);
  const [menuUp, setMenuUp] = createSignal(false);
  let menuEl: HTMLDivElement | undefined;

  const title = createMemo(() => displayTitle(props.row));
  const invariants = createMemo(() => rowInvariants(props.row));
  const days = createMemo(() => stalenessDays(props.row, props.now));
  const tag = createMemo(() => stalenessTag(days()));
  const colour = createMemo(() => stalenessColor(days()));
  const level = createMemo(() => levelText(props.row));

  const closeMenu = () => {
    setSubOpen(false);
    setMenuOpen(false);
    if (activeRowMenu === closeMenu) activeRowMenu = null;
  };

  /**
   * El menú tiene trece renglones con las definiciones dentro: pegado al pie de
   * la ventana gira hacia arriba (`.menu--row.up`) en vez de salirse.
   */
  const toggleMenu = () => {
    if (menuOpen()) {
      closeMenu();
      return;
    }
    if (activeRowMenu) activeRowMenu();
    setMenuOpen(true);
    activeRowMenu = closeMenu;
    const rect = menuEl?.getBoundingClientRect();
    setMenuUp(Boolean(rect && rect.bottom > window.innerHeight - 8));
  };

  /**
   * Escape cierra **primero el submenú y después el menú**: son dos niveles y
   * salir de los dos de un golpe deja al lector sin saber dónde estaba. Clic
   * fuera cierra todo; los clics de dentro se ignoran aquí porque el disparador
   * y el submenú viven dentro de `.row-actions` y el navegador ya entregó el
   * evento antes de que el menú pudiera pararlo.
   */
  createEffect(() => {
    if (!menuOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (subOpen()) {
        setSubOpen(false);
        return;
      }
      closeMenu();
    };
    const onClickAway = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && menuEl?.parentElement?.contains(target)) return;
      closeMenu();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClickAway);
    onCleanup(() => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClickAway);
    });
  });

  onCleanup(() => {
    if (activeRowMenu === closeMenu) activeRowMenu = null;
  });

  return (
    <tr>
      {/* Selección para etiquetar en bloque (#48): la casilla abre la fila y su
          nombre accesible es el título mostrado, para no tener que adivinar cuál
          es «la tercera». Marcar no ordena, no filtra y no recarga nada. */}
      <td class="pick">
        <input
          type="checkbox"
          aria-label={title()}
          checked={props.selected}
          onChange={(event) => props.onToggleSelect(props.row, event.currentTarget.checked)}
        />
      </td>
      <td class="fav">
        <button
          type="button"
          class="fav-btn"
          aria-pressed={props.row.favorite ? 'true' : 'false'}
          aria-label={`Favourite: ${title()}`}
          onClick={() => void props.onToggleFavorite(props.row)}
        >
          {props.row.favorite ? '♥' : '♡'}
        </button>
      </td>
      <td>
        <div class="row-title">
          {/* El disparador va aquí, **fuera** del enlace: un botón dentro de un
              `<a>` es marcado inválido y el clic acabaría navegando (#29). */}
          <PlayTrigger row={props.row} />
          <A href={`/repertoire/${props.row.id}`}>{title()}</A>
        </div>
        {/* Los invariantes de la pieza. Lo que falte se omite: ni «trad.» ni un
            guion, porque un guion aquí se lee como un dato. */}
        <div class="row-invariants">
          <Show when={invariants().rhythm}>{invariants().rhythm}</Show>
          <Show when={invariants().meter}>
            <Show when={invariants().rhythm}>
              <span class="sep">·</span>
            </Show>
            {invariants().meter}
          </Show>
          <Show when={invariants().composer}>
            <Show when={invariants().rhythm || invariants().meter}>
              <span class="sep">·</span>
            </Show>
            <i>{invariants().composer}</i>
          </Show>
        </div>
      </td>
      <td>
        {/* El `title` no es un nombre accesible: el icono lleva `role="img"` y
            `aria-label`, y los dos se pintan del mismo texto para que cambiar
            de peldaño los mueva a la vez. */}
        <span class="rung" role="img" aria-label={`Level: ${level()}`} title={level()}>
          <For each={RUNG_BARS}>
            {(rung) => <span classList={{ on: rung <= rungOf(props.row) }} />}
          </For>
        </span>
      </td>
      <td class="num">{props.row.practice_count ?? 0}</td>
      <td class="num">
        <span
          class="tag tag--row"
          classList={{ 'is-never': days() === null }}
          title={stalenessTitle(tag())}
          style={
            days() === null
              ? undefined
              : { background: colour().background, color: colour().foreground }
          }
        >
          <Show when={tag().unit} fallback={tag().value}>
            <b>{tag().value}</b> {tag().unit}
          </Show>
        </span>
      </td>
      <td class="num">
        <Show when={props.row.avg_quality !== null} fallback={<span class="nodata">—</span>}>
          {props.row.avg_quality!.toFixed(1)}
        </Show>
      </td>
      <td class="num c-added" title={new Date(props.row.added_at).toLocaleDateString()}>
        {addedAge(props.row.added_at, props.now)}
      </td>
      <td style={{ 'text-align': 'right' }}>
        <span class="row-actions">
          <button
            type="button"
            class="kebab kebab--row"
            aria-haspopup="menu"
            aria-expanded={menuOpen()}
            aria-label={`Actions for ${title()}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleMenu();
            }}
          >
            <span />
            <span />
            <span />
          </button>
          <div
            class="menu menu--row"
            classList={{ open: menuOpen(), up: menuUp() }}
            role="menu"
            aria-label={`Actions for ${title()}`}
            ref={menuEl}
            onClick={(event) => event.stopPropagation()}
          >
            {/* El gesto que saca una pieza del backlog (#50): una acción, no un
                submenú. Solo aparece cuando de verdad no se ha empezado.

                Y desde #52 la puerta tiene tope: `learning` es un banco de
                trabajo, no un almacén. Lleno, el renglón se queda pero no se
                puede pulsar, y dice por qué y dónde se libera: esconderlo haría
                creer que la acción no existe. */}
            <Show when={props.row.status === 'to_learn'}>
              <button
                type="button"
                role="menuitem"
                disabled={props.learningFull}
                onClick={() => {
                  closeMenu();
                  void props.onStatusChange(props.row, 'learning');
                }}
              >
                <span>
                  Start learning
                  <small>
                    {props.learningFull
                      ? 'The workbench is full — free a slot before starting another'
                      : 'Move it out of the backlog and into the rotation'}
                  </small>
                </span>
              </button>
            </Show>

            {/* El peldaño vive en un submenú de segundo nivel: desplegado en el
                menú principal lo estiraba hasta necesitar un techo de altura, y
                ese techo recortaba el submenú. El menú padre no lleva `overflow`. */}
            <div class="has-sub">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={subOpen()}
                onClick={() => setSubOpen((open) => !open)}
              >
                <span>
                  Level
                  <span class="current">{STATUS_LABELS[props.row.status]}</span>
                </span>
                <span aria-hidden="true">▸</span>
              </button>
              <div class="submenu" hidden={!subOpen()} role="menu" aria-label="Level">
                <For each={LEVEL_OPTIONS}>
                  {(band) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={props.row.status === band.status ? 'true' : 'false'}
                      onClick={() => {
                        closeMenu();
                        void props.onStatusChange(props.row, band.status);
                      }}
                    >
                      {/* Un solo bloque dentro del botón: `.menu button` es una
                          fila flex (viene de la carta) y así la etiqueta, el ✓ y
                          la definición —que es un `small` de bloque— se apilan
                          sin pelearse por la misma línea. */}
                      <span>
                        {band.label}
                        <Show when={props.row.status === band.status}>
                          <span class="check" aria-hidden="true">✓</span>
                        </Show>
                        <small>{band.definition}</small>
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </div>
            <div class="sep" />
            <A role="menuitem" href={`/repertoire/${props.row.id}`} onClick={closeMenu}>
              View details
            </A>
            <A role="menuitem" href={`/repertoire/${props.row.id}`} onClick={closeMenu}>
              Edit details
            </A>
            {/* «Add to set» no tiene destino todavía: los sets llegan en F7. Se
                queda deshabilitado y con el motivo, no con una pantalla a medias. */}
            <button type="button" role="menuitem" disabled title="Sets are not built yet">
              Add to set
            </button>
            <button
              type="button"
              role="menuitem"
              class="primary"
              onClick={() => {
                closeMenu();
                void props.onPractise(props.row);
              }}
            >
              Practise
            </button>
          </div>
        </span>
      </td>
    </tr>
  );
}

/**
 * La cabecera ordenable de una columna: el `th` lleva `aria-sort` cuando es la
 * columna activa y entonces se enciende la flecha (`.arrow`), que en el resto
 * de columnas ocupa su sitio apagada para que la cabecera no baile al ordenar.
 */
function SortHeader(props: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  direction: SortDirection;
  numeric?: boolean;
  extra?: string;
  onSort: (key: SortKey) => void;
}) {
  const sorted = () => props.active === props.sortKey;
  return (
    <th
      class={[props.numeric ? 'num' : '', props.extra ?? ''].filter(Boolean).join(' ') || undefined}
      aria-sort={sorted() ? (props.direction === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button type="button" onClick={() => props.onSort(props.sortKey)}>
        {props.label}{' '}
        <span class="arrow" aria-hidden="true">
          {props.direction === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  );
}

/**
 * La tabla del listado (#42, boceto 014-b): la superficie donde se **mira** un
 * peldaño entero y se ordena por los metadatos del dueño.
 *
 * Ocho columnas: corazón, Tune con los invariantes debajo, Level como icono de
 * cinco barras, Practices, Last played, Average, Added y el menú. Fuera la
 * columna `Key` —nula en toda la tabla—, el `#origin_ref` como segunda línea y
 * el botón «Remove», que es acción de la ficha (#45).
 *
 * La tabla no lleva tarjeta contenedora: sobre papel, la línea de la cabecera y
 * la de cada fila son toda la caja.
 */
function RepertoireTable(props: {
  rows: RepertoireRow[];
  now: number;
  sortKey: SortKey;
  sortDirection: SortDirection;
  /** Ids de fila (`pr_repertoire`) marcados para etiquetar en bloque (#48). */
  selected: readonly string[];
  onToggleRow: (row: RepertoireRow, next: boolean) => void;
  onToggleAll: (next: boolean) => void;
  onSort: (key: SortKey) => void;
  onPractise: (row: RepertoireRow) => void | Promise<void>;
  onToggleFavorite: (row: RepertoireRow) => void | Promise<void>;
  onStatusChange: (row: RepertoireRow, status: TuneStatus) => void | Promise<void>;
  /** El taller está lleno (#52): la puerta del backlog lo dice al abrirse. */
  learningFull: boolean;
}) {
  const allSelected = () =>
    props.rows.length > 0 && props.rows.every((row) => props.selected.includes(row.id));
  const someSelected = () => props.rows.some((row) => props.selected.includes(row.id));

  /**
   * «Parcialmente marcada» no es expresable en HTML: el estado intermedio del
   * «select all» se pinta por propiedad (`indeterminate`), no por atributo. Sin
   * esto, tres filas marcadas de siete se leen como «ninguna».
   */
  let selectAllBox: HTMLInputElement | undefined;
  createEffect(() => {
    if (selectAllBox) selectAllBox.indeterminate = someSelected() && !allSelected();
  });

  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="pick">
              {/* Marca lo que se está pintando —el ámbito actual—, no el
                  repertorio entero: marcar filas que no se ven es una trampa. */}
              <input
                ref={selectAllBox}
                type="checkbox"
                aria-label="Select all listed tunes"
                checked={allSelected()}
                onChange={(event) => props.onToggleAll(event.currentTarget.checked)}
              />
            </th>
            <th />
            <SortHeader
              label="Tune"
              sortKey="alphabetical"
              active={props.sortKey}
              direction={props.sortDirection}
              onSort={props.onSort}
            />
            <SortHeader
              label="Level"
              sortKey="level"
              active={props.sortKey}
              direction={props.sortDirection}
              onSort={props.onSort}
            />
            <SortHeader
              label="Practices"
              sortKey="practices"
              active={props.sortKey}
              direction={props.sortDirection}
              numeric
              onSort={props.onSort}
            />
            <SortHeader
              label="Last played"
              sortKey="urgency"
              active={props.sortKey}
              direction={props.sortDirection}
              numeric
              onSort={props.onSort}
            />
            <SortHeader
              label="Average"
              sortKey="quality"
              active={props.sortKey}
              direction={props.sortDirection}
              numeric
              onSort={props.onSort}
            />
            <SortHeader
              label="Added"
              sortKey="added"
              active={props.sortKey}
              direction={props.sortDirection}
              numeric
              extra="c-added"
              onSort={props.onSort}
            />
            <th />
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <RepertoireRowView
                row={row}
                now={props.now}
                selected={props.selected.includes(row.id)}
                onToggleSelect={props.onToggleRow}
                onPractise={props.onPractise}
                onToggleFavorite={props.onToggleFavorite}
                onStatusChange={props.onStatusChange}
                learningFull={props.learningFull}
              />
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
