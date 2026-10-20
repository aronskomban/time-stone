/**
 * Pure presentation and calendar helpers.
 *
 * Kept free of server and React imports so the same logic runs during server
 * rendering, in the client bundle, and inside unit tests.
 */

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function hoursLabel(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = safe / 3600;
  const rounded = Math.round(hours * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}h`;
}

export function decimalHours(totalSeconds: number): number {
  return Math.round((Math.max(0, totalSeconds) / 3600) * 100) / 100;
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function mondayOf(value: Date): Date {
  const shifted = new Date(value);
  const weekday = shifted.getUTCDay() || 7;
  shifted.setUTCDate(shifted.getUTCDate() - weekday + 1);
  shifted.setUTCHours(0, 0, 0, 0);
  return shifted;
}

export function weekDates(monday: Date, count = 7): string[] {
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + index);
    return dateOnly(day);
  });
}

export function prettyDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(parsed);
}

export function weekdayLabel(value: string): string {
  const parsed = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en", { weekday: "short" }).format(parsed);
}

export function timeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(parsed);
}

export function secondsBetween(start: string | Date, end: string | Date): number {
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.floor((to - from) / 1000));
}

/** Live elapsed seconds for a timer, honouring paused accumulation. */
export function timerElapsed(
  timer: { startedAt: string; state: string; accumulatedSeconds: number; pausedAt?: string | null },
  nowMs: number,
): number {
  if (timer.state === "paused") return Math.max(0, timer.accumulatedSeconds);
  return Math.max(0, timer.accumulatedSeconds + secondsBetween(timer.startedAt, new Date(nowMs).toISOString()));
}

export function breakSeconds(
  breaks: Array<{ startedAt: string; endedAt: string | null; state?: string; accumulatedSeconds?: number }>,
): number {
  return breaks.reduce((total, item) => {
    if (item.endedAt) return total + secondsBetween(item.startedAt, item.endedAt);
    if (typeof item.accumulatedSeconds === "number") return total + item.accumulatedSeconds;
    return total;
  }, 0);
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell === null || cell === undefined ? "" : String(cell);
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(","),
    )
    .join("\n");
}

export function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
