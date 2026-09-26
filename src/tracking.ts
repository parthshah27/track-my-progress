export type TrackingArea = "trading" | "learning";

export const TRACKING_AREAS: Array<{ id: TrackingArea; label: string; description: string }> = [
  {
    id: "trading",
    label: "Trading",
    description: "P&L, rules, and execution notes.",
  },
  {
    id: "learning",
    label: "Learning",
    description: "Study time, completion, and progress.",
  },
];

export const TRACKING_AREAS_STORAGE_KEY = "Track My Progress-enabled-tracking-areas";
export const DEFAULT_ENABLED_AREAS: TrackingArea[] = ["trading", "learning"];

export function isTrackingArea(value: unknown): value is TrackingArea {
  return value === "trading" || value === "learning";
}

export function readEnabledAreas(): TrackingArea[] {
  if (typeof window === "undefined") {
    return DEFAULT_ENABLED_AREAS;
  }

  try {
    const stored = window.localStorage.getItem(TRACKING_AREAS_STORAGE_KEY);

    if (!stored) {
      return DEFAULT_ENABLED_AREAS;
    }

    const parsed = JSON.parse(stored) as unknown;

    if (!Array.isArray(parsed)) {
      return DEFAULT_ENABLED_AREAS;
    }

    const validAreas = parsed.filter(isTrackingArea);

    return validAreas.length > 0 ? validAreas : DEFAULT_ENABLED_AREAS;
  } catch {
    return DEFAULT_ENABLED_AREAS;
  }
}

export function formatStudyMinutes(minutes: number) {
  if (!Number.isFinite(minutes)) {
    return "0m";
  }

  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;

  if (hours > 0 && remainingMinutes > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  return `${remainingMinutes}m`;
}
