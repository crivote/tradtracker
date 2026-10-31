import { daysSince, normalizeTitle } from './format';

/**
 * Modelo puro del repertorio: tipos, normalización de la fila que devuelve
 * PostgREST y presentación. Sin cliente Supabase, para poder probarlo sin red.
 */

/**
 * Peldaños de capacidad (#29). Sustituyen a la escala de calidad de #11: ya no
 * dicen «cómo de bien la toco» sino «cuánto puedo contar con ella».
 *
 * `aparcada` no está aquí a propósito: aparcar no es una altura de la escalera,
 * es una bandera transversal (`shelved`), y una tune aparcada conserva su
 * peldaño.
 */
export type TuneStatus = 'to_learn' | 'learning' | 'playing_along' | 'solo_ready';

export interface TuneRecord {
  id: string;
  origin: string;
  origin_ref: string | null;
  name: string;
  rhythm: string | null;
  meter: string | null;
  key: string | null;
  abc: string | null;
}

/**
 * Fondo elegido para la tune (issue #31). Vive en la fila del repertorio, no en
 * una tabla aparte: dos usuarios pueden querer imágenes distintas para la misma
 * tune. `null` cuando no hay fondo, y entonces la carta se pinta como antes.
 */
export interface ChosenImage {
  source: 'commons' | 'pexels' | 'upload';
  id: string | null;
  thumbUrl: string | null;
  fullUrl: string | null;
  pageUrl: string | null;
  author: string | null;
  license: string | null;
  licenseUrl: string | null;
  /** Punto focal en % y zoom 1–2,2: el encuadre manual sobre el recorte 5:4. */
  focalX: number;
  focalY: number;
  zoom: number;
  chosenAt: string | null;
}

export interface RepertoireRow {
  id: string;
  status: TuneStatus;
  /** Bandera transversal: la tune está en el cajón, en cualquier peldaño. */
  shelved: boolean;
  /**
   * Palanca de priorización de F6 (listas de ensayo), **no sustituye al
   * `rating`**: el rating dice cómo salió la última práctica, esto solo dice
   * «ponla en la lista de hoy». Convive con `shelved` y con el peldaño.
   */
  favorite: boolean;
  rating: number | null;
  custom_title: string | null;
  custom_rhythm: string | null;
  custom_key: string | null;
  notes: string | null;
  added_at: string;
  last_practiced_at: string | null;
  tune: TuneRecord;
  /** Fondo elegido; null si la tune no tiene imagen todavía. */
  image: ChosenImage | null;
  /**
   * Agregados de la vista `pr_repertoire_stats` (#29). `null` en la cuenta
   * cuando no hay dato: sin vista, sin sesiones. Un `0` sí es un dato —hubo
   * vista y no hubo ensayos— y no se pinta igual.
   */
  practice_count: number | null;
  avg_quality: number | null;
  days_since_last_practice: number | null;
}

/** Una fila de `pr_repertoire_stats`: los agregados de una fila de repertorio. */
export interface RepertoireStats {
  practice_count: number | null;
  avg_quality: number | null;
  days_since_last_practice: number | null;
}

/** Número o null: `avg_quality` llega como cadena porque en la base es numeric. */
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normaliza la fila de la vista. Ausente y null son lo mismo aquí: «no hay
 * dato», que la carta pinta como `no sessions yet` (rama del «no», §4 del
 * issue 29). Nunca se estima.
 */
export function mapStatsRow(row: Record<string, any> | null | undefined): RepertoireStats {
  return {
    practice_count: toNumberOrNull(row?.practice_count),
    avg_quality: toNumberOrNull(row?.avg_quality),
    days_since_last_practice: toNumberOrNull(row?.days_since_last_practice),
  };
}

/** Los valores por defecto son los de la migración 005: centro y 100 %. */
const IMAGE_FOCAL_DEFAULT = 50;
const IMAGE_ZOOM_DEFAULT = 1;

function clampFocalValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return IMAGE_FOCAL_DEFAULT;
  return Math.min(100, Math.max(0, parsed));
}

function clampZoomValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return IMAGE_ZOOM_DEFAULT;
  return Math.min(2.2, Math.max(1, parsed));
}

/**
 * Normaliza las doce columnas de imagen de una fila de PostgREST. Sin
 * `image_thumb_url` no hay fondo que pintar: se devuelve null y la carta queda
 * como estaba (la imagen elegida puede haber quedado sin URL por un borrado
 * manual en la base, y eso no debe romper la rejilla).
 */
export function mapImageRow(row: Record<string, any>): ChosenImage | null {
  const source = row.image_source;
  if (source !== 'commons' && source !== 'pexels' && source !== 'upload') return null;
  if (!row.image_thumb_url) return null;

  return {
    source,
    id: row.image_id ?? null,
    thumbUrl: row.image_thumb_url,
    fullUrl: row.image_full_url ?? row.image_thumb_url,
    pageUrl: row.image_page_url ?? null,
    author: row.image_author ?? null,
    license: row.image_license ?? null,
    licenseUrl: row.image_license_url ?? null,
    focalX: clampFocalValue(row.image_focal_x),
    focalY: clampFocalValue(row.image_focal_y),
    zoom: clampZoomValue(row.image_zoom),
    chosenAt: row.image_chosen_at ?? null,
  };
}

/**
 * PostgREST devuelve la relación embebida como objeto (many-to-one) o como array
 * según la forma del join; aquí se normaliza a un único TuneRecord.
 *
 * `stats` son los agregados de `pr_repertoire_stats` para esta fila. Se pasan
 * aparte porque vienen de otra consulta: la vista no es un destino de join (no
 * hay clave ajena de una tabla a una vista). Sin ellos la fila queda con
 * `practice_count: null`, que es la rama del «no» del issue 29, no un cero.
 */
export function mapRepertoireRow(
  row: Record<string, any>,
  stats?: RepertoireStats | null
): RepertoireRow {
  const embedded = Array.isArray(row.pr_tunes) ? row.pr_tunes[0] : row.pr_tunes;
  if (!embedded) {
    throw new Error(`Repertoire row ${row.id} came back without its tune.`);
  }
  const aggregates = stats ?? mapStatsRow(row);
  return {
    id: row.id,
    status: row.status as TuneStatus,
    shelved: row.shelved === true,
    // Tolerante a propósito: `undefined` (filas anteriores a la migración 008,
    // dobles de test) y `null` significan «no es favorita», igual que `false`.
    favorite: row.favorite === true,
    rating: row.rating ?? null,
    custom_title: row.custom_title ?? null,
    custom_rhythm: row.custom_rhythm ?? null,
    custom_key: row.custom_key ?? null,
    notes: row.notes ?? null,
    added_at: row.added_at,
    last_practiced_at: row.last_practiced_at ?? null,
    tune: embedded as TuneRecord,
    image: mapImageRow(row),
    practice_count: aggregates.practice_count,
    avg_quality: aggregates.avg_quality,
    days_since_last_practice: aggregates.days_since_last_practice,
  };
}

export function displayTitle(item: RepertoireRow): string {
  return item.custom_title?.trim() || normalizeTitle(item.tune.name);
}

/**
 * Crédito del fondo, tal y como se pinta en el detalle: «autor · licencia».
 * La licencia de Commons llega a veces vacía; entonces se enseña solo el autor.
 * El enlace a la ficha lo pone la vista con `image.pageUrl`.
 */
export function imageCredit(image: ChosenImage | null): string {
  if (!image) return '';
  const author = (image.author ?? '').trim() || 'Unknown author';
  const license = (image.license ?? '').trim();
  return license ? `${author} · ${license}` : author;
}

export function displayRhythm(item: RepertoireRow): string {
  return item.custom_rhythm?.trim() || item.tune.rhythm || '—';
}

export function displayKey(item: RepertoireRow): string {
  return item.custom_key?.trim() || item.tune.key || '—';
}

/**
 * Las cuatro bandas de la home (#29), en orden de escalera. Cada una lleva el
 * nombre, la definición que se pinta al lado y el peldaño que enciende el
 * indicador de cuatro barras.
 *
 * **Una sola densidad.** La dirección anterior partía la pantalla en dos —carta
 * grande en las bandas de trabajo, miniatura en las de biblioteca— porque daba
 * por hecho que las bandas grandes se recorrían enteras en la home. No es así:
 * la home enseña como mucho dos filas por banda y el listado completo de un
 * peldaño es una **lista**, no una rejilla (decisión de Víctor, 2026-10-31). Con
 * eso la miniatura se queda sin oficio, y además costaba dos cosas caras: el
 * medidor de calidad desaparecía justo en las bandas con más historial de
 * ensayos, y su kebab de 22 px quedaba por debajo del mínimo táctil de 24.
 */
export interface BandDefinition {
  status: TuneStatus;
  label: string;
  definition: string;
  /** Barras encendidas del indicador, 1–4. */
  rung: number;
}

export const BANDS: readonly BandDefinition[] = [
  {
    status: 'to_learn',
    label: 'To learn',
    definition: 'Want to learn it. Not started.',
    rung: 1,
  },
  {
    status: 'learning',
    label: 'Learning',
    definition: 'Know the parts, but can’t get through it end to end.',
    rung: 2,
  },
  {
    status: 'playing_along',
    label: 'Playing along',
    definition: 'Can follow it when someone else leads.',
    rung: 3,
  },
  {
    status: 'solo_ready',
    label: 'Solo-ready',
    definition: 'If someone asks for a tune, this is one you’d give them.',
    rung: 4,
  },
];

/** La banda de un estado; nunca undefined para un TuneStatus válido. */
export function bandFor(status: TuneStatus): BandDefinition {
  return BANDS.find((band) => band.status === status) ?? BANDS[0];
}

/**
 * Lo que se puede aislar en pantalla: un peldaño o el cajón de aparcadas.
 *
 * El cajón **no** es una banda —no agrupa, no tiene urgencia propia— pero sí se
 * puede mirar entero, y su listado es la única puerta a esas tunes: en la home
 * solo aparece su recuento.
 */
export type RepertoireScope = TuneStatus | 'shelved';

export const SHELVED_SCOPE = 'shelved' as const;

/**
 * El ámbito que llega por la URL (`?band=`), validado. Un valor desconocido o
 * ausente no rompe la pantalla: devuelve null y se ve la home entera.
 */
export function parseScope(raw: unknown): RepertoireScope | null {
  if (typeof raw !== 'string') return null;
  if (raw === SHELVED_SCOPE) return SHELVED_SCOPE;
  return BANDS.some((band) => band.status === raw) ? (raw as TuneStatus) : null;
}

export const STATUS_LABELS: Record<TuneStatus, string> = {
  to_learn: 'To learn',
  learning: 'Learning',
  playing_along: 'Playing along',
  solo_ready: 'Solo-ready',
};

/** Colores de la tabla: sigue siendo la vista oscura de siempre. */
export const STATUS_STYLES: Record<TuneStatus, string> = {
  to_learn: 'bg-sky-900/60 text-sky-300 border-sky-700',
  learning: 'bg-amber-900/60 text-amber-300 border-amber-700',
  playing_along: 'bg-violet-900/60 text-violet-300 border-violet-700',
  solo_ready: 'bg-emerald-900/60 text-emerald-300 border-emerald-700',
};

/**
 * Cuántas tunes hay en cada peldaño; las cuatro claves siempre están.
 *
 * Las aparcadas **no** cuentan: aparcar no cambia el peldaño, así que contarlas
 * aquí daría una cabecera que no cuadra con las bandas, que tampoco las pintan.
 * Su recuento vive en la sección «Shelved» del final de la home.
 */
export function statusCounts(rows: readonly RepertoireRow[]): Record<TuneStatus, number> {
  const counts: Record<TuneStatus, number> = {
    to_learn: 0,
    learning: 0,
    playing_along: 0,
    solo_ready: 0,
  };
  for (const row of rows) {
    if (row.shelved) continue;
    if (row.status in counts) counts[row.status] += 1;
  }
  return counts;
}

/**
 * Recencia del último ensayo (#7, corte 2). La card enseñaba la fecha; para
 * decidir qué ensayar lo útil son los días. Se calcula sobre el instante `now`
 * de la vista para que el resultado sea determinista en los tests.
 */
export interface PracticeRecency {
  /** Días enteros desde el último ensayo; null si nunca se ensayó. */
  days: number | null;
  /** Texto listo para pintar (en inglés, como el resto de la UI). */
  label: string;
}

export function practiceRecency(row: RepertoireRow, now: number): PracticeRecency {
  const days = daysSince(row.last_practiced_at, now);
  if (days === null) return { days: null, label: 'Never practiced' };
  if (days === 0) return { days, label: 'Practiced today' };
  if (days === 1) return { days, label: '1 day ago' };
  return { days, label: `${days} days ago` };
}

/**
 * Iniciales del título mostrado para el cuadro mnemotécnico de la card, máximo
 * dos y en mayúsculas. Se toma la primera letra de cada palabra: «Kesh, The» se
 * muestra como «The Kesh», así que da «TK». Sin letras en el título, «?».
 */
export function placeholderInitials(row: RepertoireRow): string {
  const words = displayTitle(row).split(/\s+/);
  const initials: string[] = [];
  for (const word of words) {
    const letter = word.match(/\p{L}/u);
    if (!letter) continue;
    initials.push(letter[0]);
    if (initials.length === 2) break;
  }
  return initials.length > 0 ? initials.join('').toUpperCase() : '?';
}

/** Campos cuyo valor viene de un override personal y no del tune compartido. */
export interface OverrideFields {
  title: boolean;
  rhythm: boolean;
  key: boolean;
}

/** Un override cuenta solo si tiene texto: un `custom_key` vacío no lo es. */
function hasText(value: string | null): boolean {
  return (value ?? '').trim().length > 0;
}

/**
 * Marca de overrides (F2): el detalle enseña de dónde sale cada valor. La card
 * no los marca; este corte solo los distingue en `/repertoire/:id`.
 */
export function overrideFields(row: RepertoireRow): OverrideFields {
  return {
    title: hasText(row.custom_title),
    rhythm: hasText(row.custom_rhythm),
    key: hasText(row.custom_key),
  };
}

/**
 * Clave del orden alfabético: minúsculas y sin diacríticos. Se compara por code
 * unit (sin localeCompare): la ICU del navegador sería un resultado no
 * determinista entre entornos. «Ángel» y «Oro» se comparan como «angel»/«oro».
 */
export function collationKey(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '');
}

export type SortKey = 'urgency' | 'alphabetical' | 'added' | 'rating';

/** Etiquetas del selector de orden, para ambas vistas. */
export const SORT_LABELS: Record<SortKey, string> = {
  urgency: 'Urgency',
  alphabetical: 'A to Z',
  added: 'Recently added',
  rating: 'Rating',
};

/** Comparación de cadenas por code unit: -1, 0 o 1. Determinista en cualquier runtime. */
function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Desempate común de todos los criterios: título mostrado y, en última
 * instancia, el id de la fila. Dos filas con la misma clave quedan siempre en
 * el mismo orden relativo, sea cual sea el orden en que lleguen.
 */
function tieBreak(left: RepertoireRow, right: RepertoireRow): number {
  const byTitle = compareStrings(
    collationKey(displayTitle(left)),
    collationKey(displayTitle(right))
  );
  if (byTitle !== 0) return byTitle;
  return compareStrings(left.id, right.id);
}

/** Último ensayo como instante; null si nunca se ensayó o la fecha es inválida. */
function practiceTime(row: RepertoireRow): number | null {
  if (row.last_practiced_at === null) return null;
  const time = new Date(row.last_practiced_at).getTime();
  return Number.isNaN(time) ? null : time;
}

/** Fecha de alta como instante; 0 si la fecha es inválida. */
function addedTime(row: RepertoireRow): number {
  const time = new Date(row.added_at).getTime();
  return Number.isNaN(time) ? 0 : time;
}

const SORT_COMPARATORS: Record<SortKey, (left: RepertoireRow, right: RepertoireRow) => number> = {
  /**
   * Urgencia: primero los nunca ensayados; después los más antiguos de
   * `last_practiced_at` primero (más días sin practicar). Los nunca ensayados
   * no se ordenan entre sí por fecha: no tienen ninguna, quedan juntos y los
   * desempata el título.
   */
  urgency: (left, right) => {
    const leftTime = practiceTime(left);
    const rightTime = practiceTime(right);
    if (leftTime === null || rightTime === null) {
      if (leftTime === rightTime) return tieBreak(left, right);
      return leftTime === null ? -1 : 1;
    }
    if (leftTime !== rightTime) return leftTime - rightTime;
    return tieBreak(left, right);
  },
  /** Alfabético por `displayTitle`, sin distinguir mayúsculas ni acentos. */
  alphabetical: (left, right) => tieBreak(left, right),
  /** Fecha de alta: la más reciente primero, como ordena ya la consulta. */
  added: (left, right) => {
    const leftTime = addedTime(left);
    const rightTime = addedTime(right);
    if (leftTime !== rightTime) return rightTime - leftTime;
    return tieBreak(left, right);
  },
  /** Rating descendente; los null van al final. */
  rating: (left, right) => {
    const leftRating = left.rating ?? Number.NEGATIVE_INFINITY;
    const rightRating = right.rating ?? Number.NEGATIVE_INFINITY;
    if (leftRating !== rightRating) return rightRating - leftRating;
    return tieBreak(left, right);
  },
};

/**
 * Devuelve una copia ordenada, sin mutar la de entrada. El comparador lleva
 * desempate propio, así que el resultado no depende del orden de la consulta.
 */
export function sortRepertoire(rows: readonly RepertoireRow[], key: SortKey): RepertoireRow[] {
  return [...rows].sort(SORT_COMPARATORS[key]);
}

/** Modo de presentación del repertorio: la tabla clásica o las tarjetas. */
export type ViewMode = 'table' | 'grid';

/** Clave en `sessionStorage`: vive en la pestaña, sin tocar la base de datos. */
export const VIEW_MODE_KEY = 'tradtracker.repertoire-view';

/**
 * Tolerante a basura en el almacenamiento: solo «table» opta por la tabla. La
 * vista por defecto es el grid de tarjetas, como pide la issue #7.
 */
export function parseViewMode(raw: string | null): ViewMode {
  return raw === 'table' ? 'table' : 'grid';
}

/* ────────────────────────────────────────────────────────────────
 * Home del repertorio (#29): staleness, medidor, bandas y topes.
 * Todo puro y con el instante inyectado: el navegador no calcula
 * nada dentro del JSX y las pruebas no dependen del reloj.
 * ──────────────────────────────────────────────────────────────── */

/** El tag satura a los 90 días; más allá no aporta información nueva. */
export const STALENESS_SATURATION_DAYS = 90;

/** Papel del tag a cero días y teja a los 90 (la paleta del boceto). */
export const STALENESS_FROM: readonly [number, number, number] = [246, 240, 227];
export const STALENESS_TO: readonly [number, number, number] = [186, 95, 62];

/**
 * Días sin ensayar de una fila: `never` es null. Se derivan de
 * `last_practiced_at` (la columna que mantiene el trigger de sesiones) para que
 * el resultado sea determinista con el `now` inyectado; si la fila no trae la
 * fecha pero la vista sí trae los días, se usa el de la base como respaldo.
 */
export function stalenessDays(row: RepertoireRow, now: number): number | null {
  if (row.last_practiced_at) return daysSince(row.last_practiced_at, now);
  return row.days_since_last_practice ?? null;
}

/** El tag tal y como se lee: `never`, `today`, `1 day`, `41 days`. */
export interface StalenessTag {
  days: number | null;
  /** Parte que va en negrita (el número) o el texto suelto. */
  value: string;
  /** `day`/`days` cuando hay número; null en `never` y `today`. */
  unit: 'day' | 'days' | null;
}

export function stalenessTag(days: number | null): StalenessTag {
  if (days === null) return { days: null, value: 'never', unit: null };
  if (days === 0) return { days: 0, value: 'today', unit: null };
  if (days === 1) return { days: 1, value: '1', unit: 'day' };
  return { days, value: String(days), unit: 'days' };
}

/** Texto del `title` del tag: dice lo mismo, con palabras. */
export function stalenessTitle(tag: StalenessTag): string {
  if (tag.days === null) return 'Never practiced';
  if (tag.days === 0) return 'Practiced today';
  if (tag.days === 1) return 'Last practiced 1 day ago';
  return `Last practiced ${tag.days} days ago`;
}

/**
 * Intensidad del gradiente de abandono: `sqrt(min(días, 90) / 90)`. La raíz es
 * deliberada —con escala lineal, 3 y 12 días caían en el mismo tono y el
 * gradiente no se leía—. Nunca tocada va al extremo cálido.
 */
export function stalenessIntensity(days: number | null): number {
  if (days === null) return 1;
  const clamped = Math.min(Math.max(days, 0), STALENESS_SATURATION_DAYS);
  return Math.sqrt(clamped / STALENESS_SATURATION_DAYS);
}

export interface StalenessColor {
  /** 0 = recién tocada, 1 = nunca tocada o 90+ días. */
  intensity: number;
  background: string;
  foreground: string;
}

/**
 * Color del tag interpolado en sRGB entre papel y teja. El texto pasa a blanco
 * cuando el fondo ya es oscuro (por encima de 0,55), el mismo umbral del
 * boceto.
 */
export function stalenessColor(days: number | null): StalenessColor {
  const intensity = stalenessIntensity(days);
  const channels = STALENESS_FROM.map((from, index) =>
    Math.round(from + (STALENESS_TO[index] - from) * intensity)
  );
  return {
    intensity,
    background: `rgb(${channels.join(',')})`,
    foreground: intensity > 0.55 ? '#ffffff' : '#3c3428',
  };
}

/** Cinco posiciones del medidor: llena, media o vacía. */
export type MeterDot = 'on' | 'half' | 'off';

/**
 * Reparto de la media en cinco puntos con medio punto posible: el umbral es el
 * del boceto (≥ 0,75 lleno, ≥ 0,25 medio). Una media de 2,5 da dos llenos, uno
 * a medias y dos vacíos.
 */
export function qualityDots(avg: number | null): MeterDot[] {
  if (avg === null) return [];
  return Array.from({ length: 5 }, (_, index) => {
    const fraction = avg - index;
    if (fraction >= 0.75) return 'on';
    if (fraction >= 0.25) return 'half';
    return 'off';
  });
}

export interface PracticeSummary {
  dots: MeterDot[];
  text: string;
  /** Sin ensayos o sin dato: el texto va en itálica, sin medidor. */
  empty: boolean;
}

/**
 * `4.2 avg · 8 practices`, o `no sessions yet`. Sin dato de la vista
 * (`practice_count` null) se dice lo mismo que sin ensayos: la rama del «no»
 * del issue prohíbe estimar. Con ensayos pero ninguno puntuado no se dibuja
 * medidor (sería un cero falso) y se dice cuántos fueron.
 */
export function practiceSummary(row: RepertoireRow): PracticeSummary {
  const count = row.practice_count;
  if (count === null || count <= 0) {
    return { dots: [], text: 'no sessions yet', empty: true };
  }
  const practices = `${count} ${count === 1 ? 'practice' : 'practices'}`;
  if (row.avg_quality === null) {
    return { dots: [], text: practices, empty: true };
  }
  return {
    dots: qualityDots(row.avg_quality),
    text: `${row.avg_quality.toFixed(1)} avg · ${practices}`,
    empty: false,
  };
}

/**
 * Orden dentro de una banda: nunca tocada primero; después, más días sin
 * ensayar primero. Empate estable por título mostrado (colación sin
 * diacríticos) y, en última instancia, por id.
 */
export function compareStaleness(left: RepertoireRow, right: RepertoireRow, now: number): number {
  const leftDays = stalenessDays(left, now);
  const rightDays = stalenessDays(right, now);
  if (leftDays === null || rightDays === null) {
    if (leftDays === rightDays) return tieBreak(left, right);
    return leftDays === null ? -1 : 1;
  }
  if (leftDays !== rightDays) return rightDays - leftDays;
  return tieBreak(left, right);
}

/** Una banda con sus filas ya ordenadas por staleness. */
export interface BandGroup {
  band: BandDefinition;
  rows: RepertoireRow[];
}

/**
 * Las cuatro bandas en orden de escalera, cada una ordenada por staleness.
 *
 * Las aparcadas quedan fuera de las cuatro bandas: una tune en el cajón no está
 * en rotación y encabezar «To learn» por no haberla tocado nunca es justo el
 * defecto que corrige #11. Conservan su peldaño y se pintan en su propia
 * sección al final de la home (`visibleShelved`).
 */
export function groupIntoBands(rows: readonly RepertoireRow[], now: number): BandGroup[] {
  return BANDS.map((band) => ({
    band,
    rows: rows
      .filter((row) => !row.shelved && row.status === band.status)
      .sort((left, right) => compareStaleness(left, right, now)),
  }));
}

/**
 * Coincidencia parcial sobre el título mostrado (incluye el título personal),
 * sin mayúsculas ni diacríticos. Con término vacío devuelve `true`: el
 * «vacío» lo decide quien llama, no esta función.
 */
export function matchesQuery(row: RepertoireRow, term: string): boolean {
  const needle = collationKey(term.trim());
  if (needle.length === 0) return true;
  return collationKey(displayTitle(row)).includes(needle);
}

/**
 * Orden de los resultados de la búsqueda (#9): alfabético por título mostrado y,
 * a igual título, por ritmo. Es una consulta, no una cola de trabajo: el orden
 * por abandono de la home no pinta aquí. Cierra con el id para que dos filas
 * idénticas queden siempre en el mismo orden relativo.
 */
function compareSearchOrder(left: RepertoireRow, right: RepertoireRow): number {
  const byTitle = compareStrings(
    collationKey(displayTitle(left)),
    collationKey(displayTitle(right))
  );
  if (byTitle !== 0) return byTitle;
  const byRhythm = compareStrings(
    collationKey(displayRhythm(left)),
    collationKey(displayRhythm(right))
  );
  if (byRhythm !== 0) return byRhythm;
  return compareStrings(left.id, right.id);
}

/**
 * Búsqueda del repertorio (#9).
 *
 * Cruza **todas** las filas que recibe —todos los peldaños y también las
 * aparcadas—: es una consulta sobre el repertorio entero, no un filtro de la
 * home. Filtra por título cuando hay texto y por ritmo cuando hay ritmo; los dos
 * criterios se suman. Con **los dos vacíos devuelve `[]`**: la vista arranca sin
 * cartas y no enseña el repertorio entero (decisión 3 del brief).
 *
 * `rhythm` llega como `string | null` para que «todos los ritmos» no se confunda
 * con la cadena vacía, que sí podría ser un valor de `displayRhythm`.
 */
export function searchRepertoire(
  rows: readonly RepertoireRow[],
  term: string,
  rhythm: string | null
): RepertoireRow[] {
  const hasTerm = term.trim().length > 0;
  if (!hasTerm && rhythm === null) return [];
  // El ritmo se compara **sin mayúsculas ni diacríticos**, igual que lo
  // deduplica `rhythmOptions`: comparar el texto exacto escondería la mitad de
  // las filas de una opción que el selector ofrece como una sola («Reel» y
  // «reel» conviven en el repertorio en cuanto uno se escribe a mano).
  const wanted = rhythm === null ? null : collationKey(rhythm);
  return rows
    .filter(
      (row) =>
        (!hasTerm || matchesQuery(row, term)) &&
        (wanted === null || collationKey(displayRhythm(row)) === wanted)
    )
    .sort(compareSearchOrder);
}

/**
 * Los ritmos que hay en el repertorio cargado, para el `<select>` de la búsqueda
 * (#9): distintos, deduplicados por `collationKey` —«Reel» y «reel» son el mismo
 * ritmo— y ordenados con el mismo criterio que los resultados. Se queda el
 * primer texto visto de cada uno, que es el que el usuario reconoce.
 */
export function rhythmOptions(rows: readonly RepertoireRow[]): string[] {
  const byKey = new Map<string, string>();
  for (const row of rows) {
    const label = displayRhythm(row);
    const key = collationKey(label);
    if (!byKey.has(key)) byKey.set(key, label);
  }
  return [...byKey.entries()]
    .sort((left, right) => compareStrings(left[0], right[0]))
    .map(([, label]) => label);
}

/**
 * Cuántas tunes están en el cajón (`shelved`). Va aparte de `statusCounts`
 * porque aparcar no es un peldaño: la cabecera de la home necesita los dos
 * números para que el total del repertorio sea la suma de sus partes (las cuatro
 * bandas más el cajón) y no un total que no cuadra con lo que se pinta debajo.
 */
export function shelvedCount(rows: readonly RepertoireRow[]): number {
  let count = 0;
  for (const row of rows) if (row.shelved) count += 1;
  return count;
}

/**
 * Las aparcadas, para el cajón del final de la home (#11). El orden es el mismo
 * de dentro de las bandas —nunca tocada primero, después las más abandonadas—
 * y el buscador de la home también manda aquí: con texto solo vuelven las que
 * casan, y sin coincidencias la lista va vacía y la sección no se pinta.
 *
 * Aparcar no cambia el peldaño, así que la fila conserva el suyo y la sección
 * no agrupa: es un cajón, no una quinta banda.
 */
export function visibleShelved(
  rows: readonly RepertoireRow[],
  term: string,
  now: number
): RepertoireRow[] {
  return rows
    .filter((row) => row.shelved && matchesQuery(row, term))
    .sort((left, right) => compareStaleness(left, right, now));
}

/** Tope de dos filas: depende de las columnas reales, no de un número fijo. */
export function capForColumns(columns: number): number {
  if (!Number.isFinite(columns) || columns < 1) return 0;
  return Math.floor(columns) * 2;
}

/** Las filas que se pintan con un tope (o sin tope, con `Infinity`). */
export function capRows<T>(rows: readonly T[], limit: number): T[] {
  if (!Number.isFinite(limit)) return [...rows];
  return rows.slice(0, Math.max(0, limit));
}

/**
 * Tonalidad de la carta: null cuando no hay ninguna, para que la vista escriba
 * `key not set` en vez de un guion. La tabla sigue usando `displayKey`.
 */
export function cardKey(row: RepertoireRow): string | null {
  const key = (row.custom_key?.trim() || row.tune.key || '').trim();
  return key.length > 0 ? key : null;
}
