// @vitest-environment node
/**
 * Integración real de la importación del tunebook (#32), contra el servicio.
 *
 * La suite normal del repo **no toca la red**: esta se salta sola salvo que se
 * pida explícitamente (patrón de `practice.integration.test.ts` e
 * `image-search.integration.test.ts`):
 *
 *   RUN_SESSION_INTEGRATION=1 npx vitest run src/lib/thesession-import.integration.test.ts
 *
 * Lo que comprueba, y que ningún mock comprueba:
 *   1. El tunebook de una cuenta conocida llega **entero y paginado**, sin ids
 *      repetidos: el bucle de páginas y el deduplicado funcionan de verdad.
 *   2. Los ids son números positivos, los nombres no vienen vacíos y las fechas
 *      salen ISO con `Z` (o `null`), que es lo que acepta `pr_repertoire.added_at`.
 *   3. El buscador resuelve el nombre de usuario al id de la ficha — el camino
 *      que existe porque `/members/<nombre>/tunebook` da 404.
 *   4. Una cuenta borrada responde **410** y se clasifica como `gone`, no como
 *      `http`: es el error que la pantalla tiene que saber nombrar.
 */
import { describe, expect, it } from 'vitest';
import { SESSION_PER_PAGE, parseMemberId } from './thesession-import';
import { SessionImportError, fetchTunebook, searchMembers } from './thesession-api';

const enabled = Boolean(process.env.RUN_SESSION_INTEGRATION);

/** Cuenta de referencia: 421 tunes medidos el 2026-10-30. */
const MEMBER_ID = 99727;
/** Cuenta borrada: el servicio responde 410 en la ficha y en el tunebook. */
const GONE_MEMBER_ID = 777;

describe.skipIf(!enabled)('tunebook en vivo', () => {
  it('trae el tunebook entero, paginado y sin ids repetidos', async () => {
    const pageSizes: number[] = [];
    const tunes = await fetchTunebook(MEMBER_ID, (page) => pageSizes.push(page.tunes.length));

    expect(tunes.length).toBeGreaterThan(400);
    expect(pageSizes.length).toBeGreaterThan(1);
    // Ninguna página puede exceder lo pedido: si el API ignorara `perpage`,
    // el tope de 2000 tunes se quedaría corto sin avisar.
    expect(Math.max(...pageSizes)).toBeLessThanOrEqual(SESSION_PER_PAGE);

    const ids = tunes.map((tune) => tune.tuneId);
    expect(new Set(ids).size).toBe(ids.length);

    for (const tune of tunes) {
      expect(Number.isInteger(tune.tuneId) && tune.tuneId > 0).toBe(true);
      expect(tune.name.trim()).not.toBe('');
      if (tune.addedAt !== null) {
        expect(tune.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      }
    }

    // La fecha de alta en el tunebook existe para casi todo: es el dato con el
    // que el import evita que 400 filas digan «añadida hoy».
    const withDate = tunes.filter((tune) => tune.addedAt !== null).length;
    expect(withDate).toBeGreaterThan(tunes.length * 0.9);
  }, 60_000);

  it('resuelve el nombre de usuario al id de la ficha', async () => {
    const members = await searchMembers('crivote');
    expect(members.map((member) => member.id)).toContain(MEMBER_ID);
    expect(parseMemberId(`https://thesession.org/members/${MEMBER_ID}`)).toBe(MEMBER_ID);
  }, 30_000);

  it('una cuenta borrada responde 410 y se clasifica como gone', async () => {
    let caught: unknown = null;
    try {
      await fetchTunebook(GONE_MEMBER_ID);
    } catch (cause) {
      caught = cause;
    }

    expect(caught).toBeInstanceOf(SessionImportError);
    const error = caught as SessionImportError;
    expect(error.kind).toBe('gone');
    expect(error.status).toBe(410);
  }, 30_000);
});
