#!/usr/bin/env node
/**
 * Copia el artefacto de catálogo `thesession.db` desde el repo de TradTube y
 * deja junto a él un fichero de procedencia (`thesession.meta.json`).
 *
 * Por qué un sidecar y no «la cabecera del fichero»: la cabecera de SQLite son
 * 100 bytes de campos binarios (page size, versiones, change counter…) y 32 bits
 * de `user_version`/`application_id`. No hay hueco de texto donde escribir una
 * fecha y un sha, y el catálogo no se edita aquí (issue #4). El sidecar guarda lo
 * mismo que se pedía —fecha de generación, commit de origen y huella— en un
 * formato que la app puede leer y que un humano puede auditar.
 *
 * Uso:
 *   node scripts/fetch-catalogue.mjs [--source <ruta/al/thesession.db>]
 *
 * Idempotente: reejecutarlo reescribe la copia y el sidecar. Nunca inventa
 * metadatos: si no puede leer el commit de origen, escribe `null` y lo dice.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_SOURCE = process.env.THESESSION_DB_SOURCE
  ?? '/home/victor/Proyectos/tradtube/public/thesession.db';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const source = resolve(argValue('--source') ?? DEFAULT_SOURCE);
const target = join(projectRoot, 'public', 'thesession.db');
const metaPath = join(projectRoot, 'public', 'thesession.meta.json');

if (!existsSync(source)) {
  console.error(`No existe el artefacto de origen: ${source}`);
  console.error('Pásalo con --source <ruta> o define THESESSION_DB_SOURCE.');
  process.exit(1);
}

/** Lee la base con el SQLite nativo de Node (>=22.5). Si no está, seguimos sin métricas. */
async function inspect(path) {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const one = (sql) => db.prepare(sql).get();
      const columns = db.prepare('PRAGMA table_info(tunes)').all().map((row) => row.name);
      const tunes = one('SELECT count(*) AS n FROM tunes').n;
      const withAliases = one("SELECT count(*) AS n FROM tunes_search WHERE aliases IS NOT NULL AND aliases <> ''").n;
      return { tunes, withAliases, columns };
    } finally {
      db.close();
    }
  } catch (cause) {
    console.warn(`No se pudo inspeccionar el artefacto con node:sqlite: ${cause.message}`);
    return { tunes: null, withAliases: null, columns: null };
  }
}

/** Commit del repo de origen: sin él, el sidecar lo declara desconocido. */
function sourceCommit(dir) {
  try {
    const full = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const date = execFileSync('git', ['-C', dir, 'show', '-s', '--format=%cI', 'HEAD'], { encoding: 'utf8' }).trim();
    const subject = execFileSync('git', ['-C', dir, 'show', '-s', '--format=%s', 'HEAD'], { encoding: 'utf8' }).trim();
    return { commit: full, commit_date: date, commit_subject: subject };
  } catch (cause) {
    console.warn(`No se pudo leer el commit del repo de origen: ${cause.message}`);
    return { commit: null, commit_date: null, commit_subject: null };
  }
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);

const stats = await inspect(target);
const origin = sourceCommit(dirname(dirname(source)));
const bytes = statSync(target).size;
const sha256 = createHash('sha256').update(readFileSync(target)).digest('hex');

// Un artefacto sin catálogo pasaría el copy y rompería la app en el navegador.
if (stats.tunes !== null && stats.tunes < 20000) {
  console.error(`El artefacto copiado solo tiene ${stats.tunes} tunes: se esperaban >20.000. Abortado.`);
  process.exit(1);
}

const meta = {
  source_path: source,
  source_repo: origin.commit ? 'crivote/tradtube' : null,
  source_commit: origin.commit,
  source_commit_date: origin.commit_date,
  source_commit_subject: origin.commit_subject,
  copied_at: new Date().toISOString(),
  bytes,
  sha256,
  tunes: stats.tunes,
  tunes_with_aliases: stats.withAliases,
  columns: stats.columns,
  note: 'Copia de solo lectura del artefacto de TradTube. No se edita en tradtracker (issue #4).',
};

writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

console.log(`Copiado  ${source}`);
console.log(`     ->  ${target}`);
console.log(`        ${(bytes / 1024 / 1024).toFixed(2)} MB · ${stats.tunes ?? '?'} tunes · ${stats.withAliases ?? '?'} con alias`);
console.log(`        sha256 ${sha256.slice(0, 16)}…`);
console.log(`        commit origen ${origin.commit ? origin.commit.slice(0, 8) : 'desconocido'}`);
console.log(`Sidecar ${metaPath}`);
