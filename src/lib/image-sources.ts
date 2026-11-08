/**
 * Modelo puro del fondo del tune (issue #31). Sin red y sin DOM: construye las
 * consultas, funde los carriles, clasifica el ratio y calcula la geometría del
 * encuadre. El adaptador que habla con Commons, Pexels y el Art Institute vive
 * en `image-search.ts`.
 *
 * Por qué así y no de otra forma:
 *
 *   · **Commons tiene dos carriles y solo dos: arte y foto.** Medido el
 *     2026-11-08 sobre 15 títulos del catálogo: los carriles de arte y de foto no
 *     compartían ni un fichero (0 % de solape) y **el mosaico salía igual de las
 *     dos maneras**, porque el carril de título (4 plazas) y el de frase exacta
 *     (1) no llevaban registro y ocupaban cinco de las nueve. Se retiraron: sin
 *     registro no hay plaza.
 *   · **El carril foto usa negación**, no `+photograph` (que era ruido). La
 *     negación ahora incluye los términos de impresión: un grabado que no se
 *     niega se cuela como foto.
 *   · **`+painting` es léxico, no un filtro de medio.** El carril de arte se
 *     queda vacío en 4 de 15 títulos, y en *Monaghan* devolvió seis resultados
 *     sin un solo cuadro. Por eso cada candidato se contrasta con las categorías
 *     del fichero (`commonsMedium`) y, cuando hay que filtrar por medio de
 *     verdad, se usa el Art Institute, que sí tiene `artwork_type_title`.
 *   · Nada de grupos OR de medios (`(painting OR engraving OR …)`): devolvía los
 *     mismos tres grabados para todos los títulos.
 *   · `thumburl` se guarda tal cual lo devuelve el API. Una ruta de miniatura
 *     compuesta a mano da 400 en Commons.
 */

/** De dónde sale la imagen. `upload` es la subida manual (F10), sin tocar. */
export type ImageSourceName = 'commons' | 'pexels' | 'artic' | 'upload';

/** Las fuentes que se consultan por API. */
export type SearchSource = 'commons' | 'pexels' | 'artic';

/** Filtro por registro visual: arte, foto o ambos carriles. */
export type ImageRegister = 'both' | 'art' | 'photo';

/** Un candidato listo para el mosaico, venga de donde venga. */
export interface ImageCandidate {
  source: SearchSource;
  /** Nombre de fichero en Commons (sin `File:`), id numérico en Pexels. */
  id: string;
  title: string;
  /** 330 px en Commons, `medium` en Pexels: lo que pinta el mosaico y la carta. */
  thumbUrl: string;
  /**
   * 960 px en Commons (se pide solo al ampliar), `large2x` en Pexels. Mientras
   * no se ha ampliado, es la misma URL que la miniatura: nunca se compone.
   */
  fullUrl: string;
  pageUrl: string;
  author: string;
  license: string;
  licenseUrl: string | null;
  width: number;
  height: number;
  /** Palabras que trajeron el candidato; sirve para depurar la fusión. */
  term: string;
  /**
   * Categorías del fichero en Commons (`prop=categories`). Es la única señal de
   * medio que Commons da de verdad; Pexels y el Art Institute no las usan.
   */
  categories?: readonly string[];
}

/**
 * Carriles del buscador de Commons: arte y foto, nada más. Los carriles de
 * título y de frase exacta se retiraron el 2026-11-08 — eran los que no llevaban
 * registro y los que hacían que arte y foto se vieran iguales.
 */
export type LaneKind = 'art' | 'photo';

/** Una consulta de Commons con su carril y su límite de petición. */
export interface CommonsQuery {
  kind: LaneKind;
  /** Valor de `gsrsearch`, ya completo (`filetype:bitmap …`). */
  search: string;
  /** Cuántos resultados se piden al API (no el cupo del mosaico). */
  limit: number;
}

/** Cuántos candidatos tiene el mosaico: 3×3. */
export const CANDIDATE_COUNT = 9;

/**
 * Términos con los que se pide el carril de arte, **uno por consulta**. Grabado
 * y estampa valen tanto como pintura: el criterio del dueño (2026-11-08) es que
 * arte es la obra gráfica, no solo el óleo. Nada de grupos OR: devolvían los
 * mismos tres grabados para todos los títulos.
 */
export const ART_QUERY_TERMS = ['painting', 'engraving', 'drawing', 'print'] as const;

/**
 * Términos de medio que se niegan en el carril foto. Incluye los de impresión:
 * un grabado que no se niega se cuela como si fuera una foto (medido: *storm at
 * sea* en modo foto devolvía dos cuadros de Palma il Vecchio).
 */
export const ART_MEDIA_TERMS = [
  'painting',
  'engraving',
  'etching',
  'drawing',
  'lithograph',
  'watercolour',
  'woodcut',
  'print',
] as const;

/** Ancho de la miniatura que se pide a Commons: el cubo de 330 (21 KB). */
export const COMMONS_THUMB_WIDTH = 330;
/** Ancho del grande: solo al ampliar para encuadrar (960, 183 KB). */
export const COMMONS_FULL_WIDTH = 960;

/** Endpoint público de Pexels para buscar fotos. */
export const PEXELS_SEARCH_ENDPOINT = 'https://api.pexels.com/v1/search';
/** Licencia de todo lo que sirve Pexels. */
export const PEXELS_LICENSE = 'Pexels License';
export const PEXELS_LICENSE_URL = 'https://www.pexels.com/license/';
/** `per_page` del mosaico. */
export const PEXELS_PER_PAGE = CANDIDATE_COUNT;

/**
 * Artículos que no aportan nada a la búsqueda de imágenes. `The Butterfly` da
 * «butterfly»; `Kesh, The` también. Se recorta en los dos extremos porque el
 * catálogo guarda las dos formas.
 */
const LEADING_ARTICLES = /^(the|an|a)\s+/i;
const TRAILING_ARTICLE = /,\s*(the|an|a)$/i;

/**
 * Palabras de búsqueda a partir del título: sin artículo delante ni detrás.
 * No toca nada más — ni acentos ni apóstrofos: `Jimmy Ward's` busca con el
 * apóstrofo, que es como está en Commons.
 */
export function searchWords(title: string): string {
  const trimmed = title.trim();
  const withoutTrailing = trimmed.replace(TRAILING_ARTICLE, '');
  return withoutTrailing.replace(LEADING_ARTICLES, '').trim();
}

/**
 * Las consultas de Commons para un juego de palabras: **una por término de arte**
 * y, si el registro lo admite, una de foto con la negación. No hay carril sin
 * registro — esa era la vía por la que arte y foto acababan mostrando lo mismo.
 *
 * Cada término de arte va en su propia consulta porque la búsqueda de Commons es
 * léxica: `painting` encuentra ficheros que mencionan la palabra, y agrupar los
 * medios en un OR hacía que todos los títulos devolvieran el mismo grabado.
 */
export function commonsQueries(words: string, register: ImageRegister = 'both'): CommonsQuery[] {
  const term = searchWords(words);
  if (term.length === 0) return [];

  const queries: CommonsQuery[] = [];

  if (register !== 'photo') {
    for (const medium of ART_QUERY_TERMS) {
      queries.push({ kind: 'art', search: `filetype:bitmap ${term} ${medium}`, limit: 6 });
    }
  }

  if (register !== 'art') {
    const negatives = ART_MEDIA_TERMS.map((media) => `-${media}`).join(' ');
    // Pide más de las que caben: el veto por categorías descarta después.
    queries.push({ kind: 'photo', search: `filetype:bitmap ${term} ${negatives}`, limit: 12 });
  }

  return queries;
}

/**
 * URL de búsqueda de Pexels. `orientation=landscape` descarta las verticales en
 * origen; `access-control-allow-origin: *` está medido, así que se puede llamar
 * desde el navegador con la clave del usuario.
 */
export function pexelsSearchUrl(words: string, perPage = PEXELS_PER_PAGE): string {
  const url = new URL(PEXELS_SEARCH_ENDPOINT);
  url.searchParams.set('query', searchWords(words));
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('orientation', 'landscape');
  return url.toString();
}

/** Clave de deduplicado: el mismo proveedor puede devolver el mismo id dos veces. */
export function candidateKey(candidate: Pick<ImageCandidate, 'source' | 'id'>): string {
  return `${candidate.source}:${candidate.id}`;
}

/** Un carril con lo que devolvió su consulta. */
export interface CandidateLane {
  kind: LaneKind;
  candidates: readonly ImageCandidate[];
}

/**
 * Fusión **en ronda**: un candidato por carril y vuelta, hasta llenar el mosaico.
 *
 * Sin cupos por tipo. Los cupos fijos (4/2/2/1) repartían las plazas antes de ver
 * los resultados, así que un carril con sobrantes no podía aportar más y, sobre
 * todo, cinco de las nueve plazas quedaban en carriles sin registro: arte y foto
 * se veían iguales por construcción, no por falta de resultados.
 *
 * Y **sin relleno mezclado**: si hay menos candidatos que plazas, el mosaico sale
 * corto. Es la decisión del dueño (2026-11-08): el silencio informa, el relleno
 * con lo que no cumple el criterio engaña. Lo que se deduplica aquí es por
 * `source:id`, no por imagen: la misma foto servida por dos proveedores sigue
 * entrando dos veces.
 */
export function mergeCandidates(
  lanes: readonly CandidateLane[],
  limit = CANDIDATE_COUNT
): ImageCandidate[] {
  const pool: ImageCandidate[] = [];
  const seen = new Set<string>();

  let progressed = true;
  while (pool.length < limit && progressed) {
    progressed = false;
    for (const lane of lanes) {
      if (pool.length >= limit) break;
      const next = lane.candidates.find((candidate) => !seen.has(candidateKey(candidate)));
      if (!next) continue;
      seen.add(candidateKey(next));
      pool.push(next);
      progressed = true;
    }
  }

  return pool;
}

/** Ratio ancho/alto; null si el API no dio medidas. */
export function imageRatio(candidate: Pick<ImageCandidate, 'width' | 'height'>): number | null {
  if (!candidate.width || !candidate.height) return null;
  return candidate.width / candidate.height;
}

/** Umbrales del 5:4 de la carta: por debajo de 0,92 vertical; por encima de 1,95 panorámica. */
export const VERTICAL_RATIO = 0.92;
export const PANORAMIC_RATIO = 1.95;

export type RatioLabel = 'vertical' | 'panoramic' | null;

/** Etiquetas del mosaico (la UI va en inglés, como el resto de la app). */
export const RATIO_LABELS: Record<'vertical' | 'panoramic', string> = {
  vertical: 'vertical',
  panoramic: 'panoramic',
};

/** Clasificación del ratio: la marca avisa de qué imagen sufrirá el recorte 5:4. */
export function ratioLabel(candidate: Pick<ImageCandidate, 'width' | 'height'>): RatioLabel {
  const ratio = imageRatio(candidate);
  if (ratio === null) return null;
  if (ratio < VERTICAL_RATIO) return 'vertical';
  if (ratio > PANORAMIC_RATIO) return 'panoramic';
  return null;
}

/** Texto de la etiqueta de ratio; cadena vacía si el ratio cae cerca del 5:4. */
export function ratioTag(candidate: Pick<ImageCandidate, 'width' | 'height'>): string {
  const label = ratioLabel(candidate);
  return label ? RATIO_LABELS[label] : '';
}

/**
 * Licencias que no obligan a nada: dominio público, CC0 y Pexels. Se pintan en
 * verde en el mosaico. Una BY-SA sí obliga (atribución y compartir igual), y
 * recortarla crea obra derivada.
 */
export function isFreeLicense(license: string): boolean {
  return /public domain|cc0|no restrictions|pexels/i.test(license ?? '');
}

/** BY-SA y compañía: atribución y compartir igual. */
export function isShareAlike(license: string): boolean {
  return /by-sa|share[- ]alike/i.test(license ?? '');
}

/** Etiqueta corta de licencia para el tile: quita el « License» final. */
export function licenseLabel(license: string): string {
  const clean = (license ?? '').replace(/\s+/g, ' ').trim();
  return clean.replace(/\s+license$/i, '') || 'unknown';
}

/* ─────────────────────────────────────────────────────────────
 * Medio: la señal que Commons no da como campo
 * ───────────────────────────────────────────────────────────── */

/** Categoría que declara fotografía. Se prueba antes que el arte a propósito. */
const PHOTO_CATEGORY = /photograph|daguerreotype|ambrotype|tintype|albumen|gelatin silver/;

/** Categoría que declara obra gráfica o pictórica. */
const ART_CATEGORY =
  /\b(paintings?|engravings?|etchings?|lithographs?|woodcuts?|drawings?|watercolou?rs?|printmaking|artworks?|sculptures?)\b/;

/**
 * Qué medio declara un fichero de Commons, mirando su nombre y sus categorías.
 *
 * Medido el 2026-11-08: Commons **no tiene filtro de medio** utilizable.
 * `haswbstatement:P31=Q3305213` (pintura) devuelve cero al combinarlo con un
 * término e `incategory:"Paintings"` devuelve basura. Las categorías sí
 * discriminan cuando existen («Marine paintings by …», «17th-century sailing
 * ships in paintings»), pero un cuadro con solo categorías de fecha queda en
 * `unknown` — de ahí que `unknown` no se descarte: el carril que lo trajo ya
 * declaraba el medio.
 *
 * La foto gana al arte en el orden de las pruebas: un «salted paper print» es una
 * fotografía, no una estampa, y su categoría contiene la palabra `print`.
 */
export function commonsMedium(
  candidate: Pick<ImageCandidate, 'categories' | 'title'>
): 'art' | 'photo' | 'unknown' {
  const haystack = `${candidate.title} ${(candidate.categories ?? []).join(' ')}`.toLowerCase();
  if (PHOTO_CATEGORY.test(haystack)) return 'photo';
  if (ART_CATEGORY.test(haystack)) return 'art';
  return 'unknown';
}

/* ─────────────────────────────────────────────────────────────
 * Art Institute of Chicago: el filtro de medio que Commons no tiene
 * ───────────────────────────────────────────────────────────── */

/** Búsqueda de obras. Sin clave y con `access-control-allow-origin: *` (medido). */
export const ARTIC_SEARCH_ENDPOINT = 'https://api.artic.edu/api/v1/artworks/search';
/** Servidor IIIF de las imágenes. Solo admite ancho: el recorte va en cliente. */
export const ARTIC_IIIF_BASE = 'https://www.artic.edu/iiif/2';
/** Campos que se piden: los justos para candidato, crédito y medidas. */
export const ARTIC_FIELDS = [
  'id',
  'title',
  'is_public_domain',
  'image_id',
  'artwork_type_title',
  'classification_title',
  'medium_display',
  'artist_title',
  'date_display',
  'thumbnail',
].join(',');
/** Ancho de la miniatura: medido, 400 px = 50 KB. */
export const ARTIC_THUMB_WIDTH = 400;
/** Ancho del grande para encuadrar: medido, 843 px = 262 KB. */
export const ARTIC_FULL_WIDTH = 843;
/**
 * Cuántas obras se piden por búsqueda. El API no filtra por medio, así que se
 * pide un pozo y se filtra en cliente por `artwork_type_title`; con 40 hay
 * margen para sacar nueve tras descartar lo que no es del registro pedido.
 */
export const ARTIC_POOL = 40;
export const ARTIC_LICENSE = 'Public domain';
export const ARTIC_LICENSE_URL = 'https://www.artic.edu/terms';

/** Tipo de obra de AIC que cuenta como arte. Grabado y estampa entran: son `Print`. */
const ARTIC_ART_TYPE = /\b(paintings?|prints?|drawings?|watercolou?rs?)\b/i;
/**
 * Medio que cuenta como fotografía. No basta `photograph`: AIC cataloga muchas
 * como «gelatin silver print» o «salted paper print», y sin estos términos una
 * fotografía caería del lado del arte porque su clasificación dice `print`.
 */
const ARTIC_PHOTO_TYPE =
  /photograph|gelatin silver|albumen|albumen silver|salted paper|daguerreotype|tintype/i;

/**
 * URL de una imagen IIIF. **Solo se puede pedir ancho**: el servidor del Art
 * Institute bloquea por lista blanca el recorte en servidor (`!400,320` y
 * `/square/` responden 403 «IIIF allowlist policy»), así que el 5:4 se resuelve
 * en cliente, como en Commons.
 *
 * Ojo: la imagen exige `Referer`. Sin él responde el desafío de Cloudflare, así
 * que estas `<img>` no pueden llevar `referrerpolicy="no-referrer"`.
 */
export function articImageUrl(imageId: string, width = ARTIC_THUMB_WIDTH): string {
  return `${ARTIC_IIIF_BASE}/${imageId}/full/${width},/0/default.jpg`;
}

/**
 * URL de búsqueda. `query[term][is_public_domain]=true` filtra en servidor
 * (medido: 62.119 obras frente a 133.165 sin filtro), así que el pozo que llega
 * ya es todo utilizable en derechos.
 */
export function articSearchUrl(words: string, pool = ARTIC_POOL): string {
  const url = new URL(ARTIC_SEARCH_ENDPOINT);
  url.searchParams.set('q', searchWords(words));
  url.searchParams.set('limit', String(pool));
  url.searchParams.set('fields', ARTIC_FIELDS);
  url.searchParams.set('query[term][is_public_domain]', 'true');
  return url.toString();
}

/** Medio de una obra del Art Institute, por su tipo y clasificación. */
export function articMedium(artwork: Loose): 'art' | 'photo' | 'unknown' {
  const haystack = [artwork?.artwork_type_title, artwork?.classification_title, artwork?.medium_display]
    .filter((value) => typeof value === 'string')
    .join(' ');
  if (ARTIC_PHOTO_TYPE.test(haystack)) return 'photo';
  if (ARTIC_ART_TYPE.test(haystack)) return 'art';
  return 'unknown';
}

/**
 * Candidatos a partir de `/artworks/search`. Descarta lo que no está en dominio
 * público o no tiene imagen —un `200` sin `image_id` no es un candidato— y, con
 * registro `art` o `photo`, lo que no sea de ese medio. Con `both` entra también
 * el medio desconocido (textil, cerámica): el mosaico no promete medio.
 */
export function parseArticResponse(
  payload: Loose,
  register: ImageRegister = 'both',
  term = ''
): ImageCandidate[] {
  const works: Loose[] = Array.isArray(payload?.data) ? payload.data : [];
  const out: ImageCandidate[] = [];

  for (const work of works) {
    if (work?.is_public_domain !== true) continue;
    const imageId = typeof work?.image_id === 'string' ? work.image_id : '';
    if (!imageId) continue;

    const medium = articMedium(work);
    if (register === 'art' && medium !== 'art') continue;
    if (register === 'photo' && medium !== 'photo') continue;

    const id = work?.id === undefined || work?.id === null ? '' : String(work.id);
    if (!id) continue;

    out.push({
      source: 'artic',
      id,
      title: String(work?.title ?? '') || `Art Institute ${id}`,
      thumbUrl: articImageUrl(imageId, ARTIC_THUMB_WIDTH),
      fullUrl: articImageUrl(imageId, ARTIC_FULL_WIDTH),
      pageUrl: `https://www.artic.edu/artworks/${id}`,
      author: String(work?.artist_title ?? '') || '—',
      license: ARTIC_LICENSE,
      licenseUrl: ARTIC_LICENSE_URL,
      width: Number(work?.thumbnail?.width ?? 0) || 0,
      height: Number(work?.thumbnail?.height ?? 0) || 0,
      term,
    });
  }

  return out;
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2.2;
export const FOCAL_DEFAULT = 50;

export function clampFocal(value: number): number {
  if (!Number.isFinite(value)) return FOCAL_DEFAULT;
  return Math.min(100, Math.max(0, value));
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return ZOOM_MIN;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** Entrada de la geometría del recuadro 5:4. */
export interface CropInput {
  /** Caja contenedora, en píxeles de layout. */
  boxWidth: number;
  boxHeight: number;
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  focalX: number;
  focalY: number;
}

/** Lo que se pinta en el recuadro y cuánto desborda la imagen por eje. */
export interface CropGeometry {
  backgroundSize: string;
  backgroundPosition: string;
  /** Píxeles que sobran a lo ancho: si es 0, el eje horizontal no se arrastra. */
  overflowX: number;
  overflowY: number;
}

/**
 * Matemática del encuadre, validada en el prototipo (no reinventar):
 *
 *   s = max(bw / w, bh / h) * zoom
 *   background-size     = (w·s)px (h·s)px
 *   background-position = focal_x% focal_y%
 *
 * Con `background-position` en porcentaje, el navegador alinea el mismo
 * porcentaje de la imagen con el del contenedor, que es justo lo que necesita el
 * arrastre: mover `focal_x` 100 % recorre todo el desborde.
 */
export function cropGeometry(input: CropInput): CropGeometry {
  const zoom = clampZoom(input.zoom);
  const focalX = clampFocal(input.focalX);
  const focalY = clampFocal(input.focalY);
  const position = `${focalX}% ${focalY}%`;

  const boxWidth = Math.max(1, input.boxWidth || 0);
  const boxHeight = Math.max(1, input.boxHeight || 0);
  const hasSize = input.imageWidth > 0 && input.imageHeight > 0;

  if (!hasSize) {
    // Sin medidas del API no se puede calcular el desborde: cover y a otra cosa.
    return { backgroundSize: 'cover', backgroundPosition: position, overflowX: 0, overflowY: 0 };
  }

  const scale = Math.max(boxWidth / input.imageWidth, boxHeight / input.imageHeight) * zoom;
  const scaledWidth = input.imageWidth * scale;
  const scaledHeight = input.imageHeight * scale;

  return {
    backgroundSize: `${Math.round(scaledWidth)}px ${Math.round(scaledHeight)}px`,
    backgroundPosition: position,
    overflowX: Math.max(0, scaledWidth - boxWidth),
    overflowY: Math.max(0, scaledHeight - boxHeight),
  };
}

/** Punto focal guardado, con los valores por defecto de la migración. */
export interface Focal {
  x: number;
  y: number;
}

/**
 * Arrastre del encuadre: el signo es el del prototipo — arrastrar a la derecha
 * **baja** el focal (la imagen se mueve con el dedo). Solo se aplica en el eje
 * que desborda: si la imagen no sobresale en vertical, `dy` no toca `focal_y`.
 */
export function focalAfterDrag(
  start: Focal,
  dx: number,
  dy: number,
  overflow: { overflowX: number; overflowY: number }
): Focal {
  const x =
    overflow.overflowX > 0
      ? clampFocal(start.x - (dx / overflow.overflowX) * 100)
      : clampFocal(start.x);
  const y =
    overflow.overflowY > 0
      ? clampFocal(start.y - (dy / overflow.overflowY) * 100)
      : clampFocal(start.y);
  return { x, y };
}

/**
 * `object-position` de la carta a partir del focal guardado. La carta pinta la
 * imagen como fondo recortado a 5:4; el mismo porcentaje sirve para `cover`.
 */
export function focalPosition(focalX: number | null, focalY: number | null): string {
  return `${clampFocal(focalX ?? FOCAL_DEFAULT)}% ${clampFocal(focalY ?? FOCAL_DEFAULT)}%`;
}

/* ─────────────────────────────────────────────────────────────
 * Parseo de las respuestas del API (puro: se prueba con fixtures)
 * ───────────────────────────────────────────────────────────── */

/** Cualquier JSON con la forma laxa que devuelven estos APIs. */
type Loose = any;

/** Texto de una entrada de `extmetadata`: quita el HTML que trae Commons. */
export function plainText(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function metadataValue(metadata: Loose, key: string): string {
  return plainText(metadata?.[key]?.value);
}

/**
 * Candidatos a partir de la respuesta de `action=query&generator=search`.
 *
 * Se conserva `imageinfo[0].thumburl` —la URL que devuelve el API, no una
 * compuesta— y se descartan las páginas sin `imageinfo` o sin miniatura: un
 * tile sin imagen no es un candidato.
 */
export function parseCommonsResponse(payload: Loose, term = ''): ImageCandidate[] {
  const pages: Loose = payload?.query?.pages ?? {};
  const ordered = Object.values(pages as Record<string, Loose>).sort(
    (left: Loose, right: Loose) => (left?.index ?? 0) - (right?.index ?? 0)
  );

  const out: ImageCandidate[] = [];
  for (const page of ordered) {
    const info: Loose = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
    const thumbUrl: string = info?.thumburl ?? '';
    if (!thumbUrl) continue;

    const title: string = String(page?.title ?? '').replace(/^File:/, '');
    if (!title) continue;

    const metadata = info?.extmetadata ?? {};
    // Las categorías son la única señal de medio que da Commons. Con
    // `prop=categories` llegan en la página, no en `imageinfo`.
    const categories: string[] = Array.isArray(page?.categories)
      ? page.categories
          .map((entry: Loose) => String(entry?.title ?? '').replace(/^Category:/, '').trim())
          .filter((name: string) => name.length > 0)
      : [];
    out.push({
      source: 'commons',
      id: title,
      title,
      thumbUrl,
      // El grande se pide aparte (960). Hasta entonces, la miniatura: nunca se
      // inventa la ruta de una miniatura de Commons.
      fullUrl: thumbUrl,
      pageUrl: info?.descriptionurl ?? info?.canonicaltitle ?? '',
      author: metadataValue(metadata, 'Artist') || metadataValue(metadata, 'Credit') || '—',
      license: metadataValue(metadata, 'LicenseShortName') || metadataValue(metadata, 'License') || 'unknown',
      licenseUrl: metadataValue(metadata, 'LicenseUrl') || null,
      width: Number(info?.width ?? 0) || 0,
      height: Number(info?.height ?? 0) || 0,
      term,
      categories,
    });
  }
  return out;
}

/** Candidatos a partir de la respuesta de `/v1/search` de Pexels. */
export function parsePexelsResponse(payload: Loose): ImageCandidate[] {
  const photos: Loose[] = Array.isArray(payload?.photos) ? payload.photos : [];
  const out: ImageCandidate[] = [];

  for (const photo of photos) {
    const id = photo?.id === undefined || photo?.id === null ? '' : String(photo.id);
    const thumbUrl: string = photo?.src?.medium ?? photo?.src?.small ?? '';
    if (!id || !thumbUrl) continue;

    out.push({
      source: 'pexels',
      id,
      title: String(photo?.alt ?? '') || `Pexels ${id}`,
      thumbUrl,
      fullUrl: photo?.src?.large2x ?? thumbUrl,
      pageUrl: String(photo?.url ?? ''),
      author: String(photo?.photographer ?? '—'),
      license: PEXELS_LICENSE,
      licenseUrl: PEXELS_LICENSE_URL,
      width: Number(photo?.width ?? 0) || 0,
      height: Number(photo?.height ?? 0) || 0,
      term: '',
    });
  }
  return out;
}
