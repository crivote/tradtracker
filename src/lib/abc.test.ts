import { describe, it, expect } from 'vitest';
import { firstSetting, hasAbcHeader } from './abc';

describe('abc lib', () => {
  describe('firstSetting', () => {
    it('should return only the first setting when multiple are present', () => {
      const abc = 'X: 1\nT: Tune 1\nK: G\nC|D|E|\n\nX: 2\nT: Tune 2\nK: D\nF|G|A|';
      const result = firstSetting(abc);
      expect(result).toBe('X: 1\nT: Tune 1\nK: G\nC|D|E|\n');
    });

    it('should return the only setting present', () => {
      const abc = 'X: 1\nT: Tune 1\nK: G\nC|D|E|';
      const result = firstSetting(abc);
      expect(result).toBe('X: 1\nT: Tune 1\nK: G\nC|D|E|\n');
    });

    it('should handle CRLF and CR', () => {
      const abc = 'X: 1\r\nT: Tune 1\r\nK: G\r\nC|D|E|';
      const result = firstSetting(abc);
      expect(result).toBe('X: 1\nT: Tune 1\nK: G\nC|D|E|\n');
    });

    it('should return null if no X: header is found', () => {
      const abc = 'T: Tune 1\nK: G\nC|D|E|';
      expect(firstSetting(abc)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(firstSetting('')).toBeNull();
    });

    it('should return null if no block can be formed', () => {
      expect(firstSetting('')).toBeNull();
    });
  });

  describe('hasAbcHeader', () => {
    it('should return true when all 5 minimum headers are present', () => {
      const abc = 'X: 1\nT: Title\nM: 4/4\nL: 1/8\nK: G\nC|D|E|';
      expect(hasAbcHeader(abc)).toBe(true);
    });

    it('should allow leading spaces before headers', () => {
      const abc = '  X: 1\n  T: Title\n  M: 4/4\n  L: 1/8\n  K: G\nC|D|E|';
      expect(hasAbcHeader(abc)).toBe(true);
    });

    it('should return false if K: is missing', () => {
      const abc = 'X: 1\nT: Title\nM: 4/4\nL: 1/8\nC|D|E|';
      expect(hasAbcHeader(abc)).toBe(false);
    });

    it('should return false if L: is missing', () => {
      const abc = 'X: 1\nT: Title\nM: 4/4\nK: G\nC|D|E|';
      expect(hasAbcHeader(abc)).toBe(false);
    });

    it('should return false if X: is missing', () => {
      const abc = 'T: Title\nM: 4/4\nL: 1/8\nK: G\nC|D|E|';
      expect(hasAbcHeader(abc)).toBe(false);
    });
  });
});
