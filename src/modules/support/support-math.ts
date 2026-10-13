import { TicketPriority, TicketStatus } from '@prisma/client';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export interface SlaTargets {
  firstResponseHours: number;
  resolutionHours: number;
}

/** Used when a company has not defined a policy for the priority. */
export const DEFAULT_SLA: Record<TicketPriority, SlaTargets> = {
  URGENT: { firstResponseHours: 1, resolutionHours: 4 },
  HIGH: { firstResponseHours: 4, resolutionHours: 24 },
  MEDIUM: { firstResponseHours: 8, resolutionHours: 72 },
  LOW: { firstResponseHours: 24, resolutionHours: 120 },
};

export const PRIORITY_ORDER: TicketPriority[] = [
  TicketPriority.URGENT,
  TicketPriority.HIGH,
  TicketPriority.MEDIUM,
  TicketPriority.LOW,
];

/** Tickets the support team still has to work on. */
export const ACTIVE_STATUSES: TicketStatus[] = [
  TicketStatus.OPEN,
  TicketStatus.IN_PROGRESS,
  TicketStatus.WAITING,
];

export const isActive = (status: TicketStatus) => ACTIVE_STATUSES.includes(status);

/** Status changes an agent may make; reopening a closed ticket is not allowed. */
export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: [
    TicketStatus.IN_PROGRESS,
    TicketStatus.WAITING,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  IN_PROGRESS: [
    TicketStatus.OPEN,
    TicketStatus.WAITING,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  WAITING: [
    TicketStatus.OPEN,
    TicketStatus.IN_PROGRESS,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  RESOLVED: [TicketStatus.IN_PROGRESS, TicketStatus.CLOSED],
  CLOSED: [],
};

/** Due dates measured from creation; `pausedMinutes` pushes the resolution target back. */
export function dueDates(createdAt: Date, targets: SlaTargets, pausedMinutes = 0) {
  return {
    firstResponseDueAt: new Date(createdAt.getTime() + targets.firstResponseHours * HOUR_MS),
    resolutionDueAt: new Date(
      createdAt.getTime() + targets.resolutionHours * HOUR_MS + pausedMinutes * MINUTE_MS,
    ),
  };
}

/** Whole minutes between the start of a pause and now. */
export const pausedMinutesSince = (pausedAt: Date, now: Date) =>
  Math.max(0, Math.round((now.getTime() - pausedAt.getTime()) / MINUTE_MS));

export const SLA_STATES = ['ON_TRACK', 'AT_RISK', 'BREACHED', 'MET', 'PAUSED'] as const;
export type SlaState = (typeof SLA_STATES)[number];

/** A target is at risk once less than this share of its window is left. */
export const AT_RISK_SHARE = 0.25;

export interface SlaInput {
  startedAt: Date;
  dueAt: Date;
  /** When the target was reached (first response or resolution). */
  doneAt: Date | null;
  /** Start of the current pause; only the resolution clock pauses. */
  pausedAt?: Date | null;
  now: Date;
}

export function slaState({ startedAt, dueAt, doneAt, pausedAt, now }: SlaInput): SlaState {
  if (doneAt) return doneAt <= dueAt ? 'MET' : 'BREACHED';
  const at = pausedAt ?? now;
  if (at > dueAt) return 'BREACHED';
  if (pausedAt) return 'PAUSED';
  const window = dueAt.getTime() - startedAt.getTime();
  const left = dueAt.getTime() - now.getTime();
  return window > 0 && left < window * AT_RISK_SHARE ? 'AT_RISK' : 'ON_TRACK';
}

/** Mean of the elapsed hours, one decimal; null when there is nothing to measure. */
export function averageHours(pairs: { from: Date; to: Date }[]): number | null {
  if (!pairs.length) return null;
  const total = pairs.reduce((sum, p) => sum + (p.to.getTime() - p.from.getTime()), 0);
  return Math.round((total / pairs.length / HOUR_MS) * 10) / 10;
}

/** Share of `met` in `met + breached` as a percentage, one decimal. */
export function complianceRate(met: number, breached: number): number | null {
  const total = met + breached;
  return total ? Math.round((met / total) * 1000) / 10 : null;
}
