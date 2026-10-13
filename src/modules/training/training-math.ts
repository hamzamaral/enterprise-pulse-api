export const COMPLIANCE_STATUSES = ['VALID', 'EXPIRING', 'EXPIRED', 'MISSING'] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

/** Certificates this close to expiry are flagged. */
export const EXPIRY_WARNING_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Expiry of a certificate earned on `completedOn` (a UTC date): the same day `months` later,
 * clamped to the end of shorter months (31 Jan + 1 month = 28/29 Feb). Null never expires.
 */
export function certificateExpiry(completedOn: Date, months: number | null): Date | null {
  if (!months) return null;
  const year = completedOn.getUTCFullYear();
  const month = completedOn.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(completedOn.getUTCDate(), lastDay)));
}

/**
 * Status of a mandatory course for one employee. `expiresAt` is the latest certificate's
 * expiry: undefined when the course was never completed, null when it never expires.
 */
export function complianceStatus(
  expiresAt: Date | null | undefined,
  today: Date,
  warningDays = EXPIRY_WARNING_DAYS,
): ComplianceStatus {
  if (expiresAt === undefined) return 'MISSING';
  if (expiresAt === null) return 'VALID';
  if (expiresAt.getTime() < today.getTime()) return 'EXPIRED';
  if (expiresAt.getTime() - today.getTime() <= warningDays * DAY_MS) return 'EXPIRING';
  return 'VALID';
}

/** Share of compliant employee-course pairs in percent (expiring still counts); null if none. */
export function complianceRate(counts: Record<ComplianceStatus, number>): number | null {
  const total = COMPLIANCE_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  if (!total) return null;
  return Math.round(((counts.VALID + counts.EXPIRING) / total) * 1000) / 10;
}

/** Free seats of a session; null when it has no capacity limit. */
export function seatsLeft(capacity: number | null, enrolled: number): number | null {
  return capacity === null ? null : Math.max(0, capacity - enrolled);
}
