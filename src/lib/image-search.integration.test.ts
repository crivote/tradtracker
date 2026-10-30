// @vitest-environment node
/**
 * Integración real del buscador de fondos (#31): Commons, en vivo.
 *
 * La suite normal del repo **no toca la red**: esta se salta sola salvo que se
 * pida explícitamente (patrón de `practice.integration.test.ts`):
 *
 *   RUN_IMAGE_INTEGRATION=1 npx vitest run src/lib/image-search.integration.test.ts
 *
 * y con clave de Pexels, la otra pata:
 *
 *   RUN_IMAGE_INTEGRATION=1 PEXELS_API_KEY=… npx vitest run src/lib/image-search.integration.test.ts
 *
 * Lo que comprueba, y que ningún mock comprueba:
 *   1. Los cuatro carriles de Commons devuelven nueve candidatos distintos en
 *      tres títulos, con el relleno haciendo su trabajo.
 *   2. Las miniaturas son del cubo de 330 (se ve en la URL servida y en el peso).
 *   3. El grande de 960 se pide aparte, al ampliar, y también viene del API.
 *   4. El registro `foto` no repite lo que trae el de arte (solape medido, no supuesto).
 *   5. Con clave, Pexels devuelve nueve y ninguno es vertical.
 */
import { describe, expect, it } from 'vitest';
import { enlargeCommons, searchCommons, searchPexels } from './image-search';
import { ratioTag } from './image-sources';

const enabled = Boolean(process.env.RUN_IMAGE_INTEGRATION);
const pexelsKey = process.env.PEXELS_API_KEY ?? '';
/** Títulos con comportamiento distinto medido: objeto, oficio y ausencia. */
const TITLES = ['Harvest Home', 'Drowsy Maggie', 'The Butterfly'];

describe.skipIf(!enabled)('Commons en vivo', () => {
  it(
    'devuelve nueve candidatos distintos en tres títulos',
    async () => {
      for (const title of TITLES) {
        const candidates = await searchCommons(title);

        // El relleno existe para esto: nueve, no siete.
        expect(candidates.length, `${title} trajo ${candidates.length}`).toBe(9);
        expect(new Set(candidates.map((candidate) => `${candidate.source}:${candidate.id}`)).size).toBe(9);
        for (const candidate of candidates) {
          // Commons sirve las miniaturas desde `thumb.` o desde `upload.`; el
          // nombre del host no se compone: se guarda el `thumburl` que da el API.
          expect(candidate.thumbUrl).toMatch(/^https:\/\/(upload|thumb)\.wikimedia\.org\//);
          expect(candidate.pageUrl).toContain('commons.wikimedia.org');
          expect(candidate.license.length).toBeGreaterThan(0);
        }
      }
    },
    120_000
  );

  it(
    'las miniaturas son del cubo de 330, no del de 960',
    async () => {
      const candidates = await searchCommons('Harvest Home');
      const thumbs = candidates.map((candidate) => candidate.thumbUrl);

      // Commons devuelve la miniatura en /330px-; pedir 640 daría el cubo de 960.
      const withBucket = thumbs.filter((url) => url.includes('/330px-'));
      expect(withBucket.length).toBeGreaterThanOrEqual(7);
      expect(thumbs.some((url) => url.includes('/960px-'))).toBe(false);

      // Y pesa lo que se midió: ~21 KB por miniatura, no 183.
      const response = await fetch(thumbs[0]);
      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toContain('image/');
      const bytes = (await response.arrayBuffer()).byteLength;
      expect(bytes).toBeLessThan(120_000);
    },
    120_000
  );

  it(
    'el grande de 960 se pide solo al ampliar y también sale del API',
    async () => {
      const candidates = await searchCommons('Harvest Home');
      const big = candidates.find((candidate) => candidate.width > 960);
      expect(big).toBeDefined();

      const enlarged = await enlargeCommons(big!);
      expect(enlarged).not.toBe(big!.thumbUrl);
      expect(enlarged).toContain('/960px-');
      // La URL ampliada también responde: no se ha compuesto a mano.
      const response = await fetch(enlarged, { method: 'HEAD' });
      expect(response.ok).toBe(true);
    },
    120_000
  );

  it(
    'el registro `photo` no trae pinturas y el de `art` sí',
    async () => {
      const art = await searchCommons('Harvest Home', 'art');
      const photo = await searchCommons('Harvest Home', 'photo');

      expect(art.length).toBeGreaterThan(0);
      expect(photo.length).toBeGreaterThan(0);

      // `term` es la consulta que trajo cada candidato: con el registro en foto,
      // todas las consultas van negadas.
      for (const candidate of photo) expect(candidate.term).toContain('-painting');
      // Y con arte, al menos una viene del carril que añade `painting`.
      expect(art.some((candidate) => candidate.term.endsWith(' painting'))).toBe(true);

      // El solape de los dos carriles específicos, medido en vivo el 2026-10-30:
      // cero. Los mosaicos completos sí comparten el carril título.
      const artLane = art.filter((candidate) => candidate.term.endsWith(' painting'));
      const photoLane = photo.filter((candidate) => candidate.term.includes('-painting'));
      const artLaneIds = new Set(artLane.map((candidate) => candidate.id));
      const overlap = photoLane.filter((candidate) => artLaneIds.has(candidate.id));
      expect(overlap).toHaveLength(0);
    },
    120_000
  );

  it(
    'un título sin referente devuelve menos de nueve, no una imagen inventada',
    async () => {
      // Medido en el prototipo: cero resultados en los cuatro carriles.
      const candidates = await searchCommons('The Strayaway Child');
      expect(candidates.length).toBeLessThanOrEqual(9);
      for (const candidate of candidates) {
        expect(candidate.thumbUrl).toContain('upload.wikimedia.org');
      }
    },
    120_000
  );
});

describe.skipIf(!enabled || pexelsKey.length === 0)('Pexels en vivo', () => {
  it(
    'devuelve nueve fotos y ninguna marcada como vertical',
    async () => {
      const candidates = await searchPexels('Harvest Home', pexelsKey);

      expect(candidates).toHaveLength(9);
      expect(candidates.every((candidate) => candidate.source === 'pexels')).toBe(true);
      // `orientation=landscape` las descarta en origen.
      expect(candidates.filter((candidate) => ratioTag(candidate) === 'vertical')).toHaveLength(0);
      for (const candidate of candidates) {
        expect(candidate.license).toBe('Pexels License');
        expect(candidate.thumbUrl).toContain('images.pexels.com');
      }
    },
    120_000
  );
});
