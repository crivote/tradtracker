/**
 * Las versiones de una tune (#59): todos los settings de TheSession, con su
 * identidad estable y un rótulo que se pueda leer en un desplegable.
 *
 * Módulo **puro**: sin red, sin almacén y sin `abcjs`. Aquí se decide qué es un
 * setting, cómo se reconoce una versión y cómo se completa un cuerpo de ABC que
 * llegó sin cabeceras —el caso de 51 filas del repertorio, medido: el texto
 * tiene `L:` y `K:` indentados y ni `X:` ni `T:` ni `M:`, y el reproductor las
 * daba por «sin ABC»—.
 *
 * **La identidad de una versión no es su posición.** TheSession escribe en cada
 * bloque `S: https://thesession.org/tunes/12#setting4521`, y ese `4521` es el id
 * de setting: estable aunque el orden cambie o alguien añada una versión al
 * principio. Cuando el bloque no trae `S:` (un ABC propio, un texto copiado) el
 * id cae a `n<índice>`, que solo significa «la enésima de este texto».
 */

/** Los metadatos de la tune que pueden faltar en el texto y hay que poner. */
export interface AbcTuneMeta {
  title?: string | null;
  rhythm?: string | null;
  meter?: string | null;
  /** `K:` de la fila. El catálogo lo deja vacío (decisión A4): casi siempre falta. */
  key?: string | null;
}

/** Una versión reproducible y reconocible. */
export interface AbcVersion {
  /** `setting12342` si el bloque trae `S:`; `n2` si no. Es lo que se persiste. */
  id: string;
  /** Rótulo corto para el desplegable: `1 · Edor`. */
  label: string;
  /** El ABC **de una sola** versión, con cabeceras completas. */
  abc: string;
}

/** Una línea de cabecera ABC: `K:Edor`, `M: 4/4`. */
const HEADER = /^([A-Za-z]):\s*(.*)$/;

/** `…/tunes/12#setting4521` → `4521`. */
const SETTING_REF = /#setting(\d+)\s*$/;

/** Quita la indentación con la que llegaron algunos cuerpos («                K:Adorian»). */
function dedent(text: string): string[] {
  return text
    .replace(/\r\n|\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^[ \t]+/, '').replace(/\s+$/, ''));
}

/**
 * Cabeceras y música de un cuerpo de ABC, separadas por la primera línea que ya
 * no es cabecera. Un cuerpo sin cabeceras devuelve el mapa vacío y todas las
 * líneas como música: no se inventa nada aquí.
 */
function splitHeadAndBody(lines: readonly string[]): {
  headers: Map<string, string>;
  body: string[];
} {
  const headers = new Map<string, string>();
  let index = 0;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === '') continue;
    const match = HEADER.exec(line);
    if (!match) break;
    // La primera aparición manda: un segundo `K:` en mitad del texto es un
    // cambio de tonalidad del tune, no la tonalidad del tune.
    const key = match[1].toUpperCase();
    if (!headers.has(key)) headers.set(key, match[2].trim());
  }
  return { headers, body: lines.slice(index) };
}

/** El valor de cabecera que hay que poner: el del texto, o el de la fila. */
function pick(headers: Map<string, string>, letter: string, fallback?: string | null): string {
  return (headers.get(letter) ?? '').trim() || (fallback ?? '').trim();
}

/**
 * Un cuerpo de ABC con las cabeceras mínimas para sonar, sin duplicar las que ya
 * traía. Devuelve `null` cuando no hay `K:` por ninguna parte: sin tonalidad
 * `abcjs` no sabe qué alteraciones aplicar, y un ABC inventado es peor que un
 * «no hay».
 */
export function completeAbc(text: string, meta: AbcTuneMeta = {}, number = 1): string | null {
  const { headers, body } = splitHeadAndBody(dedent(text));
  const key = pick(headers, 'K', meta.key);
  if (!key) return null;

  const music = body.join('\n').trim();
  if (!music) return null;
  // Un cuerpo de verdad trae compases. Así se descarta el HTML de una página de
  // error que llega con 200 —envolverlo en cabeceras lo convertiría en «ABC» y
  // el reproductor diría que sí a lo que no es música—.
  if (!/\|/.test(music)) return null;

  const out: string[] = [
    `X: ${pick(headers, 'X') || number}`,
    `T: ${pick(headers, 'T', meta.title) || 'Untitled'}`,
  ];
  const composer = pick(headers, 'C');
  if (composer) out.push(`C: ${composer}`);
  const rhythm = pick(headers, 'R', meta.rhythm);
  if (rhythm) out.push(`R: ${rhythm}`);
  // `M:` sin dato no se puede adivinar; 4/4 es el defecto del estándar ABC.
  out.push(`M: ${pick(headers, 'M', meta.meter) || '4/4'}`);
  out.push(`L: ${pick(headers, 'L') || '1/8'}`);
  out.push(`K: ${key}`);
  out.push(music);
  return `${out.join('\n')}\n`;
}

/** El id de setting de un bloque, si su `S:` lo declara. */
function settingIdOf(headers: Map<string, string>): string | null {
  const ref = headers.get('S') ?? '';
  const match = SETTING_REF.exec(ref.trim());
  return match ? `setting${match[1]}` : null;
}

/**
 * El rótulo: número de orden y tonalidad, que es lo que distingue dos versiones
 * de la misma tune a simple vista. Sin tonalidad queda solo el número — nunca un
 * guion ni un «unknown».
 */
function labelOf(number: number, key: string): string {
  const tone = key.split(/\s+/)[0] ?? '';
  return tone ? `${number} · ${tone}` : `${number}`;
}

/**
 * Todas las versiones de un texto ABC, en el orden en que vienen.
 *
 * Acepta las tres formas que hay en el proyecto: el texto completo con varios
 * bloques `X:` (lo que sirve TheSession), un único bloque, y el cuerpo suelto
 * sin cabeceras de las filas importadas. Un texto vacío o sin música devuelve
 * una lista vacía, que es el «no hay» de la cadena.
 */
export function splitSettings(text: string | null | undefined, meta: AbcTuneMeta = {}): AbcVersion[] {
  const raw = (text ?? '').trim();
  if (!raw) return [];

  const lines = dedent(raw);
  const starts: number[] = [];
  lines.forEach((line, index) => {
    if (/^X:/.test(line)) starts.push(index);
  });

  const blocks: string[][] =
    starts.length === 0
      ? [lines]
      : starts.map((start, index) => lines.slice(start, starts[index + 1] ?? lines.length));

  const versions: AbcVersion[] = [];
  blocks.forEach((block) => {
    const { headers } = splitHeadAndBody(block);
    const abc = completeAbc(block.join('\n'), meta, versions.length + 1);
    if (!abc) return;
    const number = versions.length + 1;
    versions.push({
      id: settingIdOf(headers) ?? `n${number}`,
      label: labelOf(number, pick(headers, 'K', meta.key)),
      abc,
    });
  });

  return versions;
}

/**
 * La versión que suena: la preferida si está entre las que hay, y si no la
 * primera. Una preferencia que apunta a una versión desaparecida **no** es un
 * error: se cae a la primera, que es lo que hacía el reproductor antes de que
 * existieran las preferencias.
 */
export function pickVersion(
  versions: readonly AbcVersion[],
  preferred?: string | null
): AbcVersion | null {
  if (versions.length === 0) return null;
  if (preferred) {
    const match = versions.find((version) => version.id === preferred);
    if (match) return match;
  }
  return versions[0];
}
