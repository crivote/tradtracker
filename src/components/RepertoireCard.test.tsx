// @vitest-environment jsdom
/**
 * La carta y su menú, montados de verdad (#29).
 *
 * Lo que se comprueba aquí es lo que el modelo puro no puede: que el tag lleve
 * pintado su color, que el medidor dibuje medio punto en el DOM, que sin
 * tonalidad se lea `key not set` y que el menú de tres puntos mantenga uno solo
 * abierto, cierre con `Escape` y con clic fuera y exponga `aria-expanded`.
 *
 * Vitest corre sin globals: cada test importa lo suyo y `afterEach(cleanup)` se
 * declara aquí, no en una configuración de setup.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { MemoryRouter, Route, createMemoryHistory } from '@solidjs/router';
import TuneCard from './TuneCard';
import type { RepertoireRow } from '../lib/repertoire-model';

const NOW = Date.parse('2026-10-28T12:00:00Z');

function daysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

function row(overrides: Partial<RepertoireRow> = {}): RepertoireRow {
  return {
    id: 'row-a',
    status: 'to_learn',
    shelved: false,
    favorite: false,
    rating: null,
    custom_title: null,
    custom_rhythm: null,
    custom_key: null,
    customAbc: null,
    notes: null,
    added_at: '2026-09-01T10:00:00Z',
    last_practiced_at: null,
    tune: {
      id: 'tune-a',
      origin: 'thesession',
      origin_ref: '55',
      name: 'Kesh, The',
      rhythm: 'Jig',
      meter: '6/8',
      key: 'D',
      abc: null,
    },
    image: null,
    practice_count: null,
    avg_quality: null,
    days_since_last_practice: null,
    ...overrides,
  };
}

/** Monta una o varias cartas dentro del router: la carta enlaza al detalle. */
function mount(rows: RepertoireRow[]) {
  const history = createMemoryHistory();
  history.set({ value: '/' });
  const onPractise = vi.fn();
  const view = render(() => (
    <MemoryRouter history={history}>
      <Route
        path="/"
        component={() => (
          <div class="repertoire-home">
            {rows.map((item) => (
              <TuneCard row={item} now={NOW} onPractise={onPractise} />
            ))}
          </div>
        )}
      />
      <Route path="/repertoire/:id" component={() => <p>detail</p>} />
    </MemoryRouter>
  ));
  return { ...view, onPractise };
}

const kebabOf = (index = 0) => screen.getAllByRole('button', { name: /^Actions for/ })[index];

afterEach(() => cleanup());

describe('la carta (#29)', () => {
  it('muestra el título normalizado, el ritmo y la tonalidad', () => {
    const { container } = mount([row()]);
    expect(screen.getByRole('link', { name: 'The Kesh' })).toBeTruthy();
    // Ritmo y tonalidad van en la misma línea: «Jig · D».
    const meta = container.querySelector('.tune-meta')?.textContent?.replace(/\s+/g, ' ').trim();
    expect(meta).toBe('Jig · D');
  });

  it('sin tonalidad escribe «key not set» en vez de un guion', () => {
    mount([row({ tune: { ...row().tune, key: null } })]);
    expect(screen.getByText('key not set')).toBeTruthy();
    expect(screen.queryByText('—')).toBeNull();
  });

  it('sin foto la carta va sobre papel; con foto, con imagen y sin velo', () => {
    const { container } = mount([row()]);
    const bare = container.querySelector('.card');
    expect(bare?.classList.contains('card--bare')).toBe(true);
    expect(container.querySelector('img')).toBeNull();

    cleanup();
    const withImage = mount([
      row({
        image: {
          source: 'commons',
          id: 'File.jpg',
          thumbUrl: 'https://example.invalid/thumb.jpg',
          fullUrl: 'https://example.invalid/full.jpg',
          pageUrl: null,
          author: 'Someone',
          license: 'CC BY-SA 4.0',
          licenseUrl: null,
          focalX: 30,
          focalY: 70,
          zoom: 1.4,
          chosenAt: null,
        },
      }),
    ]);
    const photo = withImage.container.querySelector('.card');
    expect(photo?.classList.contains('card--photo')).toBe(true);
    const img = withImage.container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('style')).toContain('object-position: 30% 70%');
  });

  it('el tag dice «never» y lleva el extremo cálido del gradiente', () => {
    const { container } = mount([row()]);
    const tag = container.querySelector('.tag') as HTMLElement;
    expect(tag.textContent?.trim()).toBe('never');
    expect(tag.getAttribute('title')).toBe('Never practiced');
    expect(tag.getAttribute('style')).toMatch(/186,\s*95,\s*62/);
  });

  it('el color del tag sale de los días crudos: 3 días es rgb(235,214,197)', () => {
    const { container } = mount([row({ last_practiced_at: daysAgo(3) })]);
    const tag = container.querySelector('.tag') as HTMLElement;
    expect(tag.textContent?.trim()).toBe('3 days');
    expect(tag.getAttribute('style')).toMatch(/235,\s*214,\s*197/);
    expect(container.querySelector('.card')?.getAttribute('data-days')).toBe('3');
  });

  it('a 90 días el tag está en teja y el texto va en blanco', () => {
    const { container } = mount([row({ last_practiced_at: daysAgo(90) })]);
    const tag = container.querySelector('.tag') as HTMLElement;
    expect(tag.textContent?.trim()).toBe('90 days');
    expect(tag.getAttribute('style')).toMatch(/186,\s*95,\s*62/);
    // jsdom normaliza el color: el blanco del extremo cálido.
    expect(tag.getAttribute('style')).toMatch(/255,\s*255,\s*255/);
  });

  it('el medidor dibuja medio punto con una media de 2,5', () => {
    const { container } = mount([row({ practice_count: 8, avg_quality: 2.5 })]);
    const dots = [...container.querySelectorAll('.q i')].map((dot) => dot.className);
    expect(dots).toEqual(['on', 'on', 'half', 'off', 'off']);
    expect(container.querySelector('.quality .n')?.textContent).toBe('2.5 avg · 8 practices');
    expect(container.querySelector('.quality')?.getAttribute('aria-label')).toBe(
      'Average quality 2.5 of 5 over 8 practices'
    );
  });

  it('sin ensayos no pinta medidor y lo dice en itálica', () => {
    const { container } = mount([row({ practice_count: 0, avg_quality: null })]);
    expect(container.querySelector('.q')).toBeNull();
    const quality = container.querySelector('.quality') as HTMLElement;
    expect(quality.textContent?.trim()).toBe('no sessions yet');
    expect(quality.classList.contains('none')).toBe(true);
  });

  it('sin vista de agregados se lee igual: no se estima nada', () => {
    const { container } = mount([row({ practice_count: null, avg_quality: null })]);
    expect(container.querySelector('.quality')?.textContent?.trim()).toBe('no sessions yet');
    expect(container.querySelector('.q')).toBeNull();
  });

  it('el medidor va en todas las cartas, no solo en las bandas de trabajo', () => {
    // Regla retirada el 2026-10-31: la densidad de biblioteca escondía el
    // medidor justamente donde hay historial de ensayos. Ahora se pinta siempre.
    const { container } = mount([row({ practice_count: 4, avg_quality: 4 })]);
    expect(container.querySelector('.card')?.classList.contains('tile')).toBe(false);
    expect(container.querySelector('.quality')).toBeTruthy();
    expect(container.querySelectorAll('.q i').length).toBe(5);
  });
});

describe('el menú de tres puntos (#29)', () => {
  it('abre con las cuatro acciones y expone aria-expanded', () => {
    mount([row()]);
    const kebab = kebabOf();
    expect(kebab.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(kebab);
    expect(kebab.getAttribute('aria-expanded')).toBe('true');

    const items = screen.getAllByRole('menuitem').map((item) => item.textContent?.trim());
    expect(items).toEqual(['View details', 'Edit details', 'Add to set', 'Practise']);

    // «Add to set» no tiene destino todavía (#15): se anuncia, no se esconde.
    const sets = screen.getByRole('menuitem', { name: 'Add to set' });
    expect((sets as HTMLButtonElement).disabled).toBe(true);
  });

  it('se cierra al volver a pulsar el disparador', () => {
    mount([row()]);
    const kebab = kebabOf();
    fireEvent.click(kebab);
    fireEvent.click(kebab);
    expect(kebab.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelectorAll('.menu.open').length).toBe(0);
  });

  it('mantiene un solo menú abierto aunque haya cartas de sobra', () => {
    mount([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]);
    const [first, second] = screen.getAllByRole('button', { name: /^Actions for/ });

    fireEvent.click(first);
    fireEvent.click(second);

    expect(document.querySelectorAll('.menu.open').length).toBe(1);
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(second.getAttribute('aria-expanded')).toBe('true');
  });

  it('se cierra con Escape', async () => {
    mount([row()]);
    const kebab = kebabOf();
    fireEvent.click(kebab);
    // El efecto que registra los escuchantes corre después del render.
    await Promise.resolve();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(kebab.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelectorAll('.menu.open').length).toBe(0);
  });

  it('se cierra con un clic fuera', async () => {
    mount([row()]);
    const kebab = kebabOf();
    fireEvent.click(kebab);
    await Promise.resolve();

    fireEvent.click(document.body);

    expect(kebab.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelectorAll('.menu.open').length).toBe(0);
  });

  it('«Practise» apunta el ensayo y cierra el menú', async () => {
    const { onPractise } = mount([row()]);
    const kebab = kebabOf();
    fireEvent.click(kebab);
    await Promise.resolve();

    const target = row();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Practise' }));

    expect(onPractise).toHaveBeenCalledTimes(1);
    expect(onPractise.mock.calls[0][0]).toMatchObject({ id: target.id });
    expect(document.querySelectorAll('.menu.open').length).toBe(0);
  });

  it('«View details» enlaza al detalle de esa fila', () => {
    mount([row({ id: 'row-42' })]);
    fireEvent.click(kebabOf());
    const link = screen.getByRole('menuitem', { name: 'View details' });
    expect(link.getAttribute('href')).toBe('/repertoire/row-42');
  });
});
