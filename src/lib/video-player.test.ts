import { describe, expect, it } from 'vitest';
import type { TuneSegment } from './tradtube';
import {
  DEFAULT_VIDEO_RATE,
  VIDEO_RATES,
  canStepRate,
  fallbackEmbedUrl,
  nearestRate,
  rateLabel,
  stepRate,
  usableRates,
  videoEventFromState,
} from './video-player';

/**
 * Lo puro del reproductor de vídeo (#53), sin navegador: los escalones de
 * velocidad, su rótulo en % y la traducción de los estados de YouTube.
 */

describe('escalones de velocidad', () => {
  it('rotula en % sobre el tanto por uno', () => {
    expect(rateLabel(1)).toBe('100%');
    expect(rateLabel(0.75)).toBe('75%');
    expect(rateLabel(1.25)).toBe('125%');
    expect(rateLabel(2)).toBe('200%');
  });

  it('la escalera por defecto es la de YouTube, de menor a mayor', () => {
    expect(usableRates()).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
    expect(VIDEO_RATES).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
    expect(DEFAULT_VIDEO_RATE).toBe(1);
  });

  it('limpia lo que declara el player: sin ceros, sin negativos, sin repetidos', () => {
    expect(usableRates([2, 1, 1, 0.5, 0, -1, Number.NaN])).toEqual([0.5, 1, 2]);
  });

  it('una escalera inservible cae en la de referencia, nunca en vacío', () => {
    expect(usableRates([])).toEqual(VIDEO_RATES);
    expect(usableRates([0, -0.5])).toEqual(VIDEO_RATES);
    expect(usableRates(null)).toEqual(VIDEO_RATES);
  });

  it('el escalón más cercano existe aunque la velocidad pedida no', () => {
    expect(nearestRate(0.8)).toBe(0.75);
    expect(nearestRate(1.9)).toBe(2);
    expect(nearestRate(0.8, [0.5, 1, 2])).toBe(1);
    // Una velocidad imposible no rompe el arranque: se cae al 100 %.
    expect(nearestRate(Number.NaN)).toBe(1);
  });

  it('sube y baja un escalón, y se acota en los dos extremos', () => {
    expect(stepRate(1, 1)).toBe(1.25);
    expect(stepRate(1, -1)).toBe(0.75);
    expect(stepRate(0.25, -1)).toBe(0.25);
    expect(stepRate(2, 1)).toBe(2);
    expect(canStepRate(0.25, -1)).toBe(false);
    expect(canStepRate(2, 1)).toBe(false);
    expect(canStepRate(1, 1)).toBe(true);
    expect(canStepRate(1, -1)).toBe(true);
  });

  it('respeta la escalera que declara el player, no la de referencia', () => {
    expect(stepRate(0.5, 1, [0.5, 1, 2])).toBe(1);
    expect(stepRate(1, 1, [0.5, 1, 2])).toBe(2);
    expect(stepRate(0.5, -1, [0.5, 1, 2])).toBe(0.5);
  });
});

describe('estados de YouTube', () => {
  it('traduce los números de YT.PlayerState', () => {
    expect(videoEventFromState(1)).toBe('playing');
    expect(videoEventFromState(2)).toBe('paused');
    expect(videoEventFromState(0)).toBe('ended');
    expect(videoEventFromState(3)).toBe('buffering');
    expect(videoEventFromState(-1)).toBe('unstarted');
    expect(videoEventFromState(5)).toBe('unstarted');
  });
});

describe('iframe de reserva', () => {
  const segment: TuneSegment = {
    originRef: '55',
    mediaId: 'm-1',
    title: 'Kesh on fiddle',
    youtubeId: 'abcdefghijk',
    startSec: 12,
    endSec: 70,
    position: 0,
    unavailable: false,
  };

  it('es el de siempre, con el segmento y sin API: el vídeo se ve aunque no haya control', () => {
    const url = fallbackEmbedUrl(segment);
    expect(url.startsWith('https://www.youtube-nocookie.com/embed/abcdefghijk?start=12')).toBe(true);
    expect(url).toContain('end=70');
    expect(url).toContain('autoplay=1');
    expect(url).not.toContain('enablejsapi');
  });

  it('omite `end` cuando el segmento no declara final', () => {
    const url = fallbackEmbedUrl({ ...segment, endSec: null });
    expect(url).not.toContain('end=');
  });
});
