/**
 * Relleno de `pr_tunes.composer` desde el artefacto del catálogo (#44).
 *
 * El autor de la tune no estaba en la base: `pr_tunes` no tenía la columna. El
 * dato sí está en `public/thesession.db` (columna `composer`, por tune), así que
 * este script cruza cada fila de `pr_tunes` con el artefacto y escribe el autor
 * que falte.
 *
 * Tres decisiones que no son de adorno:
 *   · **En seco por defecto.** Escribe solo con `--apply`: la tabla es compartida
 *     entre usuarios y el disparo del relleno no se hace a ciegas.
 *   · **Idempotente por el filtro, no por la lectura.** Cada `PATCH` lleva
 *     `composer=is.null`, así que reejecutarlo no pisa lo que ya tiene valor ni
 *     lo que otro haya escrito entre la lectura y la escritura.
 *   · **El vacío del artefacto no es un autor.** El artefacto guarda la ausencia
 *     como cadena vacía; escribir `''` haría que el subtexto pintara un
 *     separador con nada detrás. Sin autor, la columna se queda `null`.
 *
 * Uso:
 *   npx vite-node scripts/backfill-composer.mts            # en seco (por defecto)
 *   npx vite-node scripts/backfill-composer.mts --apply    # escribe
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CATALOGUE_BY_ID_CHUNK, buildCatalogueByIdSql } from '../src/lib/catalogue';

// Vite 5 no lista `node:sqlite` entre los builtins del navegador: se carga por
// require nativo, igual que en las suites que corren contra el artefacto.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

const ARTIFACT_PATH = fileURLToPath(new URL('../public/thesession.db', import.meta.url));
const KEYS_PATH = join(homedir(), 'secrets', 'tradtracker-keys.txt');

/** Página de lectura de PostgREST; el tope del servicio son 1.000 filas. */
const PAGE = 1000;

const apply = process.argv.slice(2).includes('--apply');

interface TuneRow {
  id: string;
  origin_ref: string | null;
  name: string;
  composer: string | null;
}

interface Keys {
  url: string;
  serviceRole: string;
}

/** `~/secrets/tradtracker-keys.txt` es `URL=`, `ANON=`, `SERVICE_ROLE=` por línea. */
function readKeys(): Keys {
  let text: string;
  try {
    text = readFileSync(KEYS_PATH, 'utf8');
  } catch (cause) {
    throw new Error(`No pude leer ${KEYS_PATH}: ${(cause as Error).message}`);
  }

  const pick = (name: string): string => {
    const match = new RegExp(`^${name}=(.*)$`, 'm').exec(text);
    return match ? match[1].trim() : '';
  };

  const url = (process.env.SUPABASE_URL ?? pick('URL')).replace(/\/+$/, '');
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE ?? pick('SERVICE_ROLE');
  if (!url || !serviceRole) {
    throw new Error(`${KEYS_PATH} no trae URL y SERVICE_ROLE.`);
  }
  return { url, serviceRole };
}

/** Todas las filas de TheSession de `pr_tunes`, por páginas de 1.000. */
async function fetchTunes(keys: Keys): Promise<TuneRow[]> {
  const rows: TuneRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const query = new URLSearchParams({
      select: 'id,origin_ref,name,composer',
      origin: 'eq.thesession',
      order: 'origin_ref.asc',
      limit: String(PAGE),
      offset: String(offset),
    });
    const response = await fetch(`${keys.url}/rest/v1/pr_tunes?${query}`, {
      headers: {
        apikey: keys.serviceRole,
        Authorization: `Bearer ${keys.serviceRole}`,
      },
    });
    if (!response.ok) {
      throw new Error(`GET pr_tunes respondió ${response.status}: ${await response.text()}`);
    }
    const page = (await response.json()) as TuneRow[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** `composer` del artefacto por id: cadena vacía y NULL son «sin autor». */
function composerById(ids: number[]): Map<number, string | null> {
  const db = new DatabaseSync(ARTIFACT_PATH, { readOnly: true });
  const meta = new Map<number, string | null>();
  try {
    for (let start = 0; start < ids.length; start += CATALOGUE_BY_ID_CHUNK) {
      const chunk = ids.slice(start, start + CATALOGUE_BY_ID_CHUNK);
      const rows = db
        .prepare(buildCatalogueByIdSql(chunk.length))
        .all(...chunk) as Array<Record<string, unknown>>;
      for (const row of rows) {
        const raw = row.composer == null ? '' : String(row.composer).trim();
        meta.set(Number(row.tune_id), raw === '' ? null : raw);
      }
    }
  } finally {
    db.close();
  }
  return meta;
}

/**
 * Un `PATCH` por fila, filtrado por `composer=is.null`. La respuesta trae las
 * filas tocadas: vacía significa que otra pasada la rellenó antes y no es un
 * fallo.
 */
async function patchComposer(keys: Keys, tune: TuneRow, composer: string): Promise<boolean> {
  const query = new URLSearchParams({
    origin: 'eq.thesession',
    origin_ref: `eq.${tune.origin_ref}`,
    composer: 'is.null',
    select: 'id',
  });
  const response = await fetch(`${keys.url}/rest/v1/pr_tunes?${query}`, {
    method: 'PATCH',
    headers: {
      apikey: keys.serviceRole,
      Authorization: `Bearer ${keys.serviceRole}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ composer }),
  });
  if (!response.ok) {
    throw new Error(
      `PATCH pr_tunes origin_ref=${tune.origin_ref} respondió ${response.status}: ${await response.text()}`
    );
  }
  const touched = (await response.json()) as unknown[];
  return touched.length > 0;
}

async function main(): Promise<void> {
  const keys = readKeys();
  const tunes = await fetchTunes(keys);
  if (tunes.length === 0) {
    console.log('pr_tunes no tiene filas de TheSession: no hay nada que rellenar.');
    return;
  }

  const ids = tunes
    .map((tune) => Number(tune.origin_ref))
    .filter((id) => Number.isInteger(id) && id > 0);
  const byId = composerById(ids);

  const toFill: Array<{ tune: TuneRow; composer: string }> = [];
  let alreadySet = 0;
  let withoutComposer = 0;
  let absentFromArtifact = 0;

  for (const tune of tunes) {
    if (tune.composer !== null) {
      alreadySet += 1;
      continue;
    }
    const id = Number(tune.origin_ref);
    const composer = byId.get(id) ?? null;
    if (composer === null) {
      withoutComposer += 1;
      if (!byId.has(id)) absentFromArtifact += 1;
      continue;
    }
    toFill.push({ tune, composer });
  }

  console.log(`pr_tunes (origin=thesession): ${tunes.length} filas`);
  console.log(`  rellenables:               ${toFill.length}`);
  console.log(`  ya tenían autor:           ${alreadySet}`);
  console.log(
    `  sin autor en el artefacto: ${withoutComposer}` +
      ` (de ellas, ${absentFromArtifact} ni siquiera están en el artefacto)`
  );

  if (toFill.length > 0) {
    console.log('  ejemplos:');
    for (const { tune, composer } of toFill.slice(0, 5)) {
      console.log(`    ${tune.name} — ${composer}`);
    }
  }

  if (!apply) {
    console.log('\nEn seco: no se ha escrito nada. Usa --apply para escribir.');
    return;
  }

  let written = 0;
  let skipped = 0;
  for (const { tune, composer } of toFill) {
    if (await patchComposer(keys, tune, composer)) written += 1;
    else skipped += 1;
  }

  console.log(`\nAplicado: ${written} filas escritas, ${skipped} ya tenían valor.`);
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
});
