/** `@db.Date` columns travel as "YYYY-MM-DD" strings so time zones can never shift the day. */
export function toDateOnly(value: Date): string;
export function toDateOnly(value: Date | null): string | null;
export function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function parseDateOnly(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
