import { LeadStatus, OpportunityStage, Prisma } from '@prisma/client';

/** Stages an opportunity moves through before it is won or lost, in pipeline order. */
export const OPEN_STAGES: OpportunityStage[] = [
  OpportunityStage.PROSPECTING,
  OpportunityStage.QUALIFICATION,
  OpportunityStage.PROPOSAL,
  OpportunityStage.NEGOTIATION,
];

export const CLOSED_STAGES: OpportunityStage[] = [OpportunityStage.WON, OpportunityStage.LOST];

/** Leads that can still be worked, disqualified or converted. */
export const ACTIVE_LEAD_STATUSES: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.CONTACTED,
  LeadStatus.QUALIFIED,
];

const DEFAULT_PROBABILITY: Record<OpportunityStage, number> = {
  PROSPECTING: 10,
  QUALIFICATION: 25,
  PROPOSAL: 50,
  NEGOTIATION: 75,
  WON: 100,
  LOST: 0,
};

export function defaultProbability(stage: OpportunityStage): number {
  return DEFAULT_PROBABILITY[stage];
}

export function isOpenStage(stage: OpportunityStage): boolean {
  return OPEN_STAGES.includes(stage);
}

/** Expected value: amount × probability, rounded to 2 decimals. */
export function weightedAmount(amount: Prisma.Decimal.Value, probability: number): Prisma.Decimal {
  return new Prisma.Decimal(amount)
    .times(probability)
    .dividedBy(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Stage after a quote is created for the opportunity: early stages jump to PROPOSAL,
 * NEGOTIATION stays where it is.
 */
export function stageAfterQuote(stage: OpportunityStage): OpportunityStage {
  return OPEN_STAGES.indexOf(stage) < OPEN_STAGES.indexOf(OpportunityStage.PROPOSAL)
    ? OpportunityStage.PROPOSAL
    : stage;
}

/** Won share of the closed opportunities, in percent; null when nothing was closed. */
export function winRate(won: number, lost: number): number | null {
  const closed = won + lost;
  return closed ? Math.round((won / closed) * 100) : null;
}
