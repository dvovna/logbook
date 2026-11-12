import { TimeOffContextService } from 'src/vacation-requests/services/time-off-context.service';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import VacationType from 'src/common/enums/vacation-type.enum';

const SLACK_TEAM_ID = 'slack-team-1';

const buildRequest = (
  overrides: Partial<IVacationRequestViewModel> = {},
): IVacationRequestViewModel => ({
  id: 'request-1',
  start_date: '2026-02-02',
  end_date: '2026-02-06',
  days: 5,
  working_days: 5,
  type: VacationType.AnnualLeave,
  status: VacationRequestStatus.Pending,
  team: { id: 'team-1', name: 'Team', slack_id: '' },
  user: {
    id: 'user-1',
    name: 'Requester',
    email: 'requester@example.com',
    slack_id: 'U_REQUESTER',
  },
  team_id: 'team-1',
  user_id: 'user-1',
  slack_team_id: SLACK_TEAM_ID,
  created_at: null,
  updated_at: null,
  updated_by: null,
  created_by: null,
  leave_file_upload_id: null,
  ...overrides,
});

const colleague = (
  name: string,
  type = VacationType.AnnualLeave,
): IVacationRequestViewModel =>
  buildRequest({
    id: `request-of-${name}`,
    user_id: `user-${name}`,
    user: { id: `user-${name}`, name, email: '', slack_id: '' },
    start_date: '2026-02-01',
    end_date: '2026-02-03',
    type,
  });

describe('TimeOffContextService', () => {
  let requestsService: { findMany: jest.Mock };
  let service: TimeOffContextService;

  beforeEach(() => {
    requestsService = { findMany: jest.fn().mockResolvedValue([]) };
    service = new TimeOffContextService(
      requestsService as unknown as VacationRequestsService,
    );
  });

  it('lists teammates whose approved or pending time off shares a day with the request, without the requester', async () => {
    const request = buildRequest();
    // The request itself overlaps; it is left out.
    requestsService.findMany.mockResolvedValue([request, colleague('Lea')]);

    const colleaguesOff = await service.findColleaguesOff(request, {
      forRequester: false,
    });

    expect(requestsService.findMany).toHaveBeenCalledWith({
      slackTeamId: SLACK_TEAM_ID,
      teamId: 'team-1',
      statuses: [VacationRequestStatus.Approved, VacationRequestStatus.Pending],
      overlapping: { startDate: '2026-02-02', endDate: '2026-02-06' },
    });
    expect(colleaguesOff).toEqual([
      { name: 'Lea', start_date: '2026-02-01', end_date: '2026-02-03' },
    ]);
  });

  it('names at most five', async () => {
    requestsService.findMany.mockResolvedValue(
      ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => colleague(name)),
    );

    const colleaguesOff = await service.findColleaguesOff(buildRequest(), {
      forRequester: false,
    });

    expect(colleaguesOff.map(({ name }) => name)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
    ]);
  });

  // Approvers see sick leave, as in Slack; colleagues don't.
  it('leaves sick leave out for the requester', async () => {
    requestsService.findMany.mockResolvedValue([
      colleague('Lea', VacationType.SickLeave),
      colleague('Max'),
    ]);

    const forRequester = await service.findColleaguesOff(buildRequest(), {
      forRequester: true,
    });
    const forApprovers = await service.findColleaguesOff(buildRequest(), {
      forRequester: false,
    });

    expect(forRequester.map(({ name }) => name)).toEqual(['Max']);
    expect(forApprovers.map(({ name }) => name)).toEqual(['Lea', 'Max']);
  });

  it('finds nobody for a request made outside a team', async () => {
    const colleaguesOff = await service.findColleaguesOff(
      buildRequest({ team_id: null, team: null }),
      { forRequester: true },
    );

    expect(colleaguesOff).toEqual([]);
    expect(requestsService.findMany).not.toHaveBeenCalled();
  });
});
