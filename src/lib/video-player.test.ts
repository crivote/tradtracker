import { describe, expect, it } from 'vitest';
import type { TuneSegment } from './tradtube';
import {
  DEFAULT_VIDEO_RATE,
  VIDEO_RATE_MAX,
  VIDEO_RATE_MIN,
  canStepRate,
  clampRate,
  fallbackEmbedUrl,
  rateLabel,
  stepRate,
  videoEventFromState,
} from './video-player';

/**
 * Lo puro del reproductor de vídeo (#53, pasos del 5 % en #59), sin navegador:
 * el escalón de velocidad, su rótulo en % y la traducción de los estados de
 * YouTube.
 */

describe('velocidad en pasos del 5 %', () => {
  it('rotula en % sobre el tanto por uno', () => {
    expect(rateLabel(1)).toBe('100%');
    expect(rateLabel(0.75)).toBe('75%');
    expect(rateLabel(0.55)).toBe('55%');
  });

  it('el dominio es el de TradTube: 50 % a 100 %, arranque al 100 %', () => {
    expect(VIDEO_RATE_MIN).toBe(0.5);
    expect(VIDEO_RATE_MAX).toBe(1);
    expect(DEFAULT_VIDEO_RATE).toBe(1);
  });

  it('baja en veinte pasos de 5 puntos, no en ocho escalones de YouTube', () => {
    expect(stepRate(1, -1)).toBe(0.95);
    expect(stepRate(0.95, -1)).toBe(0.9);
    expect(stepRate(0.85, -1)).toBe(0.8);
    // Sumar 0,05 veinte veces no puede dejar error de coma flotante.
    let rate = 1;
    for (let i = 0; i < 20; i += 1) rate = stepRate(rate, -1);
    expect(rate).toBe(VIDEO_RATE_MIN);
    expect(rateLabel(rate)).toBe('50%');
  });

  it('se acota en los dos extremos y el botón del extremo se deshabilita', () => {
    expect(stepRate(VIDEO_RATE_MIN, -1)).toBe(VIDEO_RATE_MIN);
    expect(stepRate(VIDEO_RATE_MAX, 1)).toBe(VIDEO_RATE_MAX);
    expect(canStepRate(VIDEO_RATE_MIN, -1)).toBe(false);
    expect(canStepRate(VIDEO_RATE_MAX, 1)).toBe(false);
    expect(canStepRate(VIDEO_RATE_MIN, 1)).toBe(true);
    expect(canStepRate(VIDEO_RATE_MAX, -1)).toBe(true);
  });

  it('un valor inservible cae al 100 % en vez de propagarse al reproductor', () => {
    expect(clampRate(Number.NaN)).toBe(1);
    expect(clampRate(0)).toBe(1);
    expect(clampRate(-1)).toBe(1);
    // Lo que YouTube confirma se redondea al 1 %: `0.8500000000000001` es 85 %.
    expect(clampRate(0.8500000000000001)).toBe(0.85);
    expect(clampRate(3)).toBe(1);
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
