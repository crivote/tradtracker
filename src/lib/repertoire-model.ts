import { daysSince, daysSinceDay, normalizeTitle, parseLocalDay } from './format';

/**
 * Modelo puro del repertorio: tipos, normalización de la fila que devuelve
 * PostgREST y presentación. Sin cliente Supabase, para poder probarlo sin red.
 */

/**
 * Peldaños de capacidad (#29, quinta en #46, cima en #50). Ya no dicen «cómo de
 * bien la toco» sino «cuánto puedo contar con ella».
 *
 * `to_learn` **no es un peldaño**: es el **backlog** —una lista de deseos de
 * piezas que aún no se han empezado— y vive fuera de `BANDS`, del generador y
 * del recuento de la escalera (#50). Sigue siendo un valor de la columna porque
 * es el default del alta y hay que poder volver a él.
 *
 * `shelved` tampoco está aquí a propósito: aparcar no es una altura de la
 * escalera, es una bandera transversal, y una tune aparcada conserva su peldaño.
 */
export type TuneStatus =
  | 'to_learn'
  | 'learning'
  | 'shaky'
  | 'playing_along'
  | 'solo_ready'
  | 'mastered';

/** Los peldaños de verdad: todo lo que no es el backlog. */
export type LadderStatus = Exclude<TuneStatus, 'to_learn'>;

/** `true` para los peldaños; `false` para el backlog. Guarda de tipo. */
export function isLadderStatus(status: TuneStatus): status is LadderStatus {
  return status !== 'to_learn';
}

export interface TuneRecord {
  id: string;
  origin: string;
  origin_ref: string | null;
  name: string;
  rhythm: string | null;
  meter: string | null;
  key: string | null;
  abc: string | null;
  /**
   * Autor de la pieza (#44, migración 010), tal y como lo trae el catálogo.
   * `null` en el 72 % del repertorio —tradicional sin autor conocido— y ahí el
   * subtexto de la fila **omite** la parte del autor: nunca «trad.» ni un guion.
   */
  composer: string | null;
}

/**
 * Fondo elegido para la tune (issue #31). Vive en la fila del repertorio, no en
 * una tabla aparte: dos usuarios pueden querer imágenes distintas para la misma
 * tune. `null` cuando no hay fondo, y entonces la carta se pinta como antes.
 */
export interface ChosenImage {
  source: 'commons' | 'pexels' | 'artic' | 'upload';
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
  /**
   * ABC propio de la fila (columna `custom_abc`, migración 001). Manda sobre el
   * del catálogo compartido: es la corrección deliberada del usuario, y es lo
   * que el reproductor de `/practice` (#38) toca antes de pedir nada a la red.
   */
  customAbc: string | null;
  notes: string | null;
  added_at: string;
  /**
   * Último día ensayado, `YYYY-MM-DD` **local** (columna `last_practiced_day`,
   * migración 017). Es un día, no un instante: la antigüedad de la tune es una
   * resta de días locales y no lleva husos. Lo mantiene el trigger de
   * `pr_practice`, avanzando y nunca retrocediendo; el cliente no lo escribe.
   * `null` = nunca ensayada (o el dato no vino).
   */
  last_practiced_day: string | null;
  /**
   * Instante del último cambio de peldaño (#52). Lo mantiene el trigger
   * `pr_repertoire_touch_trg` y **solo** avanza cuando cambia `status`: aparcar
   * no lo mueve, y el cliente nunca lo escribe. Es el reloj del banco de
   * trabajo: en `learning` lo que se mide no es el abandono sino el **dwell**.
   * `null` = el dato no vino (fila anterior al corte, doble de test); no se
   * sustituye por `added_at` ni por un cero.
   */
  status_changed_at: string | null;
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

/** Texto con contenido o `null`: «sin dato» es una sola cosa, no tres. */
function toTextOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
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
  if (source !== 'commons' && source !== 'pexels' && source !== 'artic' && source !== 'upload') {
    return null;
  }
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
    // Tolerante: la columna existe desde la migración 001, pero una fila de
    // antes del corte que la pide (#38) o un doble de test pueden no traerla.
    // Solo un texto es un ABC; `undefined` y `null` son «no hay».
    customAbc: typeof row.custom_abc === 'string' ? row.custom_abc : null,
    notes: row.notes ?? null,
    added_at: row.added_at,
    // Día local `YYYY-MM-DD` o nada: un doble de test, una fila anterior a la
    // migración 017 o un `undefined` son lo mismo —nunca ensayada—, no `NaN`.
    last_practiced_day: typeof row.last_practiced_day === 'string' ? row.last_practiced_day : null,
    status_changed_at: typeof row.status_changed_at === 'string' ? row.status_changed_at : null,
    // El autor viaja en la relación embebida (#44) y se normaliza aquí: una fila
    // anterior a la migración 010, un doble de test o un `composer` vacío son lo
    // mismo —no hay autor— y la fila que lo lea no puede recibir `undefined`.
    tune: { ...(embedded as TuneRecord), composer: toTextOrNull(embedded.composer) },
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
 * Los invariantes de la pieza —tipo · compás · autor— tal y como van bajo el
 * título del listado (#42). `null` en lo que falte: la fila **omite** la parte
 * que no tiene y nunca pinta un guion, porque un guion ahí se lee como un dato.
 * El compás y el autor no tienen override personal; el tipo sí.
 */
export interface RowInvariants {
  rhythm: string | null;
  meter: string | null;
  composer: string | null;
}

export function rowInvariants(row: RepertoireRow): RowInvariants {
  const text = (value: string | null | undefined): string | null => {
    const trimmed = (value ?? '').trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  return {
    rhythm: text(row.custom_rhythm) ?? text(row.tune.rhythm),
    meter: text(row.tune.meter),
    composer: text(row.tune.composer),
  };
}

/**
 * Los invariantes de la pieza en una línea (`Reel · 4/4 · Tommy Coen`), sin
 * rellenos: lo que falta se omite igual que en la tabla (#42). Lo pide el banco
 * de trabajo (#52), donde la fila es de una sola línea y no cabe la composición
 * en tres nodos.
 */
export function invariantsText(row: RepertoireRow): string {
  const parts = rowInvariants(row);
  return [parts.rhythm, parts.meter, parts.composer]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

/** Barras encendidas del icono de peldaño (1–5), desde `bandFor`. */
export function rungOf(row: RepertoireRow): number {
  return bandFor(row.status).rung;
}

/**
 * Nombre accesible del icono de peldaño: la etiqueta y su definición, el mismo
 * texto del `title`. El `title` **no** es un nombre accesible, así que quien
 * pinte el icono tiene que llevar los dos y actualizarlos a la vez.
 */
export function levelText(row: RepertoireRow): string {
  const band = bandFor(row.status);
  return `${band.label} — ${band.definition}`;
}

/**
 * Las cinco bandas de la home (#29, cuarta en #46, cima en #50), en orden de
 * escalera. Cada una lleva el nombre, la definición que se pinta al lado y el
 * peldaño que enciende el indicador de barras.
 *
 * El **backlog no está aquí**: `to_learn` no es una banda (#50). Su recuento vive
 * en la cabecera y su listado es un ámbito propio, como el cajón de aparcadas.
 *
 * **Una sola densidad.** La dirección anterior partía la pantalla en dos —carta
 * grande en las bandas de trabajo, miniatura en las de biblioteca— porque daba
 * por hecho que las bandas grandes se recorrían enteras en la home. No es así:
 * la home enseña como mucho **tres** filas por banda (#46) y el listado completo
 * de un peldaño es una **lista**, no una rejilla (decisión de Víctor,
 * 2026-10-31). Con
 * eso la miniatura se queda sin oficio, y además costaba dos cosas caras: el
 * medidor de calidad desaparecía justo en las bandas con más historial de
 * ensayos, y su kebab de 22 px quedaba por debajo del mínimo táctil de 24.
 */
export interface BandDefinition {
  status: TuneStatus;
  label: string;
  definition: string;
  /** Barras encendidas del indicador, 1–5. */
  rung: number;
}

export const BANDS: readonly BandDefinition[] = [
  {
    status: 'learning',
    label: 'Learning',
    definition: 'Know the parts, but can’t get through it end to end.',
    rung: 1,
  },
  {
    // El peldaño que faltaba (#46): la pieza se sabe de arriba abajo —no es
    // «learning», que no la pasa entera— pero hay fragmentos que no salen o
    // donde el ritmo se va. Va **antes** de «Playing along» a propósito: seguir
    // a otro es más fácil que sacarla uno solo con agujeros.
    status: 'shaky',
    label: 'Shaky',
    definition:
      'Get through it, but some passages don’t come out or the rhythm slips.',
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
    definition: 'Play it unaided and correctly — no one else needed.',
    rung: 4,
  },
  {
    // La cima (#50): no es «solo y correcta», eso ya lo dice solo_ready. Es la
    // pieza con la que uno se luce —variaciones, adornos, recursos expresivos—,
    // y por eso se practica para mantener, no para sostener.
    status: 'mastered',
    label: 'Mastered',
    definition: 'Improvise variations and ornament it — a tune you can show off with.',
    rung: 5,
  },
];

/**
 * El backlog: no es una banda, pero hace falta su ficha para pintar una fila
 * (`bandFor`) y para ofrecerlo como opción en los selectores de nivel.
 *
 * `rung: 0` es deliberado: el indicador de barras no enciende ninguna, porque no
 * está en la escalera. `to_learn` cae aquí y **nunca** entra en `BANDS`, que es
 * lo que lo mantiene fuera de la home, del generador y del recuento (#50).
 */
export const BACKLOG_BAND: BandDefinition = {
  status: 'to_learn',
  label: 'To learn',
  definition: 'Want to learn it. Not started — the backlog.',
  rung: 0,
};

/** Las barras del indicador de peldaño, de la primera a la cima. */
export const RUNG_BARS = [1, 2, 3, 4, 5] as const;

/**
 * Las bandas de la **biblioteca**: las que se miran como «qué puedo tocar esta
 * noche». `learning` queda fuera porque tiene pantalla propia (`/learning`): es
 * un banco de trabajo con su reloj —el dwell— y su tope, no una estantería más.
 *
 * La home itera esta lista, no `BANDS`: si alguien devuelve `learning` a las
 * bandas, volvería a competir con las cartas de los otros niveles.
 */
export const LIBRARY_BANDS: readonly BandDefinition[] = BANDS.filter(
  (band) => band.status !== 'learning'
);

/**
 * Lo que se puede elegir en un selector de nivel: el backlog primero (para
 * volver a él y para enseñar el estado actual de una pieza sin empezar) y
 * después los cinco peldaños.
 */
export const LEVEL_OPTIONS: readonly BandDefinition[] = [BACKLOG_BAND, ...BANDS];

/** La banda de un estado: el backlog tiene la suya, `rung: 0`; nunca undefined. */
export function bandFor(status: TuneStatus): BandDefinition {
  if (status === 'to_learn') return BACKLOG_BAND;
  // Un valor que no conocemos no se disfraza de peldaño: cae al backlog, que es
  // «no está en la escalera» y no afirma nada falso.
  return BANDS.find((band) => band.status === status) ?? BACKLOG_BAND;
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
 * El backlog como ámbito: `/level/to_learn`. No es una banda (#50), pero se
 * puede mirar entero y su listado es la puerta a «Start learning».
 */
export const BACKLOG_SCOPE = 'to_learn' as const;

/**
 * El ámbito que llega por el camino de la URL (`/level/:band`), validado. Un
 * valor desconocido no rompe la pantalla: devuelve null y el listado redirige a
 * la home.
 */
export function parseScope(raw: unknown): RepertoireScope | null {
  if (typeof raw !== 'string') return null;
  if (raw === SHELVED_SCOPE) return SHELVED_SCOPE;
  if (raw === BACKLOG_SCOPE) return BACKLOG_SCOPE;
  return BANDS.some((band) => band.status === raw) ? (raw as TuneStatus) : null;
}

export const STATUS_LABELS: Record<TuneStatus, string> = {
  to_learn: 'To learn',
  learning: 'Learning',
  shaky: 'Shaky',
  playing_along: 'Playing along',
  solo_ready: 'Solo-ready',
  mastered: 'Mastered',
};

/** Colores de la tabla: sigue siendo la vista oscura de siempre. */
export const STATUS_STYLES: Record<TuneStatus, string> = {
  to_learn: 'bg-sky-900/60 text-sky-300 border-sky-700',
  learning: 'bg-amber-900/60 text-amber-300 border-amber-700',
  shaky: 'bg-orange-900/60 text-orange-300 border-orange-700',
  playing_along: 'bg-violet-900/60 text-violet-300 border-violet-700',
  solo_ready: 'bg-emerald-900/60 text-emerald-300 border-emerald-700',
  mastered: 'bg-rose-900/60 text-rose-300 border-rose-700',
};

/**
 * Cuántas tunes hay en cada peldaño; las seis claves siempre están.
 *
 * `to_learn` se cuenta aquí porque la cabecera lo nombra, pero **no es un
 * peldaño**: es el backlog, y su recuento es la puerta a su listado (#50).
 *
 * Las aparcadas **no** cuentan: aparcar no cambia el peldaño, así que contarlas
 * aquí daría una cabecera que no cuadra con las bandas, que tampoco las pintan.
 * Su recuento vive en la sección «Shelved» del final de la home.
 */
export function statusCounts(rows: readonly RepertoireRow[]): Record<TuneStatus, number> {
  const counts: Record<TuneStatus, number> = {
    to_learn: 0,
    learning: 0,
    shaky: 0,
    playing_along: 0,
    solo_ready: 0,
    mastered: 0,
  };
  for (const row of rows) {
    if (row.shelved) continue;
    if (row.status in counts) counts[row.status] += 1;
  }
  return counts;
}

/** Las no aparcadas que están en el backlog: lo que aún no se ha empezado. */
export function backlogCount(rows: readonly RepertoireRow[]): number {
  let count = 0;
  for (const row of rows) {
    if (!row.shelved && row.status === 'to_learn') count += 1;
  }
  return count;
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
  const days = daysSinceDay(row.last_practiced_day, now);
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

/** Campo de la fila que se puede sobreescribir y revertir al estándar (F2, #8). */
export type OverrideField = 'title' | 'rhythm' | 'key' | 'abc';

/** Campos cuyo valor viene de un override personal y no del tune compartido. */
export interface OverrideFields {
  title: boolean;
  rhythm: boolean;
  key: boolean;
  /** ABC propio de la fila (#8): decide si el formulario enseña «Use standard». */
  abc: boolean;
}

/**
 * Los cuatro campos con override, en el orden en que los enseña el formulario.
 * El nombre es el del modelo (`title`), nunca el de la columna: el mapeo a
 * `custom_*` vive en el adaptador (`repertoire.ts`).
 */
export const OVERRIDE_FIELDS: readonly OverrideField[] = ['title', 'rhythm', 'key', 'abc'];

/**
 * Texto con contenido, o `null`. Un override de espacios no es un override: se
 * guarda `null`, que es exactamente «volver al estándar», y no una cadena vacía
 * que pintaría el campo en blando sin enseñar el valor del catálogo.
 */
export function normalizeOverride(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Valores iniciales del formulario de overrides (#8): el override si lo hay,
 * cadena vacía si no. **El estándar no se precarga**: se enseña como
 * placeholder, de modo que un campo vacío significa «usar el del catálogo» y no
 * hay que distinguir «igual que el estándar» de «sin override».
 */
export function customDrafts(row: RepertoireRow): Record<OverrideField, string> {
  return {
    title: row.custom_title ?? '',
    rhythm: row.custom_rhythm ?? '',
    key: row.custom_key ?? '',
    abc: row.customAbc ?? '',
  };
}

/**
 * Borradores con un `patch` ya escrito aplicado encima (`null` → campo vacío).
 *
 * Existe porque tras una escritura hay que **normalizar el borrador**: si el
 * usuario teclea ` Kesh ` y se guarda `Kesh`, dejar el borrador con espacios
 * mantendría el botón «Save» armado para siempre, reescribiendo lo mismo en cada
 * pulsación. Y al revés, no se puede resiembrar el formulario entero: eso borraría
 * lo que el usuario tenga tecleado en **otro** campo.
 */
export function applyPatchToDrafts(
  drafts: Record<OverrideField, string>,
  patch: Partial<Record<OverrideField, string | null>>
): Record<OverrideField, string> {
  const next = { ...drafts };
  for (const field of OVERRIDE_FIELDS) {
    if (!(field in patch)) continue;
    next[field] = patch[field] ?? '';
  }
  return next;
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
    abc: hasText(row.customAbc),
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

/**
 * Criterios de orden. `urgency` es el de la tabla por defecto —nunca ensayada
 * primero, después la más abandonada— y las tres últimas claves son las
 * columnas nuevas del listado (#42): peldaño, ensayos y media.
 */
export type SortKey =
  | 'urgency'
  | 'alphabetical'
  | 'added'
  | 'rating'
  | 'level'
  | 'practices'
  | 'quality';

/** Etiquetas del selector de orden, para ambas vistas. */
export const SORT_LABELS: Record<SortKey, string> = {
  urgency: 'Urgency',
  alphabetical: 'A to Z',
  added: 'Recently added',
  rating: 'Rating',
  level: 'Level',
  practices: 'Practices',
  quality: 'Average',
};

/** Sentido de un orden, tal y como lo dice la cabecera ordenable. */
export type SortDirection = 'asc' | 'desc';

/**
 * El sentido con el que cada criterio se lee **por defecto**, que es el que
 * enciende la flecha al abrir la tabla: la columna de título va de la A a la Z
 * y las demás empiezan por el valor alto (más ensayos, peldaño más alto, alta
 * más reciente, la más abandonada). Un segundo clic invierte desde aquí.
 */
export const SORT_DEFAULT_DIRECTION: Record<SortKey, SortDirection> = {
  urgency: 'desc',
  alphabetical: 'asc',
  added: 'desc',
  rating: 'desc',
  level: 'desc',
  practices: 'desc',
  quality: 'desc',
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
  if (row.last_practiced_day === null) return null;
  // `parseLocalDay`, no `Date.parse`: la fecha es un día local y el constructor
  // de cadenas la leería como UTC medianoche.
  const time = parseLocalDay(row.last_practiced_day);
  return Number.isNaN(time) ? null : time;
}

/** Fecha de alta como instante; 0 si la fecha es inválida. */
function addedTime(row: RepertoireRow): number {
  const time = new Date(row.added_at).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Antigüedad del tune en el repertorio, en palabras (#42): `3 days`,
 * `4 months`, `1 year 1 month`. La fecha exacta va en el `title` de la celda,
 * así que aquí lo útil es la magnitud, no el día.
 *
 * Los tramos son los del boceto aprobado: menos de un mes en días, menos de un
 * año en meses redondeados, y a partir de ahí años con los meses que sobren.
 * Los plurales se componen uno a uno porque `1 months` es justo el defecto que
 * se ve en cuanto uno escribe el plural a mano. Un `added_at` que no se puede
 * leer no inventa una antigüedad: devuelve `—`, el hueco de la columna.
 */
export function addedAge(addedAt: string, now: number): string {
  const days = daysSince(addedAt, now);
  if (days === null) return '—';
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < 365) {
    const months = Math.round(days / 30);
    if (months >= 12) return '1 year';
    return `${months} ${months === 1 ? 'month' : 'months'}`;
  }
  let years = Math.floor(days / 365);
  let months = Math.round((days - years * 365) / 30);
  // 11 meses y medio redondean a 12: es un año, no «12 months».
  if (months === 12) {
    years += 1;
    months = 0;
  }
  const yearPart = `${years} ${years === 1 ? 'year' : 'years'}`;
  if (months === 0) return yearPart;
  return `${yearPart} ${months} ${months === 1 ? 'month' : 'months'}`;
}

/**
 * Comparadores de cada criterio, **solo por su clave primaria**: devuelven 0
 * cuando empatan y el desempate lo pone `sortRepertoire` (título mostrado y, en
 * última instancia, id). Así invertir la columna invierte lo que el lector ve
 * —el valor— y no el orden alfabético de las filas empatadas, que se quedaría
 * al revés sin que nadie lo hubiera pedido.
 *
 * Cada comparador está escrito en el sentido de `SORT_DEFAULT_DIRECTION`.
 */
const SORT_COMPARATORS: Record<SortKey, (left: RepertoireRow, right: RepertoireRow) => number> = {
  /**
   * Urgencia: primero los nunca ensayados; después los más antiguos de
   * `last_practiced_day` primero (más días sin practicar). Los nunca ensayados
   * no se ordenan entre sí por fecha: no tienen ninguna, quedan juntos y los
   * desempata el título.
   */
  urgency: (left, right) => {
    const leftTime = practiceTime(left);
    const rightTime = practiceTime(right);
    if (leftTime === rightTime) return 0;
    if (leftTime === null) return -1;
    if (rightTime === null) return 1;
    return leftTime - rightTime;
  },
  /** Alfabético por `displayTitle`, sin distinguir mayúsculas ni acentos. */
  alphabetical: (left, right) =>
    compareStrings(collationKey(displayTitle(left)), collationKey(displayTitle(right))),
  /** Fecha de alta: la más reciente primero, como ordena ya la consulta. */
  added: (left, right) => addedTime(right) - addedTime(left),
  /** Rating descendente; los null van al final. */
  rating: (left, right) => {
    const leftRating = left.rating ?? Number.NEGATIVE_INFINITY;
    const rightRating = right.rating ?? Number.NEGATIVE_INFINITY;
    if (leftRating === rightRating) return 0;
    return rightRating - leftRating;
  },
  /** Peldaño de la escalera: la más alta primero (#42). */
  level: (left, right) => bandFor(right.status).rung - bandFor(left.status).rung,
  /**
   * Ensayos: más primero. `null` es «no hay dato» y va al final —un 0 sí es un
   * dato y solo queda detrás de los que tienen alguno—. Al invertir la columna
   * los `null` pasan delante, como en cualquier tabla: la fila sin dato no
   * tiene un valor con el que competir.
   */
  practices: (left, right) => {
    const leftCount = left.practice_count;
    const rightCount = right.practice_count;
    if (leftCount === rightCount) return 0;
    if (leftCount === null) return 1;
    if (rightCount === null) return -1;
    return rightCount - leftCount;
  },
  /** Media de calidad: más alta primero, y `null` (sin ensayos) al final. */
  quality: (left, right) => {
    const leftAvg = left.avg_quality;
    const rightAvg = right.avg_quality;
    if (leftAvg === rightAvg) return 0;
    if (leftAvg === null) return 1;
    if (rightAvg === null) return -1;
    return rightAvg - leftAvg;
  },
};

/**
 * Devuelve una copia ordenada, sin mutar la de entrada. `direction` invierte el
 * criterio primario; el desempate se queda siempre en el mismo sentido, así que
 * dos filas empatadas no bailan al cambiar la flecha y el resultado no depende
 * del orden en que lleguen de la consulta.
 */
export function sortRepertoire(
  rows: readonly RepertoireRow[],
  key: SortKey,
  direction: SortDirection = SORT_DEFAULT_DIRECTION[key]
): RepertoireRow[] {
  const primary = SORT_COMPARATORS[key];
  const flip = direction !== SORT_DEFAULT_DIRECTION[key];
  return [...rows].sort((left, right) => {
    const result = primary(left, right);
    if (result === 0) return tieBreak(left, right);
    return flip ? -result : result;
  });
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
 * `last_practiced_day` (la columna que mantiene el trigger de `pr_practice`) y se
 * cuentan por medianoches locales, así que el resultado es determinista con el
 * `now` inyectado; si la fila no trae el día pero la vista sí trae los días, se
 * usa el de la base como respaldo.
 */
export function stalenessDays(row: RepertoireRow, now: number): number | null {
  if (row.last_practiced_day) return daysSinceDay(row.last_practiced_day, now);
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
 * Las bandas en orden de escalera, cada una ordenada por staleness.
 *
 * `bands` deja elegir el juego: la home pasa `LIBRARY_BANDS` —sin `learning`,
 * que tiene pantalla propia— y el resto de llamadas se quedan con la escalera
 * entera.
 *
 * Las aparcadas quedan fuera de las bandas: una tune en el cajón no está
 * en rotación y encabezar «To learn» por no haberla tocado nunca es justo el
 * defecto que corrige #11. Conservan su peldaño y se pintan en su propia
 * sección al final de la home (`visibleShelved`).
 */
export function groupIntoBands(
  rows: readonly RepertoireRow[],
  now: number,
  bands: readonly BandDefinition[] = BANDS
): BandGroup[] {
  return bands.map((band) => ({
    band,
    rows: rows
      .filter((row) => !row.shelved && row.status === band.status)
      .sort((left, right) => compareStaleness(left, right, now)),
  }));
}

// ---------------------------------------------------------------------------
// Banco de trabajo (#52): `learning` no es una banda de biblioteca
// ---------------------------------------------------------------------------

/**
 * Días que lleva una fila en su peldaño actual (#52), desde `status_changed_at`.
 *
 * Es el reloj del taller, y no el de la rejilla: en `learning` la pregunta no es
 * «cuánto hace que no la toco» sino «cuánto hace que no se mueve». `null` cuando
 * la fecha no viene: sin dato no se inventa un cero, que se leería como «recién
 * llegada» —justo lo contrario de lo que hay que ver—.
 */
export function dwellDays(row: RepertoireRow, now: number): number | null {
  return daysSince(row.status_changed_at, now);
}

/**
 * El banco de trabajo: las tunes de `learning`, ordenadas por **dwell**
 * descendente —la que más lleva atascada, primero— y, a igual dwell, por título
 * (mismo `collationKey` que el resto: nunca `localeCompare`).
 *
 * Las aparcadas quedan fuera, como en las bandas: aparcar no cambia el peldaño,
 * pero las saca de rotación. Una fila sin `status_changed_at` va al final, no al
 * principio: no se pone por delante de una que sí se sabe.
 */
export function workbenchRows(rows: readonly RepertoireRow[], now: number): RepertoireRow[] {
  return rows
    .filter((row) => !row.shelved && row.status === 'learning')
    .sort((left, right) => {
      const a = dwellDays(left, now);
      const b = dwellDays(right, now);
      if (a === null && b !== null) return 1;
      if (b === null && a !== null) return -1;
      if (a !== null && b !== null && a !== b) return b - a;
      return compareStrings(collationKey(displayTitle(left)), collationKey(displayTitle(right)));
    });
}

/** El tope del taller: cuánto ocupa `learning` y cuánto le queda (#52). */
export interface LearningSlots {
  used: number;
  /** Tope normalizado; nunca por debajo de 1. */
  limit: number;
  free: number;
  /** Cuántas sobran cuando ya está por encima del tope (`0` si cabe). */
  over: number;
}

/**
 * Recuento del banco de trabajo contra su tope. `learning` sin sesión y sin
 * tope no es un estado: es un almacén —medido: 192 de 424 el 2026-11-05—.
 *
 * Un `limit` inválido cae a **1**, no a «sin tope»: si el valor guardado está
 * roto, es más seguro quedarse corto que abrir la puerta de par en par.
 */
export function learningSlots(rows: readonly RepertoireRow[], limit: number): LearningSlots {
  const used = rows.filter((row) => !row.shelved && row.status === 'learning').length;
  const bounded = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1;
  return {
    used,
    limit: bounded,
    free: Math.max(0, bounded - used),
    over: Math.max(0, used - bounded),
  };
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
 * Todo el repertorio en el orden de los resultados de la búsqueda (#48).
 *
 * Las etiquetas filtran **después** de la consulta, y una etiqueta sola ya es
 * una consulta; pero `searchRepertoire` devuelve `[]` sin texto ni ritmo (esa es
 * su decisión: la vista en reposo no enseña el repertorio entero). Esta es la
 * base sobre la que filtra `filterBySelectedTags` en ese caso, con el mismo orden
 * alfabético —título, ritmo, id— para que la lista no cambie de criterio según
 * cómo se llegue a ella.
 */
export function alphabeticalRows(rows: readonly RepertoireRow[]): RepertoireRow[] {
  return [...rows].sort(compareSearchOrder);
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
 * números para que el total del repertorio sea la suma de sus partes (las cinco
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
 * no agrupa: es un cajón, no una banda más.
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

/**
 * Tope de **tres filas** (#46): depende de las columnas reales, no de un número
 * fijo. Con la rejilla de cuatro son 12 cartas por banda.
 */
export function capForColumns(columns: number): number {
  if (!Number.isFinite(columns) || columns < 1) return 0;
  return Math.floor(columns) * 3;
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
