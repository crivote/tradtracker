import { describe, expect, it } from 'vitest';
import { daysSince, formatDate, friendlyAuthError, normalizeTitle } from './format';

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
