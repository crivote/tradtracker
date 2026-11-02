// @vitest-environment jsdom
/**
 * El gate del bloque de etiquetas, en su propio fichero (#48).
 *
 * La caché del vocabulario vive en el adaptador (`loadVocabulary`, en
 * `tags-db`) y dura toda la sesión de navegador; dentro de
 * `TuneDetail.test.tsx` el primer montaje ya la deja llena, así que el caso
 * «vocabulario vacío ⇒ no se pinta el bloque» solo se puede ejercitar con un
 * registro de módulos limpio: de ahí este fichero aparte. Aquí el vocabulario
 * vacío lo sirve el doble, porque el `loadVocabulary` real cachea el primero que
 * llegue y ese caso hay que forzarlo por prueba.
 *
 * Lo que se fija: sin facetas **no** hay un «Tags» vacío. Un bloque que promete
 * algo que no hay es peor que no tenerlo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { MemoryRouter, Route, createMemoryHistory } from '@solidjs/router';

vi.mock('../lib/repertoire', () => ({
  fetchRepertoireRow: vi.fn(),
  removeFromRepertoire: vi.fn(),
  saveStatus: vi.fn(),
  saveShelved: vi.fn(),
  saveOverrides: vi.fn(),
}));

vi.mock('../lib/tags-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tags-db')>();
  const fetchVocabulary = vi.fn();
  return {
    ...actual,
    fetchVocabulary,
    // Mismo contrato que el real, sobre el vocabulario simulado: así cada prueba
    // decide qué llega (aquí, facetas vacías).
    loadVocabulary: () => fetchVocabulary().catch(() => null),
    fetchTuneTags: vi.fn(),
    addTuneTags: vi.fn(),
    removeTuneTag: vi.fn(),
  };
});

import { fetchRepertoireRow } from '../lib/repertoire';
import { fetchTuneTags, fetchVocabulary } from '../lib/tags-db';
import TuneDetail from './TuneDetail';

const ROW = {
  id: 'row-a',
  status: 'learning',
  shelved: false,
  favorite: false,
  rating: 4,
  custom_title: null,
  custom_rhythm: null,
  custom_key: null,
  customAbc: null,
  notes: null,
  added_at: '2026-10-01T10:00:00Z',
  last_practiced_at: null,
  practice_count: null,
  avg_quality: null,
  days_since_last_practice: null,
  image: null,
  tune: {
    id: 'tune-a',
    origin: 'thesession',
    origin_ref: '55',
    name: 'Kesh, The',
    rhythm: 'jig',
    meter: '6/8',
    key: null,
    abc: null,
    composer: null,
  },
};

function renderAt(path: string) {
  const history = createMemoryHistory();
  history.set({ value: path });
  render(() => (
    <MemoryRouter history={history}>
      <Route path="/repertoire/:id" component={TuneDetail} />
      <Route path="/" component={() => <p>repertoire list</p>} />
    </MemoryRouter>
  ));
}

beforeEach(() => {
  vi.mocked(fetchRepertoireRow).mockReset();
  vi.mocked(fetchRepertoireRow).mockResolvedValue(ROW as any);
  vi.mocked(fetchVocabulary).mockReset();
  vi.mocked(fetchVocabulary).mockResolvedValue({ facets: [], tags: [] });
  vi.mocked(fetchTuneTags).mockReset();
  vi.mocked(fetchTuneTags).mockResolvedValue([]);
});

afterEach(() => cleanup());

describe('bloque de etiquetas sin vocabulario', () => {
  it('no pinta nada cuando el vocabulario viene vacío', async () => {
    renderAt('/repertoire/row-a');
    await waitFor(() => expect(screen.getByText('The Kesh')).toBeTruthy());

    // El resto del detalle sí está: el gate es del bloque, no de la pantalla.
    expect(screen.getByRole('button', { name: 'Edit details' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Tradition')).toBeNull());
    expect(screen.queryByRole('heading', { name: 'Tags' })).toBeNull();
  });

  it('pide las asignaciones una sola vez por visita, con el uuid de pr_tunes', async () => {
    renderAt('/repertoire/row-a');
    await waitFor(() => expect(screen.getByText('The Kesh')).toBeTruthy());
    await waitFor(() => expect(vi.mocked(fetchTuneTags)).toHaveBeenCalledTimes(1));
    // El id de la ruta es de repertorio: a la tabla se le pasa el de la tune.
    expect(vi.mocked(fetchTuneTags)).toHaveBeenCalledWith(['tune-a']);
  });
});
