import { describe, expect, it } from 'vitest';
import {
  dayBounds,
  inQuietHours,
  nextAllowedTime,
  nextOccurrence,
  tomorrowMorning,
} from '../server/services/time.js';
import { settingsSchema } from '../shared/schemas.js';
describe('Timezone, DST and call policy calculations', () => {
  const schedule = {
    recurrence: 'daily' as const,
    timezone: 'America/New_York',
    local_time: '09:00',
    day_of_week: 1,
  };
  it('preserves local time through spring DST', () => {
    expect(nextOccurrence(schedule, '2026-03-07T14:00:00Z')).toBe('2026-03-08T13:00:00.000Z');
  });
  it('preserves local time through fall DST', () => {
    expect(nextOccurrence(schedule, '2026-10-31T13:00:00Z')).toBe('2026-11-01T14:00:00.000Z');
  });
  it('does not repeat an ambiguous fall-back hour', () => {
    expect(nextOccurrence({ ...schedule, local_time: '01:30' }, '2026-11-01T05:30:00Z')).toBe(
      '2026-11-02T06:30:00.000Z',
    );
  });
  it('moves nonexistent spring-forward times forward', () => {
    expect(nextOccurrence({ ...schedule, local_time: '02:30' }, '2026-03-07T07:30:00Z')).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });
  it('skips weekends', () => {
    expect(nextOccurrence({ ...schedule, recurrence: 'weekdays' }, '2026-10-09T13:00:00Z')).toBe(
      '2026-10-12T13:00:00.000Z',
    );
  });
  it('handles overnight quiet hours and exact boundaries', () => {
    const s = settingsSchema.parse({});
    expect(inQuietHours(new Date('2026-10-13T02:00:00Z'), s)).toBe(true);
    expect(inQuietHours(new Date('2026-10-13T12:00:00Z'), s)).toBe(false);
    expect(nextAllowedTime(new Date('2026-10-13T02:00:00Z'), s)).toBe('2026-10-13T12:00:00.000Z');
  });
  it('respects pauses and daily DST bounds', () => {
    const s = settingsSchema.parse({ paused_until: '2026-10-19T15:00:00Z' });
    expect(nextAllowedTime(new Date('2026-10-12T13:00:00Z'), s)).toBe(
      s.paused_until?.replace('Z', '.000Z'),
    );
    const b = dayBounds(new Date('2026-11-01T15:00:00Z'), 'America/New_York');
    expect(new Date(b.end).getTime() - new Date(b.start).getTime()).toBe(25 * 3600000);
  });
  it('interprets tomorrow morning in the owner timezone', () => {
    expect(tomorrowMorning(new Date('2026-10-13T02:00:00Z'), 'America/New_York')).toBe(
      '2026-10-13T13:00:00.000Z',
    );
  });
});
