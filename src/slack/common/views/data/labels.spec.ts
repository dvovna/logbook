import VacationRequestStatus from '@common/enums/vacation-status.enum';
import VacationType from '@common/enums/vacation-type.enum';
import {
  balanceTitle,
  labelOptions,
  personLabel,
  VACATION_STATUS_LABELS,
  withIcon,
} from '@modules/slack/common/views/data/labels';

describe('labels', () => {
  it('shows a value with its icon first', () => {
    expect(
      withIcon(VACATION_STATUS_LABELS[VacationRequestStatus.Canceled]),
    ).toBe('🚫 Canceled');
  });

  it('offers every value as an option, keyed by the value', () => {
    expect(labelOptions(VACATION_STATUS_LABELS)).toEqual([
      { id: 'pending', name: '⏳ Pending' },
      { id: 'approved', name: '✅ Approved' },
      { id: 'rejected', name: '❌ Rejected' },
      { id: 'canceled', name: '🚫 Canceled' },
    ]);
  });

  it('names the days left of a type', () => {
    expect(balanceTitle(VacationType.BonusDay)).toBe('🎁 Bonus days');
  });

  it('names a person by their name, else their email', () => {
    expect(personLabel({ name: 'Ada', email: 'ada@example.com' })).toBe('Ada');
    expect(personLabel({ name: '', email: 'ada@example.com' })).toBe(
      'ada@example.com',
    );
    expect(personLabel({})).toBe('Unknown');
  });
});
