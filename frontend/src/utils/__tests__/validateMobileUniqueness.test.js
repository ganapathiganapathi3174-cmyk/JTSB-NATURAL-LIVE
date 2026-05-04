import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateMobileUniqueness,
  clearMobileCache,
  isValidMobileFormat,
  normalizePhone,
} from '../validateMobileUniqueness.js';

function createMockDbLayer() {
  const registeredPhones = new Set();

  return {
    async findByPhone(phone) {
      const normalized = normalizePhone(phone);
      if (registeredPhones.has(normalized)) {
        return { id: 'mock-user-id', phone: normalized };
      }
      return null;
    },
    registerPhone(phone) {
      registeredPhones.add(normalizePhone(phone));
    },
    clear() {
      registeredPhones.clear();
    },
  };
}

describe('normalizePhone', () => {
  it('removes spaces from phone number', () => {
    expect(normalizePhone('98765 43210')).toBe('9876543210');
  });

  it('removes hyphens from phone number', () => {
    expect(normalizePhone('98765-43210')).toBe('9876543210');
  });

  it('removes parentheses from phone number', () => {
    expect(normalizePhone('(98765) 43210')).toBe('9876543210');
  });

  it('trims whitespace', () => {
    expect(normalizePhone('  9876543210  ')).toBe('9876543210');
  });
});

describe('isValidMobileFormat', () => {
  it('accepts valid Indian mobile numbers starting with 6', () => {
    expect(isValidMobileFormat('6123456789')).toBe(true);
  });

  it('accepts valid Indian mobile numbers starting with 7', () => {
    expect(isValidMobileFormat('7123456789')).toBe(true);
  });

  it('accepts valid Indian mobile numbers starting with 8', () => {
    expect(isValidMobileFormat('8123456789')).toBe(true);
  });

  it('accepts valid Indian mobile numbers starting with 9', () => {
    expect(isValidMobileFormat('9876543210')).toBe(true);
  });

  it('rejects numbers starting with 0-5', () => {
    expect(isValidMobileFormat('5123456789')).toBe(false);
    expect(isValidMobileFormat('0123456789')).toBe(false);
  });

  it('rejects numbers shorter than 10 digits', () => {
    expect(isValidMobileFormat('987654321')).toBe(false);
  });

  it('rejects numbers longer than 10 digits', () => {
    expect(isValidMobileFormat('98765432101')).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(isValidMobileFormat('abcdefghij')).toBe(false);
  });
});

describe('validateMobileUniqueness', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDbLayer();
    clearMobileCache();
  });

  describe('unique mobile number', () => {
    it('should allow registration for unique mobile', async () => {
      const result = await validateMobileUniqueness('9876543210', mockDb);

      expect(result.isUnique).toBe(true);
      expect(result.error).toBe(null);
      expect(result.allowRegistration).toBe(true);
    });

    it('should allow registration for another unique mobile', async () => {
      const result = await validateMobileUniqueness('8765432109', mockDb);

      expect(result.isUnique).toBe(true);
      expect(result.error).toBe(null);
      expect(result.allowRegistration).toBe(true);
    });

    it('should allow registration for mobile with different starting digit', async () => {
      const result = await validateMobileUniqueness('6123456789', mockDb);

      expect(result.isUnique).toBe(true);
      expect(result.allowRegistration).toBe(true);
    });
  });

  describe('duplicate mobile number', () => {
    it('should reject registration for duplicate mobile', async () => {
      mockDb.registerPhone('9876543210');

      const result = await validateMobileUniqueness('9876543210', mockDb);

      expect(result.isUnique).toBe(false);
      expect(result.error).toBe('This mobile number is already in use');
      expect(result.allowRegistration).toBe(false);
    });

    it('should reject registration for duplicate mobile with spaces', async () => {
      mockDb.registerPhone('9876543210');

      const result = await validateMobileUniqueness('98765 43210', mockDb);

      expect(result.isUnique).toBe(false);
      expect(result.error).toBe('This mobile number is already in use');
      expect(result.allowRegistration).toBe(false);
    });

    it('should reject registration for duplicate mobile with hyphens', async () => {
      mockDb.registerPhone('9876543210');

      const result = await validateMobileUniqueness('98765-43210', mockDb);

      expect(result.isUnique).toBe(false);
      expect(result.error).toBe('This mobile number is already in use');
      expect(result.allowRegistration).toBe(false);
    });
  });

  describe('invalid phone numbers', () => {
    it('should reject empty phone number', async () => {
      const result = await validateMobileUniqueness('', mockDb);

      expect(result.isUnique).toBe(false);
      expect(result.allowRegistration).toBe(false);
    });

    it('should reject phone number shorter than 10 digits', async () => {
      const result = await validateMobileUniqueness('987654321', mockDb);

      expect(result.isUnique).toBe(false);
      expect(result.allowRegistration).toBe(false);
    });

    it('should reject invalid format (starts with 5)', async () => {
      const result = await validateMobileUniqueness('5123456789', mockDb);

      expect(result.isUnique).toBe(false);
      expect(result.allowRegistration).toBe(false);
    });
  });

  describe('caching behavior', () => {
    it('should cache unique phone results', async () => {
      await validateMobileUniqueness('9876543210', mockDb);

      mockDb.registerPhone('9876543210');

      const result = await validateMobileUniqueness('9876543210', mockDb);

      expect(result.isUnique).toBe(true);
      expect(result.allowRegistration).toBe(true);
    });

    it('should cache duplicate phone results', async () => {
      mockDb.registerPhone('9876543210');
      await validateMobileUniqueness('9876543210', mockDb);

      mockDb.clear();

      const result = await validateMobileUniqueness('9876543210', mockDb);

      expect(result.isUnique).toBe(false);
      expect(result.error).toBe('This mobile number is already in use');
    });

    it('should clear cache when clearMobileCache is called', async () => {
      await validateMobileUniqueness('9876543210', mockDb);

      clearMobileCache('9876543210');

      const result = await validateMobileUniqueness('9876543210', mockDb);

      expect(result.isUnique).toBe(true);
    });

    it('should clear all cache when clearMobileCache is called without arguments', async () => {
      await validateMobileUniqueness('9876543210', mockDb);
      await validateMobileUniqueness('8765432109', mockDb);

      clearMobileCache();

      const result1 = await validateMobileUniqueness('9876543210', mockDb);
      const result2 = await validateMobileUniqueness('8765432109', mockDb);

      expect(result1.isUnique).toBe(true);
      expect(result2.isUnique).toBe(true);
    });
  });

  describe('multiple phone numbers', () => {
    it('should correctly handle mix of unique and duplicate phones', async () => {
      mockDb.registerPhone('9876543210');

      const unique = await validateMobileUniqueness('8765432109', mockDb);
      const duplicate = await validateMobileUniqueness('9876543210', mockDb);
      const anotherUnique = await validateMobileUniqueness('7654321098', mockDb);

      expect(unique.isUnique).toBe(true);
      expect(unique.allowRegistration).toBe(true);

      expect(duplicate.isUnique).toBe(false);
      expect(duplicate.allowRegistration).toBe(false);
      expect(duplicate.error).toBe('This mobile number is already in use');

      expect(anotherUnique.isUnique).toBe(true);
      expect(anotherUnique.allowRegistration).toBe(true);
    });
  });
});
