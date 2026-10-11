export interface NumberFormat {
  prefix: string;
  padding: number;
  includeYear: boolean;
}

/** formatNumber({ prefix: 'ZMT', padding: 6, includeYear: true }, 2026, 42) === 'ZMT-2026-000042' */
export function formatNumber(format: NumberFormat, year: number, value: number): string {
  const sequence = String(value).padStart(format.padding, '0');
  return format.includeYear
    ? `${format.prefix}-${year}-${sequence}`
    : `${format.prefix}-${sequence}`;
}
