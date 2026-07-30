import type { LookbackPreset } from "@listening-social/contracts";

function zonedParts(date: Date, timezone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function timezoneOffsetMilliseconds(date: Date, timezone: string): number {
  const parts = zonedParts(date, timezone);
  const representedAsUtc = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return representedAsUtc - date.getTime();
}

function startOfTodayInTimezone(now: Date, timezone: string): Date {
  const local = zonedParts(now, timezone);
  const midnightGuess = new Date(
    Date.UTC(local.year ?? 1970, (local.month ?? 1) - 1, local.day ?? 1),
  );
  const firstOffset = timezoneOffsetMilliseconds(midnightGuess, timezone);
  const firstPass = new Date(midnightGuess.getTime() - firstOffset);
  const correctedOffset = timezoneOffsetMilliseconds(firstPass, timezone);
  return new Date(midnightGuess.getTime() - correctedOffset);
}

export function calculateWindow(
  preset: LookbackPreset,
  now: Date,
  timezone: string,
): { start: Date; end: Date } {
  if (preset === "today") {
    return { start: startOfTodayInTimezone(now, timezone), end: now };
  }

  const days = Number.parseInt(preset, 10);
  return {
    start: new Date(now.getTime() - days * 24 * 60 * 60 * 1_000),
    end: now,
  };
}
