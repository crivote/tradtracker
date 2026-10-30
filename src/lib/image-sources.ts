/**
 * Modelo puro del fondo del tune (issue #31). Sin red y sin DOM: construye las
 * consultas, funde los carriles con cupo y relleno, clasifica el ratio y calcula
 * la geometría del encuadre. El adaptador que habla con Commons y Pexels vive en
 * `image-search.ts`.
 *
 * Por qué así y no de otra forma (medido el 2026-10-30, ver issue #31):
 *   · El carril foto usa **negación**, no `+photograph`: `+photograph` movía 2 de
 *     9 miniaturas (0 en *Drowsy Maggie*). Con negación el solape es 0 de 9 en
 *     tres de cuatro títulos.
 *   · Nada de grupos OR de medios (`(painting OR engraving OR …)`): devolvía los
 *     mismos tres grabados para todos los títulos.
 *   · `thumburl` se guarda tal cual lo devuelve el API. Una ruta de miniatura
 *     compuesta a mano da 400 en Commons.
 */

/** De dónde sale la imagen. `upload` es la subida manual (F10), sin tocar. */
export type ImageSourceName = 'commons' | 'pexels' | 'upload';

/** Las dos fuentes que se consultan por API. */
export type SearchSource = 'commons' | 'pexels';

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
}

/** Carriles del buscador de Commons. */
export type LaneKind = 'title' | 'art' | 'photo' | 'exact';

/** Una consulta de Commons con su carril y su límite de petición. */
export interface CommonsQuery {
  kind: LaneKind;
  /** Valor de `gsrsearch`, ya completo (`filetype:bitmap …`). */
  search: string;
  /** Cuántos resultados se piden al API (no el cupo del mosaico). */
  limit: number;
}

/**
 * Cupo de cada carril en el mosaico, 4/2/2/1 = 9. Si un carril devuelve menos,
 * el relleno completa con el resto: el mosaico nunca sale corto si hay nueve
 * resultados distintos.
 */
export const LANE_QUOTAS: Record<LaneKind, number> = {
  title: 4,
  art: 2,
  photo: 2,
  exact: 1,
};

/** Cuántos candidatos tiene el mosaico: 3×3. */
export const CANDIDATE_COUNT = 9;

/** Términos de medio que se niegan en el carril foto. */
export const ART_MEDIA_TERMS = [
  'painting',
  'engraving',
  'drawing',
  'lithograph',
  'watercolour',
  'woodcut',
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
 * Las consultas de Commons para un juego de palabras. El carril de arte se
 * omite con el registro en `photo` y el de foto con el registro en `art`; el de
 * título y el exacto van siempre.
 *
 * Con el registro en `photo` la negación se aplica **también** al título y a la
 * frase exacta. Medido el 2026-10-30: el carril título de *Harvest Home* devuelve
 * el Turner como primer resultado, así que sin esto el mosaico «de fotos» traía
 * una pintura y el criterio de la issue («con `foto`, ninguna de las nueve es una
 * pintura») no se cumplía. Con el registro por defecto, las consultas son
 * exactamente las de la issue.
 */
export function commonsQueries(words: string, register: ImageRegister = 'both'): CommonsQuery[] {
  const term = searchWords(words);
  if (term.length === 0) return [];

  const negatives = ART_MEDIA_TERMS.map((media) => `-${media}`).join(' ');
  const exclusion = register === 'photo' ? ` ${negatives}` : '';

  const queries: CommonsQuery[] = [
    { kind: 'title', search: `filetype:bitmap ${term}${exclusion}`, limit: 10 },
  ];

  if (register !== 'photo') {
    queries.push({ kind: 'art', search: `filetype:bitmap ${term} painting`, limit: 6 });
  }

  if (register !== 'art') {
    queries.push({ kind: 'photo', search: `filetype:bitmap ${term} ${negatives}`, limit: 6 });
  }

  queries.push({ kind: 'exact', search: `filetype:bitmap "${term}"${exclusion}`, limit: 5 });

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
 * Fusión con cupo y **relleno**.
 *
 * El bug que esto evita es real: el prototipo marcaba como «vistas» las que no
 * entraban en el cupo, y el relleno ya no podía recuperarlas — mosaicos de siete
 * con nueve resultados disponibles. Aquí solo se marca lo que **entra**: primero
 * se respeta el cupo de cada carril y después se completa hueco a hueco, en
 * rondas, con el resto de los carriles.
 */
export function mergeCandidates(
  lanes: readonly CandidateLane[],
  limit = CANDIDATE_COUNT
): ImageCandidate[] {
  const pool: ImageCandidate[] = [];
  const seen = new Set<string>();

  /** Toma un candidato si es nuevo; devuelve si entró. */
  const take = (candidate: ImageCandidate): boolean => {
    if (pool.length >= limit) return false;
    const key = candidateKey(candidate);
    if (seen.has(key)) return false;
    // Solo ahora se marca como vista: si no entra, el relleno la recupera.
    seen.add(key);
    pool.push(candidate);
    return true;
  };

  for (const lane of lanes) {
    let quota = LANE_QUOTAS[lane.kind] ?? 1;
    for (const candidate of lane.candidates) {
      if (quota <= 0) break;
      if (take(candidate)) quota -= 1;
    }
  }

  // Relleno en rondas: un candidato por carril y vuelta, para no llenar los
  // huecos con un solo carril cuando hay más de uno con sobrantes.
  let progressed = true;
  while (pool.length < limit && progressed) {
    progressed = false;
    for (const lane of lanes) {
      if (pool.length >= limit) break;
      const next = lane.candidates.find((candidate) => !seen.has(candidateKey(candidate)));
      if (next && take(next)) progressed = true;
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
