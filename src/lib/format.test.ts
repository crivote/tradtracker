import { describe, expect, it } from 'vitest';
import {
  daysSince,
  daysSinceDay,
  formatDate,
  formatDay,
  friendlyAuthError,
  normalizeTitle,
  parseLocalDay,
} from './format';

describe('normalizeTitle', () => {
  it('moves the trailing article in front', () => {
    expect(normalizeTitle('Kesh, The')).toBe('The Kesh');
    expect(normalizeTitle('Silver Spear, The')).toBe('The Silver Spear');
  });

  it('leaves titles without a trailing article untouched', () => {
    expect(normalizeTitle("Morrison's")).toBe("Morrison's");
    expect(normalizeTitle('Out On The Ocean')).toBe('Out On The Ocean');
  });
});

describe('friendlyAuthError', () => {
  it('turns the generic Supabase message into something actionable', () => {
    expect(friendlyAuthError('Invalid login credentials')).toBe('Wrong email or password.');
  });

  it('keeps the number in the password message', () => {
    expect(friendlyAuthError('Password should be at least 6 characters.')).toBe(
      'Password must be at least 6 characters.'
    );
  });

  it('passes unknown messages through', () => {
    expect(friendlyAuthError('Something unexpected')).toBe('Something unexpected');
  });
});

describe('date helpers', () => {
  /** Instante de referencia fijo: los tests de fechas no dependen del reloj real. */
  const now = Date.parse('2026-10-28T12:00:00Z');

  it('renders a dash for missing values', () => {
    expect(formatDate(null)).toBe('—');
    expect(daysSince(null, now)).toBeNull();
  });

  it('counts whole days since a timestamp', () => {
    expect(daysSince('2026-10-25T11:00:00Z', now)).toBe(3);
    expect(daysSince('2026-10-25T13:00:00Z', now)).toBe(2);
  });

  it('counts today as zero days', () => {
    expect(daysSince('2026-10-28T00:30:00Z', now)).toBe(0);
  });

  it('never goes negative: a future timestamp counts as zero', () => {
    expect(daysSince('2026-11-15T12:00:00Z', now)).toBe(0);
  });

  it('returns null for an unparsable timestamp', () => {
    expect(daysSince('not-a-date', now)).toBeNull();
  });
});

describe('parseLocalDay / daysSinceDay (la fecha del ensayo es un día local)', () => {
  /** Instante de referencia fijo: los tests de fechas no dependen del reloj real. */
  const now = Date.parse('2026-10-28T12:00:00Z');

  it('lee el día como medianoche LOCAL, no como medianoche UTC', () => {
    // `Date.parse('2026-11-13')` daría medianoche UTC; aquí tiene que dar la
    // medianoche del huso del runner, que es el día que ve quien practica.
    expect(parseLocalDay('2026-11-13')).toBe(new Date(2026, 10, 13).getTime());
    expect(new Date(parseLocalDay('2026-11-13')).getDate()).toBe(13);
  });

  it('una fecha que no es `YYYY-MM-DD` no inventa un día', () => {
    expect(parseLocalDay('ayer')).toBeNaN();
    expect(parseLocalDay('2026-11-13T10:00:00Z')).toBeNaN();
    expect(parseLocalDay('')).toBeNaN();
  });

  it('cuenta días locales enteros desde el día del ensayo', () => {
    expect(daysSinceDay('2026-10-25', now)).toBe(3);
    expect(daysSinceDay('2026-10-28', now)).toBe(0);
    // Un ensayo de ayer a las 23:30 es, a mediodía de hoy, un día: la frontera
    // es la medianoche local, no la hora a la que se tocó.
    expect(daysSinceDay('2026-10-27', new Date(2026, 9, 28, 0, 30).getTime())).toBe(1);
  });

  it('nunca va hacia atrás y sin día devuelve null', () => {
    expect(daysSinceDay('2026-11-15', now)).toBe(0);
    expect(daysSinceDay(null, now)).toBeNull();
    expect(daysSinceDay('ayer', now)).toBeNull();
  });

  it('formatea el día con el formato corto y el guion de los huecos', () => {
    expect(formatDay(null)).toBe('—');
    expect(formatDay('ayer')).toBe('—');
    // El texto depende de la ICU del runner: se compara con la misma llamada
    // sobre el instante local, no con una cadena escrita a mano.
    expect(formatDay('2026-11-13')).toBe(
      new Date(2026, 10, 13).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    );
  });
});
