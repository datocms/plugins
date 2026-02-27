import {
  AutomaticBackupsScheduleState,
  BackupCadence,
  BackupScheduleConfig,
} from "../types/types";

export const BACKUP_SCHEDULE_VERSION = 1 as const;
export const BACKUP_CADENCES: BackupCadence[] = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
];
export const DEFAULT_ENABLED_CADENCES: BackupCadence[] = ["daily", "weekly"];
export const DEFAULT_LAMBDALESS_TIME = "00:00";
const FALLBACK_TIMEZONE = "UTC";
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isBackupCadence = (value: unknown): value is BackupCadence => {
  return BACKUP_CADENCES.includes(value as BackupCadence);
};

const ensureTimezone = (value: unknown, fallback: string): string => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return fallback || FALLBACK_TIMEZONE;
};

const normalizeCadences = (value: unknown): BackupCadence[] => {
  if (!Array.isArray(value)) {
    return [...DEFAULT_ENABLED_CADENCES];
  }

  const set = new Set<BackupCadence>();
  for (const entry of value) {
    if (isBackupCadence(entry)) {
      set.add(entry);
    }
  }

  if (set.size === 0) {
    return [...DEFAULT_ENABLED_CADENCES];
  }

  return BACKUP_CADENCES.filter((cadence) => set.has(cadence));
};

const normalizeTime = (value: unknown): string => {
  if (typeof value === "string" && TIME_PATTERN.test(value.trim())) {
    return value.trim();
  }

  return DEFAULT_LAMBDALESS_TIME;
};

const parseLocalDateKey = (value: string): LocalDateParts | null => {
  if (!DATE_KEY_PATTERN.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) {
    return null;
  }

  const maxDay = getDaysInMonth(year, month);
  if (month < 1 || month > 12 || day < 1 || day > maxDay) {
    return null;
  }

  return { year, month, day };
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

const toLocalDateKeyFromParts = (parts: LocalDateParts): string =>
  `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;

const getDaysInMonth = (year: number, month: number): number => {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

const buildUtcDateFromLocalParts = (parts: LocalDateParts): Date => {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
};

const compareDateKeys = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const toLocalDateParts = (date: Date, timezone: string): LocalDateParts => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  if (!year || !month || !day) {
    const fallbackParts = {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
    return fallbackParts;
  }

  return { year, month, day };
};

export const toLocalDateKey = (date: Date, timezone: string): string => {
  return toLocalDateKeyFromParts(toLocalDateParts(date, timezone));
};

export const toLocalMinuteOfDay = (date: Date, timezone: string): number => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }

  return hour * 60 + minute;
};

export const parseTimeToMinuteOfDay = (value: string): number | null => {
  const normalized = value.trim();
  if (!TIME_PATTERN.test(normalized)) {
    return null;
  }

  const [hour, minute] = normalized.split(":").map((part) => Number(part));
  return hour * 60 + minute;
};

const isValidCadenceArray = (value: unknown): value is BackupCadence[] => {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => isBackupCadence(entry))
  );
};

export const normalizeBackupScheduleConfig = ({
  value,
  timezoneFallback,
  now = new Date(),
}: {
  value: unknown;
  timezoneFallback: string;
  now?: Date;
}): { config: BackupScheduleConfig; requiresMigration: boolean } => {
  const fallbackTimezone = ensureTimezone(timezoneFallback, FALLBACK_TIMEZONE);
  const fallbackAnchor = toLocalDateKey(now, fallbackTimezone);
  const fallbackUpdatedAt = now.toISOString();

  if (!isObject(value)) {
    return {
      config: {
        version: BACKUP_SCHEDULE_VERSION,
        enabledCadences: [...DEFAULT_ENABLED_CADENCES],
        timezone: fallbackTimezone,
        lambdalessTime: DEFAULT_LAMBDALESS_TIME,
        anchorLocalDate: fallbackAnchor,
        updatedAt: fallbackUpdatedAt,
      },
      requiresMigration: true,
    };
  }

  const timezone = ensureTimezone(value.timezone, fallbackTimezone);
  const anchorLocalDate =
    typeof value.anchorLocalDate === "string" &&
    parseLocalDateKey(value.anchorLocalDate.trim())
      ? value.anchorLocalDate.trim()
      : toLocalDateKey(now, timezone);
  const config: BackupScheduleConfig = {
    version: BACKUP_SCHEDULE_VERSION,
    enabledCadences: normalizeCadences(value.enabledCadences),
    timezone,
    lambdalessTime: normalizeTime(value.lambdalessTime),
    anchorLocalDate,
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt.trim()
        ? value.updatedAt.trim()
        : fallbackUpdatedAt,
  };

  const rawTimezone = typeof value.timezone === "string" ? value.timezone.trim() : "";
  const rawAnchor =
    typeof value.anchorLocalDate === "string" ? value.anchorLocalDate.trim() : "";
  const rawUpdatedAt = typeof value.updatedAt === "string" ? value.updatedAt.trim() : "";
  const requiresMigration =
    value.version !== BACKUP_SCHEDULE_VERSION ||
    !isValidCadenceArray(value.enabledCadences) ||
    rawTimezone.length === 0 ||
    !TIME_PATTERN.test(
      typeof value.lambdalessTime === "string" ? value.lambdalessTime.trim() : "",
    ) ||
    !parseLocalDateKey(rawAnchor) ||
    rawUpdatedAt.length === 0;

  return { config, requiresMigration };
};

export const getCadenceLabel = (cadence: BackupCadence): string => {
  switch (cadence) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Bi-weekly";
    case "monthly":
      return "Monthly";
  }
};

const getDayDiff = (startDateKey: string, endDateKey: string): number => {
  const startParts = parseLocalDateKey(startDateKey);
  const endParts = parseLocalDateKey(endDateKey);

  if (!startParts || !endParts) {
    return 0;
  }

  const diffMs =
    buildUtcDateFromLocalParts(endParts).getTime() -
    buildUtcDateFromLocalParts(startParts).getTime();
  return Math.floor(diffMs / 86400000);
};

const addDaysToDateKey = (dateKey: string, dayDelta: number): string => {
  const parts = parseLocalDateKey(dateKey);
  if (!parts) {
    return dateKey;
  }

  const base = buildUtcDateFromLocalParts(parts);
  base.setUTCDate(base.getUTCDate() + dayDelta);
  return toLocalDateKeyFromParts({
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  });
};

const addMonthsToDateKey = (dateKey: string, monthDelta: number): string => {
  const parts = parseLocalDateKey(dateKey);
  if (!parts) {
    return dateKey;
  }

  const rawMonthIndex = parts.month - 1 + monthDelta;
  const year = parts.year + Math.floor(rawMonthIndex / 12);
  const monthIndex = ((rawMonthIndex % 12) + 12) % 12;
  const month = monthIndex + 1;
  const day = Math.min(parts.day, getDaysInMonth(year, month));
  return toLocalDateKeyFromParts({ year, month, day });
};

const buildMonthlyDueDateKey = (
  year: number,
  month: number,
  anchorDay: number,
): string => {
  return toLocalDateKeyFromParts({
    year,
    month,
    day: Math.min(anchorDay, getDaysInMonth(year, month)),
  });
};

const isCadenceScheduledOnDate = ({
  cadence,
  anchorLocalDate,
  localDate,
}: {
  cadence: BackupCadence;
  anchorLocalDate: string;
  localDate: string;
}): boolean => {
  if (!parseLocalDateKey(anchorLocalDate) || !parseLocalDateKey(localDate)) {
    return cadence === "daily";
  }

  if (compareDateKeys(localDate, anchorLocalDate) < 0) {
    return false;
  }

  if (cadence === "daily") {
    return true;
  }

  if (cadence === "weekly" || cadence === "biweekly") {
    const interval = cadence === "weekly" ? 7 : 14;
    const diffDays = getDayDiff(anchorLocalDate, localDate);
    return diffDays >= 0 && diffDays % interval === 0;
  }

  const anchorParts = parseLocalDateKey(anchorLocalDate);
  const currentParts = parseLocalDateKey(localDate);
  if (!anchorParts || !currentParts) {
    return false;
  }

  const dueDay = Math.min(
    anchorParts.day,
    getDaysInMonth(currentParts.year, currentParts.month),
  );
  return currentParts.day === dueDay;
};

export const isCadenceDueNow = ({
  cadence,
  anchorLocalDate,
  currentLocalDate,
  lastRunLocalDate,
}: {
  cadence: BackupCadence;
  anchorLocalDate: string;
  currentLocalDate: string;
  lastRunLocalDate?: string;
}): boolean => {
  if (lastRunLocalDate && compareDateKeys(lastRunLocalDate, currentLocalDate) === 0) {
    return false;
  }

  return isCadenceScheduledOnDate({
    cadence,
    anchorLocalDate,
    localDate: currentLocalDate,
  });
};

export const getNextDueLocalDate = ({
  cadence,
  anchorLocalDate,
  currentLocalDate,
  lastRunLocalDate,
}: {
  cadence: BackupCadence;
  anchorLocalDate: string;
  currentLocalDate: string;
  lastRunLocalDate?: string;
}): string => {
  const alreadyRanToday =
    typeof lastRunLocalDate === "string" &&
    compareDateKeys(lastRunLocalDate, currentLocalDate) === 0;

  if (
    !alreadyRanToday &&
    isCadenceScheduledOnDate({
      cadence,
      anchorLocalDate,
      localDate: currentLocalDate,
    })
  ) {
    return currentLocalDate;
  }

  if (cadence === "daily") {
    return addDaysToDateKey(currentLocalDate, 1);
  }

  if (cadence === "weekly" || cadence === "biweekly") {
    const interval = cadence === "weekly" ? 7 : 14;
    const diffDays = getDayDiff(anchorLocalDate, currentLocalDate);

    if (diffDays < 0) {
      return anchorLocalDate;
    }

    const offset = interval - (diffDays % interval);
    return addDaysToDateKey(currentLocalDate, offset);
  }

  const currentParts = parseLocalDateKey(currentLocalDate);
  const anchorParts = parseLocalDateKey(anchorLocalDate);
  if (!currentParts || !anchorParts) {
    return currentLocalDate;
  }

  const dueThisMonth = toLocalDateKeyFromParts({
    year: currentParts.year,
    month: currentParts.month,
    day: Math.min(anchorParts.day, getDaysInMonth(currentParts.year, currentParts.month)),
  });

  if (
    compareDateKeys(dueThisMonth, currentLocalDate) > 0 ||
    (compareDateKeys(dueThisMonth, currentLocalDate) === 0 && !alreadyRanToday)
  ) {
    return dueThisMonth;
  }

  const firstOfCurrentMonth = toLocalDateKeyFromParts({
    year: currentParts.year,
    month: currentParts.month,
    day: 1,
  });
  const firstOfNextMonth = addMonthsToDateKey(firstOfCurrentMonth, 1);
  const nextMonthParts = parseLocalDateKey(firstOfNextMonth);
  if (!nextMonthParts) {
    return firstOfNextMonth;
  }

  return buildMonthlyDueDateKey(
    nextMonthParts.year,
    nextMonthParts.month,
    anchorParts.day,
  );
};

export const getLastRunLocalDateForCadence = ({
  scheduleState,
  cadence,
  now,
}: {
  scheduleState: AutomaticBackupsScheduleState;
  cadence: BackupCadence;
  now: Date;
}): string | undefined => {
  const byCadence = scheduleState.lastRunLocalDateByCadence?.[cadence];
  if (typeof byCadence === "string" && parseLocalDateKey(byCadence)) {
    return byCadence;
  }

  if (cadence === "daily") {
    if (
      typeof scheduleState.dailyLastRunDate === "string" &&
      parseLocalDateKey(scheduleState.dailyLastRunDate)
    ) {
      return scheduleState.dailyLastRunDate;
    }
  }

  if (cadence === "weekly" && typeof scheduleState.weeklyLastRunKey === "string") {
    const currentWeekKey = toUtcIsoWeekKey(now);
    if (scheduleState.weeklyLastRunKey === currentWeekKey) {
      return toLocalDateKey(now, FALLBACK_TIMEZONE);
    }
  }

  return undefined;
};

export const toUtcIsoWeekKey = (date: Date): string => {
  const workingDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = workingDate.getUTCDay() || 7;
  workingDate.setUTCDate(workingDate.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(workingDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((workingDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );

  return `${workingDate.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
};

export const toUtcDateFromLocalDateKey = (localDateKey: string): Date | undefined => {
  const parsed = parseLocalDateKey(localDateKey);
  if (!parsed) {
    return undefined;
  }

  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0));
};
