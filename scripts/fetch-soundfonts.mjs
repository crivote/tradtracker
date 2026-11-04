#!/usr/bin/env node
/**
 * Trae los samples del reproductor ABC (#38) al repo.
 *
 * El reproductor de `/practice` suena con samples **propios** servidos desde
 * `/soundfonts/`: `abcjs` compone la URL como
 * `soundFontUrl + instrumento + '-mp3/' + nota + '.mp3'`, así que la carpeta y
 * el nombre del fichero tienen que ser exactamente los del soundfont.
 *
 * De dónde salen y por qué así:
 *   · Origen: `gleitz/midi-js-soundfonts`, rama `gh-pages`, ruta
 *     `<soundfont>/<instrumento>-mp3/`. Son 88 ficheros por instrumento (~2,1 MB):
 *     de `A0` a `C8` con **bemoles** (`Ab1`, `Bb3`, `Gb2`), nunca sostenidos.
 *   · **El soundfont es por instrumento, no global**, y no es un capricho. Los
 *     parches `fiddle` y `whistle` de FluidR3 son de orquesta: el violín tarda
 *     más de un segundo en llegar al pico (un swell de cuerda) y la flauta es
 *     aire sin ataque. A 108 ppm una corchea dura 280 ms, así que la nota se
 *     apaga antes de que la muestra suene. Medido: a 50 ms el `fiddle` de
 *     FluidR3 está al 28 % de su energía y el `violin` de MusyngKite al 72 %; el
 *     `recorder` de MusyngKite pica en 20-60 ms en todas las octavas y el
 *     `whistle` de FluidR3 tarda 90-590 ms según la nota. MusyngKite es
 *     **CC BY-SA 3.0** (no CC BY 3.0), así que cada muestra lleva su licencia en
 *     `LICENSE.md` y en `/about`.
 *   · La lista se **lee del repositorio**, no se compone: componer los nombres
 *     es justo cómo se acaba con un `A#1.mp3` que no existe.
 *   · Los nombres coinciden con la tabla `pitchToNoteName` de `abcjs` (que
 *     también usa bemoles), así que no hay trampa de enarmonía.
 *
 * Uso:
 *   node scripts/fetch-soundfonts.mjs            # descarga lo que falte
 *   node scripts/fetch-soundfonts.mjs --force    # vuelve a bajarlo todo
 *
 * Es **idempotente**: lo que ya está descargado y no está vacío no se vuelve a
 * pedir, y no se reescribe nada que no haya cambiado. Se puede re-ejecutar sin
 * duplicar ni corromper. `GITHUB_TOKEN` en el entorno sube el límite de la API.
 *
 * Licencia de los samples: FluidR3_GM, CC BY 3.0. La atribución va en
 * `public/soundfonts/LICENSE.md` (lo escribe este script) y en `/about`.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const REPO = 'gleitz/midi-js-soundfonts';
const BRANCH = 'gh-pages';

/**
 * Soundfont por carpeta de samples. La carpeta es la que pide `abcjs` a partir
 * del programa General MIDI (`instrumentIndexToName`): 40 → `violin`, 74 →
 * `recorder`, 21 → `accordion`, 105 → `banjo`.
 */
const SOURCES = {
  violin: 'MusyngKite',
  recorder: 'MusyngKite',
  accordion: 'FluidR3_GM',
  banjo: 'FluidR3_GM',
};

/** Las carpetas que el reproductor sirve (una por instrumento de ensayo, #36). */
const INSTRUMENTS = Object.keys(SOURCES);

/** Cuántas descargas a la vez: suficiente para ir rápido sin castigar a GitHub. */
const CONCURRENCY = 6;

const here = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = resolve(here, '..', 'public', 'soundfonts');
const force = process.argv.includes('--force');

const apiHeaders = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'tradtracker-fetch-soundfonts',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

/**
 * La lista real de mp3 de un instrumento, tal y como la da GitHub. Se pagina
 * por si algún día hay más de cien entradas (hoy son 88).
 */
async function listNotes(instrument) {
  const names = [];
  for (let page = 1; page <= 10; page += 1) {
    const url =
      `https://api.github.com/repos/${REPO}/contents/${SOURCES[instrument]}/${instrument}-mp3` +
      `?ref=${BRANCH}&per_page=100&page=${page}`;
    const response = await fetch(url, { headers: apiHeaders });
    if (!response.ok) {
      throw new Error(`Cannot list ${instrument}-mp3: HTTP ${response.status} ${response.statusText}`);
    }
    const entries = await response.json();
    if (!Array.isArray(entries) || entries.length === 0) break;
    for (const entry of entries) {
      if (entry.type === 'file' && entry.name.endsWith('.mp3')) names.push(entry.name);
    }
    if (entries.length < 100) break;
  }

  if (names.length === 0) throw new Error(`The listing for ${instrument}-mp3 came back empty.`);
  return names.sort();
}

/** Tamaño del fichero, o 0 si no existe. Un fichero vacío cuenta como ausente. */
async function sizeOf(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

/**
 * Descarga un mp3 a su ruta. Escribe a un `.part` y renombra al final: si el
 * proceso muere a medias, no queda un mp3 truncado que la próxima pasada
 * creería bueno.
 */
async function download(instrument, name) {
  const dir = join(OUT_ROOT, `${instrument}-mp3`);
  const target = join(dir, name);
  const partial = `${target}.part`;
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${SOURCES[instrument]}/${instrument}-mp3/${name}`;

  const response = await fetch(url, { headers: { 'User-Agent': 'tradtracker-fetch-soundfonts' } });
  if (!response.ok || !response.body) {
    throw new Error(`Cannot download ${url}: HTTP ${response.status} ${response.statusText}`);
  }

  await mkdir(dir, { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  const written = await sizeOf(partial);
  if (written === 0) throw new Error(`Downloaded an empty file from ${url}`);
  // `rename` sobre un fichero existente es atómico en el mismo sistema de ficheros.
  await rename(partial, target);
  return written;
}

/** Ejecuta `tasks` con un máximo de `limit` en vuelo. */
async function pooled(tasks, limit) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (index < tasks.length) {
      const current = index;
      index += 1;
      await tasks[current]();
    }
  });
  await Promise.all(workers);
}

const LICENSE = `# Soundfont samples — attribution

The practice player in \`/practice\` synthesises tunes with **abcjs**, and abcjs
builds the URL of every note as \`soundFontUrl + instrument + '-mp3/' + note + '.mp3'\`.
This directory holds exactly those files, served by this app instead of a
third-party CDN, so the player works offline and the licence obligation stays
visible in the repository.

| Folder | Practice instrument | Soundfont | Licence |
|---|---|---|---|
| \`violin-mp3\` | fiddle | MusyngKite | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| \`recorder-mp3\` | whistle | MusyngKite | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| \`accordion-mp3\` | accordion | FluidR3_GM | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| \`banjo-mp3\` | banjo | FluidR3_GM | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |

- **Source:** [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts),
  branch \`gh-pages\`, path \`<soundfont>/<instrument>-mp3/*.mp3\`
- **Notes:** 88 per instrument (\`A0\` … \`C8\`), named the way the soundfont names
  them — flats (\`Ab1\`, \`Bb3\`, \`Gb2\`), never sharps (\`A#\`, \`F#\`). That is also
  the convention of abcjs's \`pitchToNoteName\` table, so no enharmonic mapping is
  needed.
- **Re-fetch:** \`node scripts/fetch-soundfonts.mjs\` (idempotent)

**Why two soundfonts.** The \`fiddle\` and \`whistle\` patches of FluidR3 are
orchestral: the fiddle takes more than a second to reach its peak (a string
swell) and the whistle is breath without an attack. At 108 bpm an eighth note
lasts 280 ms, so the note ends before the sample speaks. Measured at 50 ms, the
FluidR3 fiddle is at 28 % of its energy and the MusyngKite violin at 72 %; the
MusyngKite recorder peaks in 20-60 ms across the whole range, against 90-590 ms
for the FluidR3 whistle. The accordion and banjo were already articulated and
stay on FluidR3.

These files are unmodified copies of the published samples. Attribution is
required by both licences and is shown to the user in \`/about\`. The
Share-Alike term applies to these sample files, not to the application code.
`;

async function main() {
  await mkdir(OUT_ROOT, { recursive: true });

  let downloaded = 0;
  let skipped = 0;
  let bytes = 0;

  for (const instrument of INSTRUMENTS) {
    const names = await listNotes(instrument);
    process.stdout.write(`${instrument}: ${names.length} notes listed\n`);

    const pending = [];
    for (const name of names) {
      const target = join(OUT_ROOT, `${instrument}-mp3`, name);
      const already = force ? 0 : await sizeOf(target);
      if (already > 0) {
        skipped += 1;
        bytes += already;
        continue;
      }
      pending.push(async () => {
        const written = await download(instrument, name);
        downloaded += 1;
        bytes += written;
        process.stdout.write(`  + ${instrument}-mp3/${name} (${written} bytes)\n`);
      });
    }

    await pooled(pending, CONCURRENCY);
  }

  const licensePath = join(OUT_ROOT, 'LICENSE.md');
  const previous = await readFile(licensePath, 'utf8').catch(() => null);
  if (previous !== LICENSE) await writeFile(licensePath, LICENSE, 'utf8');

  const mib = (bytes / (1024 * 1024)).toFixed(2);
  process.stdout.write(
    `\nDone: ${downloaded} downloaded, ${skipped} already here (${mib} MB counted this pass).\n` +
      `Attribution written to public/soundfonts/LICENSE.md\n`
  );
}

main().catch((error) => {
  process.stderr.write(`\nfetch-soundfonts failed: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
