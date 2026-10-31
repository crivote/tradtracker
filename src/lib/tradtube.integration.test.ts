// @vitest-environment node
/**
 * Integración real del adaptador de TradTube (#37), contra el servicio.
 *
 * La suite normal del repo **no toca la red**: esta se salta sola salvo que se
 * pida explícitamente (mismo patrón que `thesession-import.integration.test.ts`
 * y `practice.integration.test.ts`):
 *
 *   RUN_TRADTUBE_INTEGRATION=1 npx vitest run src/lib/tradtube.integration.test.ts
 *
 * Las credenciales son las **públicas** de TradTube (`VITE_TRADTUBE_URL`,
 * `VITE_TRADTUBE_ANON`); sin ellas el adaptador devuelve un mapa vacío y estas
 * pruebas fallarían por la razón equivocada, así que también hay que tenerlas.
 *
 * Lo que comprueba, y que ningún doble comprueba:
 *   1. La petición única con `tune_id=in.(…)` y el filtro sobre el recurso
 *      embebido atraviesa de verdad el PostgREST de TradTube con la clave
 *      anónima, y el `select` con el recurso embebido no da 400.
 *   2. Un `tune_id` de control con vídeo conocido devuelve sus segmentos (el 67:
 *      hay una entrada de 0 a 140 s).
 *   3. Un id que no existe **no aparece** en el mapa: la clave ausente es la
 *      forma de decir «esta tune no tiene vídeo».
 */
import { describe, expect, it } from 'vitest';
import { fetchSegments } from './tradtube';

const enabled = Boolean(process.env.RUN_TRADTUBE_INTEGRATION);

/** Control: tiene vídeo (una entrada, 0–140 s, medida el 2026-10-31). */
const TUNE_WITH_VIDEO = '67';
/** Control negativo: no es un `tune_id` de TradTube. */
const TUNE_WITHOUT_VIDEO = '99999999';

describe.skipIf(!enabled)('TradTube en vivo', () => {
  it('devuelve los segmentos de una tune con vídeo conocido, en una sola petición', async () => {
    const map = await fetchSegments([TUNE_WITH_VIDEO]);

    const segments = map.get(TUNE_WITH_VIDEO);
    expect(segments).toBeDefined();
    expect(segments!.length).toBeGreaterThan(0);

    const first = segments![0];
    expect(first.startSec).toBe(0);
    // `end_sec` es nullable en la base: el control admite null, pero si viene
    // tiene que ser un fin posterior al principio.
    if (first.endSec !== null) expect(first.endSec).toBeGreaterThan(first.startSec);
    expect(segments!.some((segment) => segment.endSec === 140)).toBe(true);
    expect(first.youtubeId).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(first.originRef).toBe(TUNE_WITH_VIDEO);
  }, 30_000);

  it('un id sin vídeos no aparece en el mapa', async () => {
    const map = await fetchSegments([TUNE_WITH_VIDEO, TUNE_WITHOUT_VIDEO]);

    expect(map.has(TUNE_WITH_VIDEO)).toBe(true);
    expect(map.has(TUNE_WITHOUT_VIDEO)).toBe(false);
  }, 30_000);
});
