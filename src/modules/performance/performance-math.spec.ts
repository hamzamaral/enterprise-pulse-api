import {
  competencyScore,
  goalScore,
  missingRatings,
  overallScore,
  scoreBand,
  scoreDistribution,
  totalWeight,
} from './performance-math';

describe('performance math', () => {
  it('weights goal ratings', () => {
    const goals = [
      { weight: 50, rating: 5 },
      { weight: 30, rating: 3 },
      { weight: 20, rating: 2 },
    ];
    expect(totalWeight(goals)).toBe(100);
    expect(goalScore(goals)).toBe(3.8);
  });

  it('waits until every goal is rated', () => {
    expect(goalScore([])).toBeNull();
    expect(
      goalScore([
        { weight: 60, rating: 4 },
        { weight: 40, rating: null },
      ]),
    ).toBeNull();
  });

  it('averages competencies', () => {
    expect(competencyScore([4, 3, 5])).toBe(4);
    expect(competencyScore([4, 3, 4])).toBe(3.67);
    expect(competencyScore([4, null])).toBeNull();
    expect(competencyScore([])).toBeNull();
  });

  it('blends goals and competencies by the cycle weight', () => {
    expect(overallScore(3.8, 4, 60)).toBe(3.88);
    expect(overallScore(3.8, 4, 100)).toBe(3.8);
    expect(overallScore(null, 4, 60)).toBe(4);
    expect(overallScore(3.8, null, 60)).toBe(3.8);
    expect(overallScore(null, null, 60)).toBeNull();
  });

  it('puts scores into bands', () => {
    expect(scoreBand(1)).toBe(1);
    expect(scoreBand(2.49)).toBe(2);
    expect(scoreBand(3.5)).toBe(4);
    expect(scoreBand(4.75)).toBe(5);
    expect(scoreDistribution([1.2, 3.4, 3.5, 3.88, 4.9])).toEqual([1, 0, 1, 2, 1]);
  });

  it('counts missing ratings', () => {
    expect(
      missingRatings(
        [{ rating: 4 }, { rating: null }],
        [{ rating: null }, { rating: null }, { rating: 3 }],
      ),
    ).toEqual({ goals: 1, competencies: 2 });
  });
});
