/**
 * Modelo puro del fondo del tune (#31). Todo lo que aquí se prueba corre sin red:
 * consultas, fusión con cupo y relleno, ratio, licencias, matemática del encuadre
 * y parseo de las respuestas del API con fixtures reales recortadas.
 */
import { describe, expect, it } from 'vitest';
import {
  ART_MEDIA_TERMS,
  CANDIDATE_COUNT,
  LANE_QUOTAS,
  candidateKey,
  commonsQueries,
  cropGeometry,
  focalAfterDrag,
  focalPosition,
  imageRatio,
  isFreeLicense,
  isShareAlike,
  licenseLabel,
  mergeCandidates,
  parseCommonsResponse,
  parsePexelsResponse,
  pexelsSearchUrl,
  ratioLabel,
  ratioTag,
  searchWords,
  type CandidateLane,
  type ImageCandidate,
} from './image-sources';

/** Candidato de mentira, con el mínimo que usa la fusión. */
function candidate(source: 'commons' | 'pexels', id: string, extra: Partial<ImageCandidate> = {}): ImageCandidate {
  return {
    source,
    id,
    title: `${id}.jpg`,
    thumbUrl: `https://example.test/${source}/${id}-330.jpg`,
    fullUrl: `https://example.test/${source}/${id}-960.jpg`,
    pageUrl: `https://example.test/${source}/${id}`,
    author: 'Anon',
    license: 'Public domain',
    licenseUrl: null,
    width: 1200,
    height: 800,
    term: '',
    ...extra,
  };
}

describe('palabras de búsqueda', () => {
  it('quita el artículo delante y el artículo invertido detrás', () => {
    expect(searchWords('The Butterfly')).toBe('Butterfly');
    expect(searchWords('Drowsy Maggie')).toBe('Drowsy Maggie');
    // El catálogo guarda «Kesh, The»; buscar «Kesh, The» en Commons no da nada.
    expect(searchWords('Kesh, The')).toBe('Kesh');
    expect(searchWords('  The   Morning Dew ')).toBe('Morning Dew');
    // Un «A» inicial también es artículo: la consulta es lo que importa.
    expect(searchWords('A Fig For A Kiss')).toBe('Fig For A Kiss');
  });
});

describe('consultas de Commons', () => {
  const lanes = commonsQueries('  The Butterfly ', 'both');

  it('construye los cuatro carriles en orden, con el cupo que les toca', () => {
    expect(lanes.map((lane) => lane.kind)).toEqual(['title', 'art', 'photo', 'exact']);
    expect(
      lanes.reduce((total, lane) => total + LANE_QUOTAS[lane.kind], 0)
    ).toBe(CANDIDATE_COUNT);
  });

  it('el carril título busca el nombre y el de arte añade `painting`', () => {
    expect(lanes[0].search).toBe('filetype:bitmap Butterfly');
    expect(lanes[1].search).toBe('filetype:bitmap Butterfly painting');
  });

  it('el carril foto usa NEGACIÓN, no `+photograph` (que era ruido)', () => {
    const photo = lanes.find((lane) => lane.kind === 'photo')!;
    expect(photo.search).toBe(
      'filetype:bitmap Butterfly -painting -engraving -drawing -lithograph -watercolour -woodcut'
    );
    expect(photo.search).not.toContain('photograph');
    // Nada de grupos OR de medios: devolvían los mismos grabados para todo.
    expect(photo.search).not.toContain('(');
    for (const media of ART_MEDIA_TERMS) expect(photo.search).toContain(`-${media}`);
  });

  it('el carril exacto va entre comillas', () => {
    expect(lanes[3].search).toBe('filetype:bitmap "Butterfly"');
  });

  it('el registro decide qué carriles se piden', () => {
    expect(commonsQueries('Butterfly', 'art').map((lane) => lane.kind)).toEqual([
      'title',
      'art',
      'exact',
    ]);
    expect(commonsQueries('Butterfly', 'photo').map((lane) => lane.kind)).toEqual([
      'title',
      'photo',
      'exact',
    ]);
  });

  it('con el registro en `photo` la negación va también en título y frase exacta', () => {
    // Medido: sin esto, el carril título de «Harvest Home» devuelve el Turner y el
    // mosaico de fotos trae una pintura.
    const photo = commonsQueries('Harvest Home', 'photo');
    expect(photo[0].search).toContain('-painting');
    expect(photo[photo.length - 1].search).toContain('-painting');
    expect(photo[photo.length - 1].search.startsWith('filetype:bitmap "Harvest Home"')).toBe(true);

    // Con arte o con el registro por defecto, el carril título va limpio.
    expect(commonsQueries('Harvest Home', 'art')[0].search).toBe('filetype:bitmap Harvest Home');
    expect(commonsQueries('Harvest Home', 'both')[0].search).toBe('filetype:bitmap Harvest Home');
  });

  it('sin palabras no hay consulta', () => {
    expect(commonsQueries('   ', 'both')).toEqual([]);
  });
});

describe('fusión con cupo y relleno', () => {
  it('reparte 4/2/2/1 cuando todos los carriles tienen de sobra', () => {
    const lanes: CandidateLane[] = [
      { kind: 'title', candidates: [1, 2, 3, 4, 5, 6].map((n) => candidate('commons', `t${n}`)) },
      { kind: 'art', candidates: [1, 2, 3].map((n) => candidate('commons', `a${n}`)) },
      { kind: 'photo', candidates: [1, 2, 3].map((n) => candidate('commons', `p${n}`)) },
      { kind: 'exact', candidates: [1, 2].map((n) => candidate('commons', `e${n}`)) },
    ];

    const merged = mergeCandidates(lanes);

    expect(merged).toHaveLength(9);
    expect(merged.map((item) => item.id)).toEqual([
      't1',
      't2',
      't3',
      't4',
      'a1',
      'a2',
      'p1',
      'p2',
      'e1',
    ]);
  });

  it('un carril devuelve 2 y hay que rellenar a 9 con el resto', () => {
    // Este es el caso del bug medido: el deduplicado marcaba como vistas las que
    // no entraban en el cupo y el mosaico se quedaba en siete. Aquí el carril
    // título solo trae dos, así que los dos huecos se completan con los otros.
    const lanes: CandidateLane[] = [
      { kind: 'title', candidates: [candidate('commons', 't1'), candidate('commons', 't2')] },
      { kind: 'art', candidates: [1, 2, 3, 4].map((n) => candidate('commons', `a${n}`)) },
      { kind: 'photo', candidates: [1, 2, 3, 4].map((n) => candidate('commons', `p${n}`)) },
      { kind: 'exact', candidates: [candidate('commons', 'e1')] },
    ];

    const merged = mergeCandidates(lanes);

    expect(merged).toHaveLength(9);
    expect(new Set(merged.map(candidateKey)).size).toBe(9);
    // El cupo se respeta primero: 2 + 2 + 2 + 1 = 7.
    expect(merged.slice(0, 7).map((item) => item.id)).toEqual([
      't1',
      't2',
      'a1',
      'a2',
      'p1',
      'p2',
      'e1',
    ]);
    // El relleno recupera lo que el cupo dejó fuera: a3 y p3 existían y no
    // entraron en el primer pase, así que tienen que poder volver.
    expect(merged.slice(7).map((item) => item.id)).toEqual(['a3', 'p3']);
  });

  it('deduplica por source:id y no confunde un id de Commons con uno de Pexels', () => {
    const lanes: CandidateLane[] = [
      {
        kind: 'title',
        candidates: [
          candidate('commons', 'Maggie.jpg'),
          candidate('commons', 'Maggie.jpg'),
          candidate('pexels', 'Maggie.jpg'),
        ],
      },
      { kind: 'art', candidates: [candidate('commons', 'Maggie.jpg'), candidate('commons', 'Otro.jpg')] },
      { kind: 'exact', candidates: [candidate('commons', 'Otro.jpg')] },
    ];

    const merged = mergeCandidates(lanes);

    // El mismo fichero de Commons no se repite aunque lo devuelvan dos carriles…
    expect(merged.filter((item) => item.source === 'commons' && item.id === 'Maggie.jpg')).toHaveLength(1);
    // …pero un id igual en Pexels es otra imagen.
    expect(merged.filter((item) => item.id === 'Maggie.jpg')).toHaveLength(2);
    expect(merged.map(candidateKey)).toEqual(['commons:Maggie.jpg', 'pexels:Maggie.jpg', 'commons:Otro.jpg']);
  });

  it('nunca pasa del límite ni inventa candidatos cuando hay menos de nueve', () => {
    const lanes: CandidateLane[] = [
      { kind: 'title', candidates: [candidate('commons', 't1')] },
      { kind: 'art', candidates: [] },
      { kind: 'photo', candidates: [candidate('commons', 'p1')] },
      { kind: 'exact', candidates: [] },
    ];

    expect(mergeCandidates(lanes)).toHaveLength(2);

    const many: CandidateLane[] = [
      { kind: 'title', candidates: Array.from({ length: 20 }, (_, n) => candidate('commons', `t${n}`)) },
    ];
    expect(mergeCandidates(many, 9)).toHaveLength(9);
  });
});

describe('ratio y licencias', () => {
  it('marca vertical por debajo de 0,92 y panorámica por encima de 1,95', () => {
    expect(ratioLabel({ width: 400, height: 800 })).toBe('vertical');
    expect(ratioLabel({ width: 2000, height: 800 })).toBe('panoramic');
    // 5:4 exacto no lleva etiqueta: es la proporción de la carta.
    expect(ratioLabel({ width: 1200, height: 960 })).toBeNull();
    // Los bordes pertenecen a la proporción buena: 0,92 y 1,95 no marcan.
    expect(ratioLabel({ width: 92, height: 100 })).toBeNull();
    expect(ratioLabel({ width: 195, height: 100 })).toBeNull();
    expect(ratioTag({ width: 250, height: 100 })).toBe('panoramic');
    expect(ratioTag({ width: 100, height: 100 })).toBe('');
    expect(imageRatio({ width: 0, height: 0 })).toBeNull();
  });

  it('verde para lo que no obliga a nada, gris para lo que sí', () => {
    expect(isFreeLicense('Public domain')).toBe(true);
    expect(isFreeLicense('CC0')).toBe(true);
    expect(isFreeLicense('No restrictions')).toBe(true);
    expect(isFreeLicense('Pexels License')).toBe(true);
    expect(isFreeLicense('CC BY-SA 4.0')).toBe(false);
    expect(isFreeLicense('CC BY 2.0')).toBe(false);

    expect(isShareAlike('CC BY-SA 4.0')).toBe(true);
    expect(isShareAlike('Public domain')).toBe(false);
  });

  it('la etiqueta del tile recorta el « License» final de Pexels', () => {
    expect(licenseLabel('Pexels License')).toBe('Pexels');
    expect(licenseLabel('CC BY-SA 4.0')).toBe('CC BY-SA 4.0');
    expect(licenseLabel('')).toBe('unknown');
  });
});

describe('matemática del encuadre', () => {
  it('calcula el fondo con la fórmula validada en el prototipo', () => {
    // Caja 248×198 (5:4), imagen 1200×800: manda el alto (0,2475).
    const zoomOne = cropGeometry({
      boxWidth: 248,
      boxHeight: 198,
      imageWidth: 1200,
      imageHeight: 800,
      zoom: 1,
      focalX: 50,
      focalY: 50,
    });

    expect(zoomOne.backgroundSize).toBe('297px 198px');
    expect(zoomOne.backgroundPosition).toBe('50% 50%');
    // Desborda a lo ancho; en vertical cabe justo, así que no se arrastra.
    expect(zoomOne.overflowX).toBe(49);
    expect(zoomOne.overflowY).toBe(0);

    const zoomed = cropGeometry({
      boxWidth: 248,
      boxHeight: 198,
      imageWidth: 1200,
      imageHeight: 800,
      zoom: 1.5,
      focalX: 30,
      focalY: 70,
    });

    expect(zoomed.backgroundSize).toBe('445px 297px');
    expect(zoomed.overflowX).toBeCloseTo(197.5, 1);
    expect(zoomed.overflowY).toBeCloseTo(99, 1);
    expect(zoomed.backgroundPosition).toBe('30% 70%');
  });

  it('sin medidas del API cae a cover en vez de inventar un tamaño', () => {
    const geometry = cropGeometry({
      boxWidth: 248,
      boxHeight: 198,
      imageWidth: 0,
      imageHeight: 0,
      zoom: 1.7,
      focalX: 50,
      focalY: 50,
    });
    expect(geometry.backgroundSize).toBe('cover');
    expect(geometry.overflowX).toBe(0);
    expect(geometry.overflowY).toBe(0);
  });

  it('el arrastre solo mueve el eje que desborda y se queda en 0–100', () => {
    const overflow = { overflowX: 49, overflowY: 0 };

    // 10 px a la derecha sobre 49 de desborde: focal_x baja ~20,4 puntos.
    const moved = focalAfterDrag({ x: 50, y: 50 }, 10, 0, overflow);
    expect(moved.x).toBeCloseTo(29.59, 1);
    // El eje vertical no desborda: `dy` no lo toca.
    expect(moved.y).toBe(50);

    // Arrastrar a la izquierda sube el focal: tope superior.
    const past = focalAfterDrag({ x: 90, y: 50 }, -500, 0, overflow);
    expect(past.x).toBe(100);
    // Arrastrar a la derecha lo baja: tope inferior.
    const other = focalAfterDrag({ x: 10, y: 50 }, 500, 0, overflow);
    expect(other.x).toBe(0);

    const vertical = focalAfterDrag({ x: 50, y: 80 }, 0, 10, { overflowX: 0, overflowY: 99 });
    expect(vertical.x).toBe(50);
    expect(vertical.y).toBeCloseTo(69.9, 1);
  });

  it('el focal guardado se convierte en `object-position` de la carta', () => {
    expect(focalPosition(20, 80)).toBe('20% 80%');
    expect(focalPosition(null, null)).toBe('50% 50%');
    expect(focalPosition(120, -5)).toBe('100% 0%');
  });
});

describe('parseo de Commons', () => {
  // Recortado de una respuesta real: el thumburl es el que devuelve el API a
  // 330 px y NO se compone a mano.
  const payload = {
    query: {
      pages: {
        '2': {
          pageid: 2,
          index: 1,
          title: 'File:Butterfly (Winslow Homer).jpg',
          imageinfo: [
            {
              thumburl:
                'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Butterfly.jpg/330px-Butterfly.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Butterfly_(Winslow_Homer).jpg',
              width: 2400,
              height: 1600,
              extmetadata: {
                Artist: { value: '<a href="//commons.wikimedia.org/wiki/Winslow_Homer">Winslow&nbsp;Homer</a>' },
                LicenseShortName: { value: 'Public domain' },
                LicenseUrl: { value: 'https://creativecommons.org/publicdomain/mark/1.0/' },
              },
            },
          ],
        },
        '1': {
          pageid: 1,
          index: 0,
          title: 'File:Butterfly engraving.jpg',
          imageinfo: [
            {
              thumburl:
                'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Engraving.jpg/330px-Engraving.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Butterfly_engraving.jpg',
              width: 800,
              height: 1200,
              extmetadata: {
                Artist: { value: 'Anon &amp; Co.' },
                LicenseShortName: { value: 'CC BY-SA 4.0' },
              },
            },
          ],
        },
        '3': {
          pageid: 3,
          index: 2,
          title: 'File:No image info.jpg',
        },
      },
    },
  };

  it('conserva el thumburl del API, ordena por índice y quita el prefijo File:', () => {
    const parsed = parseCommonsResponse(payload, 'filetype:bitmap Butterfly');

    expect(parsed).toHaveLength(2);
    expect(parsed.map((item) => item.id)).toEqual([
      'Butterfly engraving.jpg',
      'Butterfly (Winslow Homer).jpg',
    ]);
    // La URL es la del API, con su /330px-: componerla daría 400.
    expect(parsed[1].thumbUrl).toContain('/330px-Butterfly.jpg');
    expect(parsed[0].thumbUrl).toContain('/330px-Engraving.jpg');
    // Hasta que se pida el grande, `fullUrl` es la miniatura: nunca una ruta inventada.
    expect(parsed[1].fullUrl).toBe(parsed[1].thumbUrl);
    expect(parsed[0].term).toBe('filetype:bitmap Butterfly');
  });

  it('limpia el HTML del autor y decodifica entidades', () => {
    const parsed = parseCommonsResponse(payload);
    expect(parsed[1].author).toBe('Winslow Homer');
    expect(parsed[0].author).toBe('Anon & Co.');
  });

  it('trae licencia, enlace, medidas y ficha', () => {
    const parsed = parseCommonsResponse(payload);
    expect(parsed[1].license).toBe('Public domain');
    expect(parsed[1].licenseUrl).toBe('https://creativecommons.org/publicdomain/mark/1.0/');
    expect(parsed[1].width).toBe(2400);
    expect(parsed[1].height).toBe(1600);
    expect(parsed[1].pageUrl).toBe(
      'https://commons.wikimedia.org/wiki/File:Butterfly_(Winslow_Homer).jpg'
    );
    expect(parsed[0].license).toBe('CC BY-SA 4.0');
    expect(parsed[0].licenseUrl).toBeNull();
  });

  it('una respuesta vacía o rota no revienta: cero candidatos', () => {
    expect(parseCommonsResponse(undefined)).toEqual([]);
    expect(parseCommonsResponse({ query: { pages: {} } })).toEqual([]);
    expect(parseCommonsResponse({ error: { code: 'badvalue' } })).toEqual([]);
  });
});

describe('parseo de Pexels', () => {
  const payload = {
    photos: [
      {
        id: 12345,
        width: 4000,
        height: 2667,
        url: 'https://www.pexels.com/photo/12345/',
        photographer: 'Ana Fotógrafa',
        alt: 'Mist over a field',
        src: {
          medium: 'https://images.pexels.com/photos/12345/medium.jpeg',
          large2x: 'https://images.pexels.com/photos/12345/large2x.jpeg',
        },
      },
      {
        id: 6789,
        width: 3000,
        height: 2000,
        url: 'https://www.pexels.com/photo/6789/',
        photographer: 'Ben',
        alt: '',
        src: { medium: 'https://images.pexels.com/photos/6789/medium.jpeg' },
      },
    ],
  };

  it('usa medium para el mosaico y large2x para el grande, con su licencia', () => {
    const parsed = parsePexelsResponse(payload);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].source).toBe('pexels');
    expect(parsed[0].id).toBe('12345');
    expect(parsed[0].thumbUrl).toBe('https://images.pexels.com/photos/12345/medium.jpeg');
    expect(parsed[0].fullUrl).toBe('https://images.pexels.com/photos/12345/large2x.jpeg');
    expect(parsed[0].license).toBe('Pexels License');
    expect(parsed[0].licenseUrl).toBe('https://www.pexels.com/license/');
    expect(parsed[0].author).toBe('Ana Fotógrafa');
    // Sin `alt`, el título es el id: nunca vacío.
    expect(parsed[1].title).toBe('Pexels 6789');
    expect(parsed[1].fullUrl).toBe(parsed[1].thumbUrl);
  });

  it('con `orientation=landscape` no hay ninguna vertical que marcar', () => {
    const parsed = parsePexelsResponse(payload);
    expect(parsed.filter((item) => ratioLabel(item) === 'vertical')).toHaveLength(0);
    expect(parsed.filter((item) => ratioTag(item) === 'vertical')).toHaveLength(0);
  });
});

describe('consulta de Pexels', () => {
  it('pide nueve, en horizontal, con las palabras sin artículo', () => {
    const url = new URL(pexelsSearchUrl('The Butterfly'));

    expect(url.origin + url.pathname).toBe('https://api.pexels.com/v1/search');
    expect(url.searchParams.get('query')).toBe('Butterfly');
    expect(url.searchParams.get('per_page')).toBe('9');
    // Las verticales, descartadas en origen: es la mitad del problema del recorte.
    expect(url.searchParams.get('orientation')).toBe('landscape');
  });
});
