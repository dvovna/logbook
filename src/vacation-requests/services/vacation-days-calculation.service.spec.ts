import { VacationDaysCalculationService } from 'src/vacation-requests/services/vacation-days-calculation.service';
import HolidaysService from 'src/holidays/services/holidays.service';

const SLACK_TEAM_ID = 'slack-team-1';
const POLICY_ID = 'policy-1';

describe('VacationDaysCalculationService', () => {
  let holidaysService: { findMany: jest.Mock };
  let service: VacationDaysCalculationService;

  beforeEach(() => {
    holidaysService = { findMany: jest.fn().mockResolvedValue([]) };
    service = new VacationDaysCalculationService(
      holidaysService as unknown as HolidaysService,
    );
  });

  it('counts only weekdays in a full week', async () => {
    // Mon 2026-01-05 .. Sun 2026-01-11
    const days = await service.calculate(
      new Date('2026-01-05'),
      new Date('2026-01-11'),
      POLICY_ID,
      SLACK_TEAM_ID,
    );

    expect(days).toBe(5);
  });

  it('includes both start and end dates', async () => {
    const days = await service.calculate(
      new Date('2026-01-07'),
      new Date('2026-01-07'),
      POLICY_ID,
      SLACK_TEAM_ID,
    );

    expect(days).toBe(1);
  });

  it('returns 0 for a weekend-only range', async () => {
    const days = await service.calculate(
      new Date('2026-01-10'),
      new Date('2026-01-11'),
      POLICY_ID,
      SLACK_TEAM_ID,
    );

    expect(days).toBe(0);
  });

  it('excludes holidays of the vacation policy', async () => {
    holidaysService.findMany.mockResolvedValue([
      { date: '2026-01-06' },
      { date: '2026-01-07' },
    ]);

    const start = new Date('2026-01-05');
    const end = new Date('2026-01-09');
    const days = await service.calculate(start, end, POLICY_ID, SLACK_TEAM_ID);

    expect(days).toBe(3);
    expect(holidaysService.findMany).toHaveBeenCalledWith({
      slackTeamId: SLACK_TEAM_ID,
      vacationPolicyId: POLICY_ID,
      startDate: start,
      endDate: end,
      excludeDisabled: true,
    });
  });

  it('does not subtract a holiday that falls on a weekend twice', async () => {
    holidaysService.findMany.mockResolvedValue([{ date: '2026-01-10' }]);

    const days = await service.calculate(
      new Date('2026-01-05'),
      new Date('2026-01-11'),
      POLICY_ID,
      SLACK_TEAM_ID,
    );

    expect(days).toBe(5);
  });

  it('skips holiday lookup when the user has no vacation policy', async () => {
    const days = await service.calculate(
      new Date('2026-01-05'),
      new Date('2026-01-09'),
      null,
      SLACK_TEAM_ID,
    );

    expect(days).toBe(5);
    expect(holidaysService.findMany).not.toHaveBeenCalled();
  });

  it('counts across month and year boundaries', async () => {
    // Mon 2025-12-29 .. Fri 2026-01-02
    const days = await service.calculate(
      new Date('2025-12-29'),
      new Date('2026-01-02'),
      POLICY_ID,
      SLACK_TEAM_ID,
    );

    expect(days).toBe(5);
  });
});
