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
  it('renders a dash for missing values', () => {
    expect(formatDate(null)).toBe('—');
    expect(daysSince(null)).toBeNull();
  });

  it('counts whole days since a timestamp', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000 - 60_000).toISOString();
    expect(daysSince(threeDaysAgo)).toBe(3);
  });
});
