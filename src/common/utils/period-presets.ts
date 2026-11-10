// The quick periods of the report forms. Choosing one fills the form's dates,
// which the user can still change.
export enum PeriodPreset {
  ThisWeek = 'this_week',
  LastWeek = 'last_week',
  ThisMonth = 'this_month',
  LastMonth = 'last_month',
  ThisQuarter = 'this_quarter',
  LastQuarter = 'last_quarter',
  // No dates: for a report that may cover everything (uninvoiced time).
  AllTime = 'all_time',
}

export const PERIOD_PRESET_NAMES: Record<PeriodPreset, string> = {
  [PeriodPreset.ThisWeek]: 'This week',
  [PeriodPreset.LastWeek]: 'Last week',
  [PeriodPreset.ThisMonth]: 'This month',
  [PeriodPreset.LastMonth]: 'Last month',
  [PeriodPreset.ThisQuarter]: 'This quarter',
  [PeriodPreset.LastQuarter]: 'Last quarter',
  [PeriodPreset.AllTime]: 'All time',
};

// The presets of a form whose period has dates.
export const DATED_PERIOD_PRESETS = Object.values(PeriodPreset).filter(
  (preset) => preset !== PeriodPreset.AllTime,
);

export const isPeriodPreset = (value: unknown): value is PeriodPreset =>
  Object.values(PeriodPreset).includes(value as PeriodPreset);

export interface IPeriod {
  fromDate: string;
  toDate: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

const utcDate = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day));

// The dates of `preset` on `today` (UTC, as the app runs), both counted;
// null for all time. Weeks start on Monday. A "this" period runs up to
// today, as the forms' default (this month up to today) does; a "last" one
// is whole.
export const presetPeriod = (
  preset: PeriodPreset,
  today: Date = new Date(),
): IPeriod | null => {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const day = today.getUTCDate();
  const monday = utcDate(year, month, day - ((today.getUTCDay() + 6) % 7));
  const quarter = Math.floor(month / 3) * 3;
  const todayDate = isoDate(utcDate(year, month, day));

  switch (preset) {
    case PeriodPreset.ThisWeek:
      return { fromDate: isoDate(monday), toDate: todayDate };
    case PeriodPreset.LastWeek:
      return {
        fromDate: isoDate(new Date(monday.getTime() - 7 * DAY_MS)),
        toDate: isoDate(new Date(monday.getTime() - DAY_MS)),
      };
    case PeriodPreset.ThisMonth:
      return { fromDate: isoDate(utcDate(year, month, 1)), toDate: todayDate };
    case PeriodPreset.LastMonth:
      return {
        fromDate: isoDate(utcDate(year, month - 1, 1)),
        toDate: isoDate(utcDate(year, month, 0)),
      };
    case PeriodPreset.ThisQuarter:
      return {
        fromDate: isoDate(utcDate(year, quarter, 1)),
        toDate: todayDate,
      };
    case PeriodPreset.LastQuarter:
      return {
        fromDate: isoDate(utcDate(year, quarter - 3, 1)),
        toDate: isoDate(utcDate(year, quarter, 0)),
      };
    case PeriodPreset.AllTime:
      return null;
  }
};
