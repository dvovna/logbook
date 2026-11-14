import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { AbsenceCheckService } from '@modules/request-workflows/services/absence-check.service';
import {
  VacationRequestCreatedEvent,
  VacationRequestUpdatedEvent,
} from '@modules/vacation-requests/events/vacation-request.events';
import { ApproverAbsenceTriggerService } from '@modules/vacation-requests/services/approver-absence-trigger.service';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';

const TODAY = '2026-06-17';
const SLACK_TEAM_ID = 'w1';
const editor = { id: 'hr' } as IUserViewModel;

const requestOf = (
  changes: Partial<IVacationRequestViewModel> = {},
): IVacationRequestViewModel =>
  ({
    id: 'r1',
    slack_team_id: SLACK_TEAM_ID,
    status: VacationRequestStatus.Approved,
    start_date: TODAY,
    end_date: '2026-06-19',
    user_id: 'lead',
    user: { id: 'lead', name: 'Lea Lead', email: 'l@x.io', slack_id: 'ULEAD' },
    user_comment: null,
    ...changes,
  }) as IVacationRequestViewModel;

const otherPerson = {
  user_id: 'sam',
  user: { id: 'sam', name: 'Sam', email: 's@x.io', slack_id: 'USAM' },
};

describe('ApproverAbsenceTriggerService', () => {
  let checkPerson: jest.Mock;
  let service: ApproverAbsenceTriggerService;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(`${TODAY}T09:00:00Z`) });
    checkPerson = jest.fn().mockResolvedValue(undefined);
    service = new ApproverAbsenceTriggerService({
      checkPerson,
    } as unknown as AbsenceCheckService);
  });

  afterEach(() => jest.useRealTimers());

  const updated = (
    request: IVacationRequestViewModel,
    previous?: IVacationRequestViewModel,
  ) =>
    service.handleUpdated(
      new VacationRequestUpdatedEvent(request, editor, previous),
    );

  it('checks the person when time off covering today is created approved', async () => {
    await service.handleCreated(
      new VacationRequestCreatedEvent(requestOf(), editor),
    );

    expect(checkPerson).toHaveBeenCalledWith(SLACK_TEAM_ID, 'ULEAD');
  });

  it('checks the person when the workflow approves time off covering today', async () => {
    await updated(requestOf());

    expect(checkPerson).toHaveBeenCalledWith(SLACK_TEAM_ID, 'ULEAD');
  });

  it.each([
    ['pending', requestOf({ status: VacationRequestStatus.Pending })],
    ['rejected', requestOf({ status: VacationRequestStatus.Rejected })],
    ['starting tomorrow', requestOf({ start_date: '2026-06-18' })],
    [
      'ended yesterday',
      requestOf({ start_date: '2026-06-15', end_date: '2026-06-16' }),
    ],
  ])('checks nobody for time off %s', async (_, request) => {
    await service.handleCreated(
      new VacationRequestCreatedEvent(request, editor),
    );
    await updated(
      request,
      requestOf({ status: VacationRequestStatus.Pending }),
    );

    expect(checkPerson).not.toHaveBeenCalled();
  });

  it('checks nobody when an edit leaves the same person away today (only the comment changed)', async () => {
    await updated(requestOf({ user_comment: 'Back on Monday' }), requestOf());

    expect(checkPerson).not.toHaveBeenCalled();
  });

  it('checks the new person when an edit moves time off covering today to someone else', async () => {
    await updated(requestOf(otherPerson), requestOf());

    expect(checkPerson).toHaveBeenCalledWith(SLACK_TEAM_ID, 'USAM');
  });

  it('checks the person when an approved request is edited to cover today', async () => {
    await updated(
      requestOf(),
      requestOf({ start_date: '2026-06-22', end_date: '2026-06-24' }),
    );

    expect(checkPerson).toHaveBeenCalledWith(SLACK_TEAM_ID, 'ULEAD');
  });

  it('checks the person when an edit approves a request covering today', async () => {
    await updated(
      requestOf(),
      requestOf({ status: VacationRequestStatus.Pending }),
    );

    expect(checkPerson).toHaveBeenCalledWith(SLACK_TEAM_ID, 'ULEAD');
  });
});
