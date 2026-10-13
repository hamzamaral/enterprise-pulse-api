import {
  DEFAULT_SLA,
  averageHours,
  complianceRate,
  dueDates,
  pausedMinutesSince,
  slaState,
} from './support-math';

const at = (value: string) => new Date(`2026-10-13T${value}:00.000Z`);

describe('support math', () => {
  it('computes due dates from the policy', () => {
    const due = dueDates(at('09:00'), DEFAULT_SLA.URGENT);
    expect(due.firstResponseDueAt).toEqual(at('10:00'));
    expect(due.resolutionDueAt).toEqual(at('13:00'));
    expect(dueDates(at('09:00'), DEFAULT_SLA.URGENT, 90).resolutionDueAt).toEqual(at('14:30'));
  });

  it('measures pauses in whole minutes', () => {
    expect(pausedMinutesSince(at('09:00'), at('10:30'))).toBe(90);
    expect(pausedMinutesSince(at('10:00'), at('09:00'))).toBe(0);
  });

  it('classifies SLA targets', () => {
    const base = { startedAt: at('09:00'), dueAt: at('13:00') };
    expect(slaState({ ...base, doneAt: at('12:00'), now: at('15:00') })).toBe('MET');
    expect(slaState({ ...base, doneAt: at('13:00'), now: at('15:00') })).toBe('MET');
    expect(slaState({ ...base, doneAt: at('13:01'), now: at('15:00') })).toBe('BREACHED');
    expect(slaState({ ...base, doneAt: null, now: at('10:00') })).toBe('ON_TRACK');
    expect(slaState({ ...base, doneAt: null, now: at('12:01') })).toBe('AT_RISK');
    expect(slaState({ ...base, doneAt: null, now: at('13:01') })).toBe('BREACHED');
    expect(slaState({ ...base, doneAt: null, pausedAt: at('11:00'), now: at('16:00') })).toBe(
      'PAUSED',
    );
    expect(slaState({ ...base, doneAt: null, pausedAt: at('14:00'), now: at('16:00') })).toBe(
      'BREACHED',
    );
  });

  it('averages elapsed hours', () => {
    expect(
      averageHours([
        { from: at('09:00'), to: at('10:00') },
        { from: at('09:00'), to: at('11:15') },
      ]),
    ).toBe(1.6);
    expect(averageHours([])).toBeNull();
  });

  it('rates SLA compliance', () => {
    expect(complianceRate(9, 1)).toBe(90);
    expect(complianceRate(2, 1)).toBe(66.7);
    expect(complianceRate(0, 0)).toBeNull();
  });
});
