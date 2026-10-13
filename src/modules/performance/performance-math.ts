/** Ratings are whole numbers from 1 to 5. */
export const MIN_RATING = 1;
export const MAX_RATING = 5;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Sum of the goal weights; a review is ready when it is exactly 100. */
export function totalWeight(goals: { weight: number }[]): number {
  return goals.reduce((sum, g) => sum + g.weight, 0);
}

/** Weighted mean of the goal ratings; null while a goal is unrated or there are no goals. */
export function goalScore(goals: { weight: number; rating: number | null }[]): number | null {
  const weight = totalWeight(goals);
  if (!goals.length || weight <= 0 || goals.some((g) => g.rating === null)) return null;
  const sum = goals.reduce((acc, g) => acc + g.weight * g.rating!, 0);
  return round2(sum / weight);
}

/** Plain mean of the competency ratings; null while one is unrated or there are none. */
export function competencyScore(ratings: (number | null)[]): number | null {
  if (!ratings.length || ratings.some((r) => r === null)) return null;
  return round2(ratings.reduce((acc: number, r) => acc + r!, 0) / ratings.length);
}

/**
 * Goals count `goalWeight` percent, competencies the rest. A missing part leaves the other one
 * as the overall score (a cycle without competencies, or a review without goals).
 */
export function overallScore(
  goals: number | null,
  competencies: number | null,
  goalWeight: number,
): number | null {
  if (goals === null) return competencies;
  if (competencies === null) return goals;
  return round2((goals * goalWeight + competencies * (100 - goalWeight)) / 100);
}

/** The 1-5 band of a score, rounding halves up (3.5 → 4). */
export function scoreBand(score: number): number {
  return Math.min(MAX_RATING, Math.max(MIN_RATING, Math.floor(score + 0.5)));
}

/** How many scores fall in each band; index 0 is band 1. */
export function scoreDistribution(scores: number[]): number[] {
  const counts = [0, 0, 0, 0, 0];
  for (const score of scores) counts[scoreBand(score) - 1] += 1;
  return counts;
}

/** What the reviewer still has to fill in before the review can be submitted. */
export function missingRatings(
  goals: { rating: number | null }[],
  competencies: { rating: number | null }[],
): { goals: number; competencies: number } {
  return {
    goals: goals.filter((g) => g.rating === null).length,
    competencies: competencies.filter((c) => c.rating === null).length,
  };
}
