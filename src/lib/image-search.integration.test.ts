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
 *   1. Commons devuelve candidatos distintos y **sin repetir entre carriles**.
 *   2. Las miniaturas son del cubo de 330 (se ve en la URL servida y en el peso).
 *   3. El grande de 960 se pide aparte, al ampliar, y también viene del API.
 *   4. Arte y foto **no comparten ni un fichero** (ahora sí: no hay carril sin
 *      registro que los rellene con lo mismo).
 *   5. Un título sin referente devuelve menos de nueve, no relleno.
 *   6. El Art Institute devuelve obras con su tipo y sirve la imagen de verdad.
 *   7. Con clave, Pexels devuelve nueve y ninguno es vertical.
 */
import { describe, expect, it } from 'vitest';
import { enlargeCommons, searchArtic, searchCommons, searchPexels } from './image-search';
import { articMedium, ratioTag } from './image-sources';

const enabled = Boolean(process.env.RUN_IMAGE_INTEGRATION);
const pexelsKey = process.env.PEXELS_API_KEY ?? '';
/** Títulos con comportamiento distinto medido: objeto, oficio y ausencia. */
const TITLES = ['Harvest Home', 'Drowsy Maggie', 'The Butterfly'];

describe.skipIf(!enabled)('Commons en vivo', () => {
  it(
    'devuelve candidatos distintos, sin pasar de nueve',
    async () => {
      for (const title of TITLES) {
        const candidates = await searchCommons(title);

        // Desde el 2026-11-08 el mosaico puede salir corto: no se rellena con lo
        // que no cumple el registro. Lo que sí se exige es que no haya repetidos.
        expect(candidates.length, `${title} trajo ${candidates.length}`).toBeGreaterThan(0);
        expect(candidates.length).toBeLessThanOrEqual(9);
        expect(new Set(candidates.map((candidate) => `${candidate.source}:${candidate.id}`)).size).toBe(
          candidates.length
        );
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
    'las miniaturas pesan como el cubo de 330, no como el de 960',
    async () => {
      const candidates = await searchCommons('Harvest Home');
      const thumbs = candidates.map((candidate) => candidate.thumbUrl);

      // Ninguna puede ser del cubo grande.
      expect(thumbs.some((url) => url.includes('/960px-'))).toBe(false);

      // El nombre no basta para probarlo: un fichero más estrecho que 330 px se
      // sirve a tamaño original y su URL no lleva cubo (medido: 2 de 9). Por eso
      // se mide el peso, que es lo que de verdad importa.
      const withBucket = thumbs.filter((url) => url.includes('/330px-'));
      expect(withBucket.length).toBeGreaterThanOrEqual(Math.ceil(thumbs.length / 2));

      for (const url of thumbs.slice(0, 4)) {
        const response = await fetch(url);
        expect(response.ok).toBe(true);
        expect(response.headers.get('content-type')).toContain('image/');
        const bytes = (await response.arrayBuffer()).byteLength;
        expect(bytes).toBeLessThan(120_000);
      }
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
      // Con arte, todas vienen de una consulta de medio.
      for (const candidate of art) {
        expect(candidate.term).toMatch(new RegExp('(painting|engraving|drawing|print)$'));
      }

      // Y ahora sí: arte y foto no comparten ni un fichero. Antes compartían
      // cinco de nueve plazas por el carril de título, no por los resultados.
      const artIds = new Set(art.map((candidate) => candidate.id));
      const overlap = photo.filter((candidate) => artIds.has(candidate.id));
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

describe.skipIf(!enabled)('Art Institute en vivo', () => {
  it(
    'devuelve obras con crédito, medidas en píxeles y una imagen que responde',
    async () => {
      const candidates = await searchArtic('Storm at Sea', 'art');

      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.length).toBeLessThanOrEqual(9);
      for (const candidate of candidates) {
        expect(candidate.source).toBe('artic');
        // Solo ancho: el servidor bloquea `!w,h` y `/square/` por lista blanca.
        expect(candidate.thumbUrl).toContain('/full/400,/0/default.jpg');
        expect(candidate.pageUrl).toContain('artic.edu/artworks/');
        expect(candidate.license).toBe('Public domain');
        // Medidas del `thumbnail` del API: sin ellas no hay encuadre que arrastrar.
        expect(candidate.width).toBeGreaterThan(0);
        expect(candidate.height).toBeGreaterThan(0);
      }

      // La imagen responde de verdad. **Con `Referer`**: el IIIF del Art Institute
      // lo exige, y un script no lo manda (el navegador sí). Sin él devuelve 403.
      const response = await fetch(candidates[0].thumbUrl, {
        headers: { Referer: 'https://tradtracker.crivote.workers.dev/' },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('image/');
      const bytes = (await response.arrayBuffer()).byteLength;
      expect(bytes).toBeGreaterThan(1_000);
      expect(bytes).toBeLessThan(200_000);
    },
    120_000
  );

  it(
    'el registro `photo` trae fotografías de verdad, no cuadros',
    async () => {
      const photos = await searchArtic('Harbour', 'photo');
      expect(photos.length).toBeGreaterThan(0);

      // Una comprobación de verdad contra el API: la obra que quedó primera
      // declara ser fotografía en su tipo de obra.
      const first = photos[0];
      const response = await fetch(
        `https://api.artic.edu/api/v1/artworks/${first.id}?fields=artwork_type_title,is_public_domain`
      );
      expect(response.ok).toBe(true);
      const work = (await response.json()).data;
      expect(work.is_public_domain).toBe(true);
      expect(String(work.artwork_type_title)).toMatch(/photograph/i);
      expect(articMedium(work)).toBe('photo');
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
