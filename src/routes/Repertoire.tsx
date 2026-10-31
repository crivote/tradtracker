import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { A, useNavigate, useSearchParams } from '@solidjs/router';
import {
  BANDS,
  SHELVED_SCOPE,
  SORT_DEFAULT_DIRECTION,
  SORT_LABELS,
  STATUS_LABELS,
  addCatalogueTune,
  addedAge,
  bandFor,
  capForColumns,
  capRows,
  displayTitle,
  fetchRepertoire,
  groupIntoBands,
  levelText,
  parseScope,
  parseViewMode,
  rowInvariants,
  rungOf,
  saveFavorite,
  saveStatus,
  shelvedCount,
  sortRepertoire,
  stalenessColor,
  stalenessDays,
  stalenessTag,
  stalenessTitle,
  statusCounts,
  VIEW_MODE_KEY,
  type BandGroup,
  type RepertoireRow,
  type RepertoireScope,
  type SortDirection,
  type SortKey,
  type TuneStatus,
  type ViewMode,
} from '../lib/repertoire';
import {
  aliasExcerpt,
  matchedViaAlias,
  tokenizeQuery,
  type CatalogueEntry,
} from '../lib/catalogue';
import {
  preloadCatalogue,
  searchCatalogue,
  getCatalogueStats,
  lookupCatalogueMeta,
} from '../lib/catalogue-db';
import { normalizeTitle } from '../lib/format';
import { logPractice } from '../lib/practice';
import TuneCard from '../components/TuneCard';
import ImportFromSession from '../components/ImportFromSession';
import './repertoire.css';

/**
 * Home del repertorio (#29).
 *
 * La pantalla ya no es una lista ordenada sino cinco bandas en orden de
 * escalera (to_learn → learning → shaky → playing_along → solo_ready), cada una con su
 * definición escrita y su recuento, y **una sola carta** para todas las filas.
 *
 * Cuatro reglas mandan sobre el resto:
 *   · Dentro de cada banda, orden por staleness: nunca tocada primero, después
 *     días descendentes. El orden es del modelo puro (`groupIntoBands`), no del
 *     JSX ni de la base.
 *   · La home enseña **tres filas por banda y nada más** (12 cartas con cuatro
 *     columnas, #46). El tope se mide sobre las columnas reales de la rejilla y se
 *     recalcula al cambiar el ancho; no es un número fijo. Así el máximo de la
 *     pantalla son 60 cartas y la página no crece con el repertorio.
 *   · El listado completo de un peldaño **es una lista**, no una rejilla: el
 *     título de la banda y «See all N as list» abren esa sola banda en la tabla,
 *     con su orden elegido a mano. De ahí se vuelve con «Back to all».
 *   · Las aparcadas **no se ven en la home**: solo su recuento, en la cabecera,
 *     que es la puerta a su listado. Aparcar no cambia el peldaño, así que no
 *     son una banda más.
 *
 * El listado de un peldaño —y el cajón de aparcadas— es la **tabla del boceto
 * 014-b** (#42): se recorre entera y se ordena por las cabeceras; en la fila
 * solo se toca la favorita y el peldaño, y el borrado vive en la ficha.
 */

/**
 * La preferencia de vista se lee al montar y se escribe al cambiar. Si el
 * navegador la bloquea (modo privado) se degrada al grid por defecto, que es la
 * vista principal del repertorio.
 */
function loadViewMode(): ViewMode {
  try {
    return parseViewMode(sessionStorage.getItem(VIEW_MODE_KEY));
  } catch {
    return 'grid';
  }
}

function rememberViewMode(mode: ViewMode): void {
  try {
    sessionStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    /* sin almacenamiento disponible: la preferencia solo vive en memoria */
  }
}

/** «1 tune» / «12 tunes», con el número ya formateado por quien llama. */
function tuneCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'tune' : 'tunes'}`;
}

/**
 * La banda de la home: dos filas de cartas, su recuento y la puerta al listado.
 *
 * No hay carga progresiva: la home no recorre una banda entera. Lo que no cabe
 * en las dos filas no se despliega en la rejilla — se mira en la lista, que es
 * la superficie que sí está hecha para muchas filas.
 */
function BandView(props: {
  group: BandGroup;
  now: number;
  /** Esta banda es la única en pantalla (?band=…). */
  scoped: boolean;
  /** Aísla esta banda en la rejilla (solo queda ella en pantalla). */
  onShowOnly: () => void;
  /** Abre el listado completo de esta banda, en la tabla. */
  onSeeList: () => void;
  onPractise: (row: RepertoireRow) => void | Promise<void>;
}) {
  let grid: HTMLDivElement | undefined;

  // Columnas reales de la rejilla: es lo que decide el tope de dos filas.
  const [columns, setColumns] = createSignal(4);

  const measure = () => {
    if (!grid) return;
    const template = window.getComputedStyle(grid).gridTemplateColumns;
    const count = template.split(' ').filter(Boolean).length;
    if (count > 0) setColumns(count);
  };

  onMount(() => {
    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);

    // El ancho de la rejilla también cambia sin que cambie la ventana (barra de
    // scroll, panel del catálogo); el observador cubre los dos casos.
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && grid) {
      observer = new ResizeObserver(() => measure());
      observer.observe(grid);
    }

    onCleanup(() => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    });
  });

  const cap = createMemo(() => capForColumns(columns()));
  const rows = createMemo(() => capRows(props.group.rows, cap()));
  const total = createMemo(() => props.group.rows.length);
  /** Hay más de las que caben, o la banda está aislada y se quiere entera. */
  const offersList = createMemo(() => props.scoped || total() > cap());

  return (
    <section class="band" data-band={props.group.band.status} aria-labelledby={`band-${props.group.band.status}`}>
      <div class="band-head">
        <span class="rungs" aria-hidden="true">
          <For each={[1, 2, 3, 4, 5]}>
            {(rung) => <i classList={{ on: rung <= props.group.band.rung }} />}
          </For>
        </span>
        {/*
          Atajo al filtro por peldaño (#11): el filtro ya existe por construcción
          (las bandas son los peldaños) y esto solo lo alcanza con el teclado y
          con un clic. Una banda ya aislada no vuelve a ofrecer el atajo.
        */}
        <h2 id={`band-${props.group.band.status}`}>
          <Show
            when={!props.scoped}
            fallback={props.group.band.label}
          >
            <button
              type="button"
              aria-label={`Show only ${props.group.band.label}`}
              onClick={props.onShowOnly}
            >
              {props.group.band.label}
            </button>
          </Show>
        </h2>
        <span class="def">{props.group.band.definition}</span>
        <span class="count">{tuneCountLabel(total())}</span>
      </div>

      <Show
        when={total() > 0}
        fallback={<p class="band-empty">Nothing at this level yet.</p>}
      >
        <div class="grid-4" ref={grid}>
          <For each={rows()}>
            {(row) => (
              <TuneCard
                row={row}
                now={props.now}
                onPractise={props.onPractise}
              />
            )}
          </For>
        </div>

        {/* El listado completo de un peldaño es una lista, no una rejilla: no
            hay «desplegar» que valga. La búsqueda de la home ya no existe (#9);
            lo que casa con un título se mira en /search, que cruza peldaños. */}
        <Show when={offersList()}>
          <button type="button" class="more" onClick={props.onSeeList}>
            See all {total()} as list
          </button>
        </Show>
      </Show>
    </section>
  );
}

/**
 * Un solo menú abierto a la vez en toda la tabla, compartido por todas las
 * filas: abrir uno cierra el anterior sin que la pantalla lleve la cuenta. Es
 * el mecanismo de `TuneCard` (#29), no un segundo invento.
 */
let activeRowMenu: (() => void) | null = null;

/**
 * La fila del listado (#42): ocho columnas —corazón, Tune, Level, Practices,
 * Last played, Average, Added y el menú—.
 *
 * Lo que la fila NO es: una ficha. Dice los invariantes de la pieza bajo el
 * título y los metadatos del dueño en columnas, y solo se toca en dos sitios
 * —la favorita y el peldaño—; el resto de acciones están en el menú y el
 * borrado, en la ficha.
 */
function RepertoireRowView(props: {
  row: RepertoireRow;
  now: number;
  onToggleFavorite: (row: RepertoireRow) => void | Promise<void>;
  onPractise: (row: RepertoireRow) => void | Promise<void>;
  onStatusChange: (row: RepertoireRow, status: TuneStatus) => void | Promise<void>;
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
          <For each={[1, 2, 3, 4, 5]}>
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
                <For each={BANDS}>
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
      aria-sort={
        sorted() ? (props.direction === 'asc' ? 'ascending' : 'descending') : undefined
      }
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
  onSort: (key: SortKey) => void;
  onPractise: (row: RepertoireRow) => void | Promise<void>;
  onToggleFavorite: (row: RepertoireRow) => void | Promise<void>;
  onStatusChange: (row: RepertoireRow, status: TuneStatus) => void | Promise<void>;
}) {
  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
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
                onPractise={props.onPractise}
                onToggleFavorite={props.onToggleFavorite}
                onStatusChange={props.onStatusChange}
              />
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

export default function Repertoire() {
  // El instante de la vista: el tag de todas las cartas habla del mismo «hoy».
  // Se refresca al recargar (tras apuntar un ensayo) para que «today» sea hoy.
  const [now, setNow] = createSignal(Date.now());

  const [rows, setRows] = createSignal<RepertoireRow[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [busyId, setBusyId] = createSignal<string | number | null>(null);
  const [showCatalogue, setShowCatalogue] = createSignal(false);
  // El import de The Session (#32) se abre en el mismo sitio que el catálogo:
  // un panel en línea, no un modal. Los dos pueden estar abiertos a la vez.
  const [showImport, setShowImport] = createSignal(false);

  const navigate = useNavigate();

  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<CatalogueEntry[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [searchMs, setSearchMs] = createSignal<number | null>(null);
  const [catalogueError, setCatalogueError] = createSignal<string | null>(null);
  const [catalogueReady, setCatalogueReady] = createSignal(false);
  const [tuneCount, setTuneCount] = createSignal<number | null>(null);

  const [viewMode, setViewMode] = createSignal<ViewMode>(loadViewMode());
  /**
   * El orden del listado: la columna y su sentido. Por defecto **urgencia
   * descendente** —nunca ensayada primero, después la más abandonada—, que es
   * el orden que la tabla tiene desde #7. Las cabeceras y el selector de la
   * barra mueven las mismas dos señales.
   */
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

  // Lo que se está mirando vive en la URL (§2.7): recargar mantiene la vista.
  // `?band=` acepta los cinco peldaños y `shelved`, que es el cajón.
  const [params, setParams] = useSearchParams<{ band?: string }>();
  const scope = createMemo<RepertoireScope | null>(() => parseScope(params.band));
  /** El ámbito es un peldaño (no el cajón): lo que aísla una banda de la home. */
  const scopedBand = createMemo<TuneStatus | null>(() => {
    const current = scope();
    return current !== null && current !== SHELVED_SCOPE ? current : null;
  });
  /**
   * El cajón no se pinta en rejilla nunca: sus tunes se miran en lista, que es
   * la única superficie de la app hecha para muchas filas. Así no hay un estado
   * muerto en el que el conmutador Table/Cards no signifique nada.
   */
  const effectiveMode = createMemo<ViewMode>(() =>
    scope() === SHELVED_SCOPE ? 'table' : viewMode()
  );

  const chooseView = (mode: ViewMode) => {
    setViewMode(mode);
    rememberViewMode(mode);
  };

  const tokens = createMemo(() => tokenizeQuery(query()));
  const counts = createMemo(() => statusCounts(rows()));
  /** Las del cajón, para que la cabecera sume: bandas + aparcadas = repertorio. */
  const shelvedTotal = createMemo(() => shelvedCount(rows()));

  /** Las cinco bandas, cada una ordenada por staleness. */
  const groups = createMemo(() => groupIntoBands(rows(), now()));

  /**
   * Lo que se pinta: las cinco bandas, vacías incluidas, porque la pantalla es
   * la escalera. Con una banda aislada (`?band=`), esa sola.
   *
   * La home ya no filtra por título (#9): el texto se busca en /search, que
   * cruza los peldaños y las aparcadas. `?band=` sigue filtrando por ámbito y
   * eso no se toca.
   */
  const visibleGroups = createMemo(() => {
    const open = scopedBand();
    if (!open) return groups();
    const group = groups().find((candidate) => candidate.band.status === open);
    return group ? [group] : [];
  });

  /**
   * La tabla consume las filas de su ámbito y el orden elegido a mano. Un
   * peldaño excluye las aparcadas —aparcar no cambia el peldaño, pero las
   * aparcadas fuera de rotación—, así que la lista de una banda cuadra con su
   * recuento; el cajón hace lo contrario y solo trae las aparcadas.
   */
  const tableRows = createMemo(() => {
    const current = scope();
    let pool = rows();
    if (current === SHELVED_SCOPE) pool = pool.filter((row) => row.shelved);
    else if (current !== null) pool = pool.filter((row) => row.status === current && !row.shelved);
    return sortRepertoire(pool, sortKey(), sortDirection());
  });

  /** Título del ámbito para la barra: el peldaño o «Shelved». */
  const scopeLabel = createMemo(() => {
    const current = scope();
    if (current === null) return null;
    return current === SHELVED_SCOPE ? 'Shelved' : bandFor(current).label;
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
   * que la rejilla no parpadee con el menú recién cerrado.
   */
  const reload = async () => {
    try {
      setRows(await fetchRepertoire());
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  onMount(() => {
    void load();
    // Descarga del artefacto en segundo plano: al abrir el buscador ya está.
    void preloadCatalogue().then(
      async () => {
        setCatalogueReady(true);
        try {
          setTuneCount((await getCatalogueStats()).tunes);
        } catch {
          /* el recuento es informativo: si falla, el buscador sigue */
        }
      },
      (cause) => {
        setCatalogueError(cause instanceof Error ? cause.message : String(cause));
        setCatalogueReady(true);
      }
    );
  });

  createEffect(() => {
    const term = query();
    if (term.trim().length === 0) {
      setResults([]);
      setSearchMs(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const started = performance.now();

    void searchCatalogue(term)
      .then((found) => {
        if (cancelled) return;
        setResults(found);
        setSearchMs(performance.now() - started);
        setCatalogueError(null);
      })
      .catch((cause) => {
        if (cancelled) return;
        setResults([]);
        setCatalogueError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });

    onCleanup(() => {
      cancelled = true;
    });
  });

  /**
   * Los tunes que ya están en el repertorio se reconocen por `origin_ref`: el
   * catálogo solo conoce el id de TheSession, no el uuid de `pr_tunes`.
   */
  const ownedRefs = createMemo(
    () =>
      new Set(
        rows()
          .filter((row) => row.tune.origin === 'thesession' && row.tune.origin_ref)
          .map((row) => row.tune.origin_ref!)
      )
  );

  const add = async (entry: CatalogueEntry) => {
    setBusyId(entry.tuneId);
    setError(null);
    try {
      // El autor no viaja en el resultado del buscador; sí en la consulta por
      // id del catálogo (#44). Sin este viaje la tune nace sin autor y el
      // subtexto de la fila —tipo · compás · autor— queda cojo hasta el
      // próximo relleno.
      const meta = await lookupCatalogueMeta([entry.tuneId]);
      await addCatalogueTune({
        tuneId: entry.tuneId,
        name: entry.name,
        rhythm: entry.type,
        meter: entry.meter,
        composer: meta.get(entry.tuneId)?.composer ?? null,
      });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  /**
   * La favorita de la fila, optimista y con reversión: el corazón responde al
   * toque y, si el guardado falla, se deshace y se dice. Una favorita fantasma
   * envenenaría el ×1,4 del generador de la lista de hoy. Mismo patrón que
   * `/practice`.
   */
  const toggleFavorite = async (row: RepertoireRow) => {
    const before = row.favorite;
    const next = !before;
    const paint = (value: boolean) =>
      setRows((previous) =>
        previous.map((candidate) =>
          candidate.id === row.id ? { ...candidate, favorite: value } : candidate
        )
      );

    paint(next);
    setError(null);
    try {
      await saveFavorite(row.id, next);
    } catch (cause) {
      paint(before);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  /**
   * El peldaño desde el submenú del menú. Optimista por la misma razón que el
   * corazón: el icono, su `title` y su `aria-label` se pintan del mismo dato y
   * cambian juntos en cuanto se elige. Si el guardado falla, la fila vuelve a su
   * peldaño y se dice.
   */
  const changeStatus = async (row: RepertoireRow, status: TuneStatus) => {
    const before = row.status;
    if (before === status) return;
    const paint = (value: TuneStatus) =>
      setRows((previous) =>
        previous.map((candidate) =>
          candidate.id === row.id ? { ...candidate, status: value } : candidate
        )
      );

    paint(status);
    setError(null);
    try {
      await saveStatus(row.id, status);
    } catch (cause) {
      paint(before);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  /**
   * «Practise» del menú: apunta el ensayo de un clic, sin puntuarlo. La calidad
   * es opcional por diseño (#10) y se puntúa en el detalle; obligar a pasar por
   * un formulario para apuntar que has tocado una tune mataría el gesto.
   */
  const practise = async (row: RepertoireRow) => {
    setBusyId(row.id);
    setError(null);
    try {
      await logPractice(row.id, { quality: null, comment: null });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  /** Aísla una banda en la rejilla: solo queda ella en pantalla. */
  const showOnly = (status: TuneStatus) => setParams({ band: status });
  /** Abre el listado completo: la banda (o el cajón) en la tabla, sin cartas. */
  const seeList = (target: RepertoireScope) => {
    setParams({ band: target });
    chooseView('table');
  };
  /** La puerta de las aparcadas: su recuento en la cabecera lleva a su listado. */
  const seeShelved = () => seeList(SHELVED_SCOPE);
  /**
   * «Back to all». Desde el cajón se vuelve a la **home** —las cinco bandas—,
   * que es lo que se estaba mirando antes de entrar: dejar la lista completa de
   * todo el repertorio es otra pantalla y el lector no la ha pedido. Desde un
   * peldaño solo se limpia el ámbito, sin cambiar el modo de vista.
   */
  const backToAll = () => {
    if (scope() === SHELVED_SCOPE) {
      navigate('/');
      chooseView('grid');
      return;
    }
    setParams({ band: undefined });
  };

  return (
    <div class="repertoire-home">
      <header class="page-head">
        <div>
          <h1>Repertoire</h1>
          <p class="sub">
            <Show when={!loading()} fallback="Loading…">
              <b>{tuneCountLabel(rows().length)}</b>
              {' · '}
              {counts().to_learn} to learn · {counts().learning} learning ·{' '}
              {counts().shaky} shaky · {counts().playing_along} playing along ·{' '}
              {counts().solo_ready} solo-ready
              {/* Las aparcadas no se pintan en la home, solo su recuento —y ese
                  recuento es la puerta a su listado, que si no no habría dónde
                  mirarlas—. Se nombran para que el total cuadre: bandas más
                  aparcadas son el repertorio entero. */}
              <Show when={shelvedTotal() > 0}>
                {' · '}
                <button type="button" class="shelved-link" onClick={seeShelved}>
                  {shelvedTotal()} shelved
                </button>
              </Show>
            </Show>
          </p>
        </div>
        <div class="head-tools">
          {/*
            Puerta a la búsqueda (#9). La home ya no busca: dos buscadores con
            comportamientos distintos en la misma pantalla es justo lo que hay
            que evitar, y el filtro por bandas se saltaba el tope de ocho cartas
            que la home acaba de fijar. La búsqueda vive en /search, cruza todos
            los peldaños —aparcadas incluidas— y filtra además por ritmo.
          */}
          <button
            type="button"
            class="search search--door"
            onClick={() => navigate('/search')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            Search tunes
          </button>
          {/* El conmutador no se ofrece mirando el cajón: sus tunes no se pintan
              en rejilla, así que «Cards» no tendría efecto. */}
          <Show when={scope() !== SHELVED_SCOPE}>
            <div class="viewswitch" role="group" aria-label="Repertoire view">
              <button
                type="button"
                aria-pressed={effectiveMode() === 'table'}
                onClick={() => chooseView('table')}
              >
                Table
              </button>
              <button
                type="button"
                aria-pressed={effectiveMode() === 'grid'}
                onClick={() => chooseView('grid')}
              >
                Cards
              </button>
            </div>
          </Show>
          <button type="button" class="add" onClick={() => setShowCatalogue((open) => !open)}>
            {showCatalogue() ? 'Close catalogue' : 'Add a tune'}
          </button>
          <button
            type="button"
            class="add add--quiet"
            aria-expanded={showImport()}
            onClick={() => setShowImport((open) => !open)}
          >
            {showImport() ? 'Close import' : 'Import from The Session'}
          </button>
        </div>
      </header>

      <Show when={error()}>
        <p class="notice notice-error" role="alert">
          {error()}
        </p>
      </Show>

      {/* Import del tunebook (#32): mismo sitio y misma forma que el catálogo,
          porque es la otra puerta de entrada al repertorio. */}
      <Show when={showImport()}>
        <ImportFromSession
          existingRefs={ownedRefs()}
          onImported={() => void reload()}
          onClose={() => setShowImport(false)}
        />
      </Show>

      <Show when={showCatalogue()}>
        <section class="catalogue">
          <label for="catalogue-search">Search the tune catalogue</label>
          <input
            id="catalogue-search"
            type="search"
            autocomplete="off"
            placeholder="Name or any alternative title — e.g. butterfly, red admiral…"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <p class="hint">
            <Show
              when={catalogueError()}
              fallback={
                <Show
                  when={searchMs() !== null}
                  fallback={
                    tuneCount() === null
                      ? 'Searches run on this device — no network per keystroke.'
                      : `${tuneCount()!.toLocaleString()} tunes from a local database — no network per keystroke.`
                  }
                >
                  {results().length} {results().length === 1 ? 'match' : 'matches'} ·{' '}
                  {(searchMs() ?? 0).toFixed(1)} ms · searched on this device
                </Show>
              }
            >
              <span>{catalogueError()}</span>
            </Show>
          </p>

          <Show when={!catalogueReady()}>
            <p class="hint">Loading the catalogue (4.5 MB, downloaded once)…</p>
          </Show>

          <Show when={catalogueReady() && query().trim().length > 0}>
            <Show
              when={results().length > 0}
              fallback={
                <p class="hint">{searching() ? 'Searching…' : 'No tune matches that search.'}</p>
              }
            >
              <ul>
                <For each={results()}>
                  {(entry) => {
                    const alias = aliasExcerpt(entry, tokens());
                    const viaAlias = matchedViaAlias(entry, tokens());
                    const owned = () => ownedRefs().has(String(entry.tuneId));
                    return (
                      <li>
                        <div>
                          <p class="cat-title">{normalizeTitle(entry.name)}</p>
                          <p class="cat-meta">
                            {entry.type ?? '—'}
                            {entry.meter ? ` · ${entry.meter}` : ''}
                            <span> · thesession #{entry.tuneId}</span>
                          </p>
                          <Show when={viaAlias && alias}>
                            <p class="cat-meta">
                              Also known as <b>{alias}</b>
                            </p>
                          </Show>
                        </div>
                        <button
                          type="button"
                          class="cat-add"
                          disabled={busyId() === entry.tuneId || owned()}
                          onClick={() => void add(entry)}
                        >
                          {owned()
                            ? 'In repertoire'
                            : busyId() === entry.tuneId
                              ? 'Adding…'
                              : 'Add'}
                        </button>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </Show>

          <Show when={catalogueReady() && query().trim().length === 0}>
            <p class="hint">
              Type a name — or an alternative one. The search looks at titles and at every
              alternative title in the catalogue.
            </p>
          </Show>
        </section>
      </Show>

      {/* Con una banda aislada (?band=…) se oculta el resto de bandas, no la
          barra: sigue diciendo qué se está mirando. */}
      <Show when={effectiveMode() === 'grid'}>
        <div class="sortbar">
          <Show
            when={scopeLabel()}
            fallback={
              <>
                <span class="lbl">Within each level</span>
                <span>Staleness — longest untouched first</span>
              </>
            }
          >
            <span class="lbl">Showing</span>
            <span>{scopeLabel()}</span>
            <button type="button" class="back-to-all" onClick={backToAll}>
              Back to all
            </button>
          </Show>
          <span class="spacer" />
          <span class="heat">
            <i />
            going cold
          </span>
        </div>
      </Show>

      <Show when={effectiveMode() === 'table'}>
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
          {/* Una lista acotada dice de qué es; sin ámbito, es todo el repertorio. */}
          <Show when={scopeLabel()}>
            <span class="lbl">Showing</span>
            <span>{scopeLabel()}</span>
            <button type="button" class="back-to-all" onClick={backToAll}>
              Back to all
            </button>
          </Show>
          <span class="spacer" />
        </div>
      </Show>

      <Show
        when={!loading()}
        fallback={<p class="notice">Loading your repertoire…</p>}
      >
        <Show
          when={rows().length > 0}
          fallback={
            <div class="empty">
              <p>Your repertoire is empty.</p>
              <p>Open the catalogue and add the first tune you want to keep track of.</p>
            </div>
          }
        >
          <Show
            when={effectiveMode() === 'grid'}
            fallback={
              <RepertoireTable
                rows={tableRows()}
                now={now()}
                sortKey={sortKey()}
                sortDirection={sortDirection()}
                onSort={chooseSort}
                onPractise={practise}
                onToggleFavorite={toggleFavorite}
                onStatusChange={changeStatus}
              />
            }
          >
            <For each={visibleGroups()}>
              {(group) => (
                <BandView
                  group={group}
                  now={now()}
                  scoped={scopedBand() === group.band.status}
                  onShowOnly={() => showOnly(group.band.status)}
                  onSeeList={() => seeList(group.band.status)}
                  onPractise={practise}
                />
              )}
            </For>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
