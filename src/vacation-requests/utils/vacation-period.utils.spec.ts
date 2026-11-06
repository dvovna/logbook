import { getCurrentVacationPeriod } from 'src/vacation-requests/utils/vacation-period.utils';

const toDates = ({ periodStart, periodEnd }) => [
  periodStart.toISOString().slice(0, 10),
  periodEnd.toISOString().slice(0, 10),
];

describe('getCurrentVacationPeriod', () => {
  it('starts on this year contract anniversary once it has passed', () => {
    const period = getCurrentVacationPeriod(
      '2020-05-15',
      new Date('2026-11-06'),
    );

    expect(toDates(period)).toEqual(['2026-05-15', '2027-05-14']);
  });

  it('starts on last year anniversary before this year one', () => {
    const period = getCurrentVacationPeriod(
      '2020-05-15',
      new Date('2026-03-01'),
    );

    expect(toDates(period)).toEqual(['2025-05-15', '2026-05-14']);
  });

  it.each([null, undefined])(
    'uses the calendar year when the contract start date is %s',
    (contractStartDate) => {
      const period = getCurrentVacationPeriod(
        contractStartDate,
        new Date('2026-11-06'),
      );

      expect(toDates(period)).toEqual(['2026-01-01', '2026-12-31']);
    },
  );
});
