import { parseDateOnly } from '../../common/dates/date-only';
import {
  DEFAULT_SHIFT,
  evaluateDay,
  formatClock,
  instantOf,
  minutesSinceWorkDate,
  plannedMinutes,
  zoneOffsetMinutes,
  type DayInput,
} from './timesheet';

const night = { code: 'GCE', startTime: '23:00', endTime: '07:00', breakMinutes: 30 };
const day = (input: Partial<DayInput>): DayInput => ({
  shift: DEFAULT_SHIFT,
  holiday: false,
  leave: false,
  checkIn: null,
  checkOut: null,
  now: 7 * 24 * 60,
  ...input,
});

describe('evaluateDay', () => {
  it('counts an on-time full day without overtime', () => {
    expect(evaluateDay(day({ checkIn: 9 * 60 - 10, checkOut: 18 * 60 + 5 }))).toEqual({
      status: 'PRESENT',
      plannedMinutes: 480,
      workedMinutes: 495,
      lateMinutes: 0,
      overtimeMinutes: 0,
    });
  });

  it('tolerates the grace period but flags later check-ins', () => {
    expect(evaluateDay(day({ checkIn: 9 * 60 + 5, checkOut: 18 * 60 })).status).toBe('PRESENT');
    const late = evaluateDay(day({ checkIn: 9 * 60 + 20, checkOut: 18 * 60 }));
    expect(late).toMatchObject({ status: 'LATE', lateMinutes: 20, workedMinutes: 460 });
  });

  it('reports overtime beyond the planned minutes from the threshold on', () => {
    expect(evaluateDay(day({ checkIn: 9 * 60, checkOut: 20 * 60 })).overtimeMinutes).toBe(120);
    expect(evaluateDay(day({ checkIn: 9 * 60, checkOut: 18 * 60 + 29 })).overtimeMinutes).toBe(0);
    expect(evaluateDay(day({ checkIn: 9 * 60, checkOut: 18 * 60 + 30 })).overtimeMinutes).toBe(30);
  });

  it('marks a missing check-in as absent once the shift is over', () => {
    expect(evaluateDay(day({})).status).toBe('ABSENT');
    expect(evaluateDay(day({ now: 10 * 60 })).status).toBe('UPCOMING');
  });

  it('keeps an open day incomplete without worked time', () => {
    expect(evaluateDay(day({ checkIn: 9 * 60, now: 12 * 60 }))).toMatchObject({
      status: 'INCOMPLETE',
      workedMinutes: 0,
    });
  });

  it('gives leave and holidays precedence and counts work on them as overtime', () => {
    expect(evaluateDay(day({ leave: true })).status).toBe('LEAVE');
    const holiday = evaluateDay(day({ holiday: true, checkIn: 9 * 60, checkOut: 11 * 60 }));
    expect(holiday).toMatchObject({ status: 'HOLIDAY', plannedMinutes: 0, overtimeMinutes: 120 });
  });

  it('treats unplanned days as off', () => {
    expect(evaluateDay(day({ shift: null })).status).toBe('OFF');
  });

  it('handles night shifts that end on the next day', () => {
    expect(plannedMinutes(night)).toBe(450);
    const result = evaluateDay(day({ shift: night, checkIn: 23 * 60, checkOut: 31 * 60 }));
    expect(result).toMatchObject({ status: 'PRESENT', workedMinutes: 450, overtimeMinutes: 0 });
  });
});

describe('time zone helpers', () => {
  it('resolves the Istanbul offset', () => {
    expect(zoneOffsetMinutes('Europe/Istanbul', new Date('2026-10-11T12:00:00Z'))).toBe(180);
    expect(zoneOffsetMinutes('UTC', new Date('2026-10-11T12:00:00Z'))).toBe(0);
  });

  it('converts between instants and work-date minutes', () => {
    const date = parseDateOnly('2026-10-12');
    const checkIn = instantOf(date, 9 * 60, 180);
    expect(checkIn.toISOString()).toBe('2026-10-12T06:00:00.000Z');
    expect(minutesSinceWorkDate(checkIn, date, 180)).toBe(540);
    expect(formatClock(minutesSinceWorkDate(instantOf(date, 31 * 60, 180), date, 180))).toBe(
      '07:00',
    );
  });
});
