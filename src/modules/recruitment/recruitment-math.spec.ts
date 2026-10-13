import { ApplicationStage } from '@prisma/client';
import {
  advanceTo,
  averageDaysToHire,
  daysBetween,
  feedbackScore,
  funnel,
  isActiveStage,
} from './recruitment-math';

const day = (date: string) => new Date(`${date}T09:00:00Z`);

describe('recruitment math', () => {
  it('only moves applications forward', () => {
    expect(advanceTo('APPLIED', 'INTERVIEW')).toBe('INTERVIEW');
    expect(advanceTo('OFFER', 'INTERVIEW')).toBe('OFFER');
    expect(advanceTo('REJECTED', 'OFFER')).toBe('REJECTED');
  });

  it('knows the active stages', () => {
    expect(isActiveStage('SCREENING')).toBe(true);
    expect(isActiveStage('HIRED')).toBe(false);
    expect(isActiveStage('WITHDRAWN')).toBe(false);
  });

  it('counts whole days', () => {
    expect(daysBetween(day('2026-03-01'), day('2026-03-31'))).toBe(30);
    expect(daysBetween(day('2026-03-02'), day('2026-03-01'))).toBe(0);
  });

  it('averages the time to hire', () => {
    expect(averageDaysToHire([])).toBeNull();
    expect(
      averageDaysToHire([
        { appliedAt: day('2026-01-01'), hiredAt: day('2026-01-31') },
        { appliedAt: day('2026-02-01'), hiredAt: day('2026-02-16') },
        { appliedAt: day('2026-03-01'), hiredAt: day('2026-03-21') },
      ]),
    ).toBe(21.7);
  });

  it('scores interview feedback', () => {
    expect(
      feedbackScore([
        { rating: 4, recommendation: 'YES' },
        { rating: 5, recommendation: 'STRONG_YES' },
        { rating: null, recommendation: null },
      ]),
    ).toEqual({ averageRating: 4.5, recommendationScore: 3, submitted: 2, total: 3 });
    expect(feedbackScore([{ rating: 2, recommendation: 'STRONG_NO' }]).recommendationScore).toBe(
      -2,
    );
  });

  it('builds the hiring funnel', () => {
    const stage = (s: ApplicationStage, last: ApplicationStage = s) => ({
      stage: s,
      lastActiveStage: last,
    });
    expect(
      funnel([
        stage('APPLIED'),
        stage('SCREENING'),
        stage('INTERVIEW'),
        stage('REJECTED', 'INTERVIEW'),
        stage('WITHDRAWN', 'APPLIED'),
        stage('OFFER'),
        stage('HIRED', 'OFFER'),
      ]),
    ).toEqual({ APPLIED: 7, SCREENING: 5, INTERVIEW: 4, OFFER: 2, HIRED: 1 });
  });
});
