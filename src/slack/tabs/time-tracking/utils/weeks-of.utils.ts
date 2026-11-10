import { getDateOnly, weekLabel } from '@common/utils/date.utils';
import { weekStartOf } from '@common/utils/period-presets';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';

// Where on My time, which shows a week, the entries are: 'week of 8 Jun', or
// 'from the week of 1 Jun' when they are in several.
export const weeksOf = (entries: Pick<ITimeEntryViewModel, 'work_date'>[]) => {
  const weeks = [
    ...new Set(
      entries.map(({ work_date }) => weekStartOf(getDateOnly(work_date))),
    ),
  ].sort();

  return `${weeks.length > 1 ? 'from the ' : ''}week of ${weekLabel(weeks[0])}`;
};
