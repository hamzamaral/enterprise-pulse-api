import { ApplicationStage, InterviewRecommendation } from '@prisma/client';

/** Board columns, in pipeline order. */
export const ACTIVE_STAGES: ApplicationStage[] = [
  ApplicationStage.APPLIED,
  ApplicationStage.SCREENING,
  ApplicationStage.INTERVIEW,
  ApplicationStage.OFFER,
];
export const CLOSED_STAGES: ApplicationStage[] = [
  ApplicationStage.HIRED,
  ApplicationStage.REJECTED,
  ApplicationStage.WITHDRAWN,
];

const DAY_MS = 86_400_000;
const RECOMMENDATION_SCORE: Record<InterviewRecommendation, number> = {
  STRONG_YES: 2,
  YES: 1,
  NO: -1,
  STRONG_NO: -2,
};

export const isActiveStage = (stage: ApplicationStage) => ACTIVE_STAGES.includes(stage);

/** Interviews and offers pull an application forward, never back. */
export function advanceTo(current: ApplicationStage, target: ApplicationStage): ApplicationStage {
  if (!isActiveStage(current)) return current;
  return ACTIVE_STAGES.indexOf(target) > ACTIVE_STAGES.indexOf(current) ? target : current;
}

/** Whole days between two instants, never negative. */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

/** Average days from application to hire (one decimal), or null without hires. */
export function averageDaysToHire(hires: { appliedAt: Date; hiredAt: Date }[]): number | null {
  if (!hires.length) return null;
  const total = hires.reduce((sum, h) => sum + daysBetween(h.appliedAt, h.hiredAt), 0);
  return Math.round((total / hires.length) * 10) / 10;
}

export interface FeedbackScore {
  /** Mean of the submitted ratings (one decimal), null without ratings. */
  averageRating: number | null;
  /** Sum of recommendations: strong yes +2, yes +1, no -1, strong no -2. */
  recommendationScore: number;
  submitted: number;
  total: number;
}

/** Summary of the interviewers' feedback on an application. */
export function feedbackScore(
  participants: { rating: number | null; recommendation: InterviewRecommendation | null }[],
): FeedbackScore {
  const ratings = participants.map((p) => p.rating).filter((r): r is number => r !== null);
  const recommendations = participants
    .map((p) => p.recommendation)
    .filter((r): r is InterviewRecommendation => r !== null);
  return {
    averageRating: ratings.length
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
      : null,
    recommendationScore: recommendations.reduce((sum, r) => sum + RECOMMENDATION_SCORE[r], 0),
    submitted: recommendations.length,
    total: participants.length,
  };
}

/**
 * Funnel counts: how many applications reached each pipeline stage. Rejected and withdrawn ones
 * count up to the stage they were in (`lastActiveStage`); hired ones reach every stage.
 */
export function funnel(
  applications: { stage: ApplicationStage; lastActiveStage: ApplicationStage }[],
): Record<'APPLIED' | 'SCREENING' | 'INTERVIEW' | 'OFFER' | 'HIRED', number> {
  const counts = { APPLIED: 0, SCREENING: 0, INTERVIEW: 0, OFFER: 0, HIRED: 0 };
  for (const app of applications) {
    const reached =
      app.stage === ApplicationStage.HIRED
        ? ACTIVE_STAGES.length
        : ACTIVE_STAGES.indexOf(isActiveStage(app.stage) ? app.stage : app.lastActiveStage);
    for (let i = 0; i <= Math.min(reached, ACTIVE_STAGES.length - 1); i++) {
      counts[ACTIVE_STAGES[i] as keyof typeof counts]++;
    }
    if (app.stage === ApplicationStage.HIRED) counts.HIRED++;
  }
  return counts;
}
