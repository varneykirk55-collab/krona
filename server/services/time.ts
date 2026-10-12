import { DateTime } from 'luxon';
import type { ScheduleInput, Settings } from '../../shared/schemas.js';
import { AppError } from '../errors.js';
export function iso(value: Date | string): string {
  return new Date(value).toISOString();
}
export function zonedTime(day: DateTime, time: string): DateTime {
  const [hour, minute] = time.split(':').map(Number);
  const candidate = day.startOf('day').set({ hour, minute, second: 0, millisecond: 0 });
  // Luxon moves nonexistent spring-forward times forward. Use the earlier instant on fall-back.
  return candidate.getPossibleOffsets().sort((a, b) => a.toMillis() - b.toMillis())[0] || candidate;
}
export function nextOccurrence(
  schedule: Pick<ScheduleInput, 'recurrence' | 'timezone' | 'local_time' | 'day_of_week'>,
  after: string | Date,
): string | null {
  if (schedule.recurrence === 'once') return null;
  const now = DateTime.fromJSDate(new Date(after), { zone: schedule.timezone });
  if (!now.isValid)
    throw new AppError(400, 'INVALID_TIME', 'The scheduled time or timezone is invalid.');
  for (let i = 0; i < 370; i++) {
    const day = now.plus({ days: i });
    if (schedule.recurrence === 'weekdays' && day.weekday > 5) continue;
    if (schedule.recurrence === 'weekly' && day.weekday !== schedule.day_of_week) continue;
    const candidate = zonedTime(day, schedule.local_time);
    if (candidate.toMillis() > now.toMillis()) return candidate.toUTC().toISO()!;
  }
  throw new AppError(400, 'INVALID_RECURRENCE', 'Could not calculate the next occurrence.');
}
export function inQuietHours(
  now: Date,
  settings: Pick<Settings, 'timezone' | 'quiet_start' | 'quiet_end'>,
): boolean {
  if (settings.quiet_start === settings.quiet_end) return false;
  const local = DateTime.fromJSDate(now, { zone: settings.timezone });
  const time = local.toFormat('HH:mm');
  return settings.quiet_start < settings.quiet_end
    ? time >= settings.quiet_start && time < settings.quiet_end
    : time >= settings.quiet_start || time < settings.quiet_end;
}
export function nextAllowedTime(now: Date, settings: Settings): string {
  let local: DateTime = DateTime.fromJSDate(now, { zone: settings.timezone });
  if (settings.paused_until && new Date(settings.paused_until).getTime() > now.getTime())
    local = DateTime.fromISO(settings.paused_until, { zone: settings.timezone });
  if (inQuietHours(local.toJSDate(), settings)) {
    let day = local;
    if (
      settings.quiet_start > settings.quiet_end &&
      local.toFormat('HH:mm') >= settings.quiet_start
    )
      day = day.plus({ days: 1 });
    local = zonedTime(day, settings.quiet_end);
  }
  return local.toUTC().toISO()!;
}
export function dayBounds(now: Date, zone: string): { start: string; end: string } {
  const local = DateTime.fromJSDate(now, { zone }).startOf('day');
  return { start: local.toUTC().toISO()!, end: local.plus({ days: 1 }).toUTC().toISO()! };
}
export function tomorrowMorning(now: Date, zone: string): string {
  return zonedTime(DateTime.fromJSDate(now, { zone }).plus({ days: 1 }), '09:00')
    .toUTC()
    .toISO()!;
}
