import { certificateExpiry, complianceRate, complianceStatus, seatsLeft } from './training-math';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('training math', () => {
  it('computes certificate expiry', () => {
    expect(certificateExpiry(day('2026-03-15'), 12)).toEqual(day('2027-03-15'));
    expect(certificateExpiry(day('2026-01-31'), 1)).toEqual(day('2026-02-28'));
    expect(certificateExpiry(day('2027-11-30'), 3)).toEqual(day('2028-02-29'));
    expect(certificateExpiry(day('2026-03-15'), null)).toBeNull();
  });

  it('classifies compliance', () => {
    const today = day('2026-10-13');
    expect(complianceStatus(undefined, today)).toBe('MISSING');
    expect(complianceStatus(null, today)).toBe('VALID');
    expect(complianceStatus(day('2026-10-12'), today)).toBe('EXPIRED');
    expect(complianceStatus(day('2026-10-13'), today)).toBe('EXPIRING');
    expect(complianceStatus(day('2026-11-12'), today)).toBe('EXPIRING');
    expect(complianceStatus(day('2026-11-13'), today)).toBe('VALID');
  });

  it('rates compliance', () => {
    expect(complianceRate({ VALID: 6, EXPIRING: 1, EXPIRED: 2, MISSING: 1 })).toBe(70);
    expect(complianceRate({ VALID: 1, EXPIRING: 0, EXPIRED: 0, MISSING: 2 })).toBe(33.3);
    expect(complianceRate({ VALID: 0, EXPIRING: 0, EXPIRED: 0, MISSING: 0 })).toBeNull();
  });

  it('counts free seats', () => {
    expect(seatsLeft(10, 7)).toBe(3);
    expect(seatsLeft(5, 6)).toBe(0);
    expect(seatsLeft(null, 50)).toBeNull();
  });
});
