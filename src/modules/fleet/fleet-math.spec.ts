import { Prisma } from '@prisma/client';
import {
  addMonths,
  averageConsumption,
  costPerKm,
  documentState,
  fuelFigures,
  monthlyKm,
  nextService,
  normalizePlate,
  odometerRange,
  serviceState,
} from './fleet-math';

const d = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const fuel = (id: string, day: string, odometer: number, liters: number, fullTank = true) => ({
  id,
  entryDate: date(day),
  odometer,
  liters: d(liters),
  fullTank,
});

describe('fleet math', () => {
  it('normalises Turkish plates and rejects others', () => {
    expect(normalizePlate('34abc123')).toBe('34 ABC 123');
    expect(normalizePlate(' 06 a 1234 ')).toBe('06 A 1234');
    expect(normalizePlate('35-ab-456')).toBe('35 AB 456');
    expect(normalizePlate('81 ZZ 99')).toBe('81 ZZ 99');
    expect(normalizePlate('00 ABC 123')).toBeNull();
    expect(normalizePlate('82 ABC 123')).toBeNull();
    expect(normalizePlate('34 ABCD 12')).toBeNull();
    expect(normalizePlate('34 ABC 12345')).toBeNull();
    expect(normalizePlate('ABC 123')).toBeNull();
  });

  it('adds months without overflowing short months', () => {
    expect(addMonths(date('2026-01-31'), 1)).toEqual(date('2026-02-28'));
    expect(addMonths(date('2026-03-15'), 12)).toEqual(date('2027-03-15'));
  });

  it('keeps odometer readings monotonic over time', () => {
    const readings = [
      { readingDate: date('2026-01-10'), odometer: 10_000 },
      { readingDate: date('2026-02-10'), odometer: 12_000 },
      { readingDate: date('2026-03-10'), odometer: 15_000 },
    ];
    expect(odometerRange(readings, date('2026-02-20'))).toEqual({ min: 12_000, max: 15_000 });
    expect(odometerRange(readings, date('2026-02-10'))).toEqual({ min: 12_000, max: 15_000 });
    expect(odometerRange(readings, date('2026-04-01'))).toEqual({ min: 15_000, max: null });
    expect(odometerRange(readings, date('2025-12-01'))).toEqual({ min: 0, max: 10_000 });
    expect(odometerRange([], date('2026-01-01'))).toEqual({ min: 0, max: null });
  });

  it('computes consumption with the full-tank method', () => {
    const entries = [
      fuel('a', '2026-01-05', 10_000, 40),
      fuel('b', '2026-01-12', 10_300, 15, false),
      fuel('c', '2026-01-19', 10_600, 21),
      fuel('d', '2026-01-26', 11_100, 30),
    ];
    const figures = fuelFigures(entries);
    expect(figures.get('a')).toEqual({ distance: null, consumption: null });
    expect(figures.get('b')).toEqual({ distance: 300, consumption: null });
    // (15 + 21) L over 600 km
    expect(figures.get('c')?.consumption?.toNumber()).toBe(6);
    expect(figures.get('c')?.distance).toBe(300);
    // 30 L over 500 km
    expect(figures.get('d')?.consumption?.toNumber()).toBe(6);
    // (15 + 21 + 30) L over 1100 km
    expect(averageConsumption(entries)?.toNumber()).toBe(6);
    expect(averageConsumption(entries.slice(0, 2))).toBeNull();
  });

  it('orders fuel entries by odometer, not by insertion', () => {
    const figures = fuelFigures([
      fuel('late', '2026-02-01', 1_500, 30),
      fuel('early', '2026-01-01', 1_000, 40),
    ]);
    expect(figures.get('late')?.consumption?.toNumber()).toBe(6);
  });

  it('classifies documents by their end date', () => {
    const today = date('2026-10-14');
    expect(documentState(null, today)).toBe('MISSING');
    expect(documentState(date('2026-10-13'), today)).toBe('EXPIRED');
    expect(documentState(date('2026-10-14'), today)).toBe('EXPIRING');
    expect(documentState(date('2026-11-13'), today)).toBe('EXPIRING');
    expect(documentState(date('2026-11-14'), today)).toBe('VALID');
  });

  it('decides the service state by whichever of km and date comes first', () => {
    const today = date('2026-10-14');
    const at = (odometer: number, km: number | null, day: string | null) =>
      serviceState({ odometer, nextServiceKm: km, nextServiceDate: day ? date(day) : null }, today);
    expect(at(10_000, null, null)).toBeNull();
    expect(at(10_000, 20_000, '2027-06-01')).toBe('OK');
    expect(at(19_000, 20_000, '2027-06-01')).toBe('DUE_SOON');
    expect(at(10_000, 20_000, '2026-11-01')).toBe('DUE_SOON');
    expect(at(20_000, 20_000, '2027-06-01')).toBe('OVERDUE');
    expect(at(10_000, null, '2026-10-13')).toBe('OVERDUE');
  });

  it('plans the next periodic service from the intervals', () => {
    expect(nextService(date('2026-03-10'), 45_000, 15_000, 12)).toEqual({
      nextServiceKm: 60_000,
      nextServiceDate: date('2027-03-10'),
    });
    expect(nextService(date('2026-03-10'), null, 15_000, null)).toEqual({
      nextServiceKm: null,
      nextServiceDate: null,
    });
  });

  it('spreads the km driven over the months of a year', () => {
    const readings = [
      { readingDate: date('2025-12-20'), odometer: 9_000 },
      { readingDate: date('2026-01-10'), odometer: 10_000 },
      { readingDate: date('2026-01-28'), odometer: 11_000 },
      { readingDate: date('2026-03-05'), odometer: 12_500 },
    ];
    const km = monthlyKm(readings, 2026);
    expect(km.slice(0, 4)).toEqual([2_000, 0, 1_500, 0]);
    expect(km.reduce((a, b) => a + b, 0)).toBe(3_500);
    expect(monthlyKm(readings.slice(1), 2026).slice(0, 3)).toEqual([1_000, 0, 1_500]);
  });

  it('divides the cost by the distance', () => {
    expect(costPerKm(d(1000), 400)?.toNumber()).toBe(2.5);
    expect(costPerKm(d(1000), 0)).toBeNull();
  });
});
