import VacationType from '@common/enums/vacation-type.enum';
import { Tables } from '@common/types/database.types';
import { ITestApp } from './test-app';
import { TestWorkspace } from './test-workspace';
import { acknowledged } from './slack-test-client';
import { eventually } from './eventually';

interface IRequestVacationParams {
  start: string;
  end: string;
  type?: VacationType;
  comment?: string;
}

export const VACATIONS_COMMAND = '/api/slack/vacations';

// `/vacations request`, then the form submitted the way the user fills it in.
// Returns Slack's response to the submission (the view_submission answer).
export const submitVacationRequest = async (
  t: ITestApp,
  workspace: TestWorkspace,
  user: Tables<'users'>,
  {
    start,
    end,
    type = VacationType.AnnualLeave,
    comment,
  }: IRequestVacationParams,
) => {
  const since = t.slackApi.mark();

  await t.slack
    .command(VACATIONS_COMMAND, workspace, user, 'request')
    .expect(acknowledged);

  const modal = await eventually(() =>
    t.slackApi.openedModal(workspace.token, { since }),
  );

  const response = await t.slack
    .submitView(workspace, user, modal, {
      start_date: start,
      end_date: end,
      type_option: type,
      comment,
    })
    .expect(200);

  return response.body;
};

// Like submitVacationRequest, but expects the request to be created and
// returns its row.
export const requestVacation = async (
  t: ITestApp,
  workspace: TestWorkspace,
  user: Tables<'users'>,
  params: IRequestVacationParams,
) => {
  const response = await submitVacationRequest(t, workspace, user, params);

  expect(JSON.stringify(response)).toContain('created successfully');

  const requests = await workspace.rows('vacation_requests');
  const request = requests.find(
    ({ user_id, start_date }) =>
      user_id === user.id && start_date === params.start,
  );

  if (!request) {
    throw new Error('The vacation request was not saved');
  }

  return request;
};

// The approval DM the bot sent to an approver.
export const approvalMessageTo = (
  t: ITestApp,
  workspace: TestWorkspace,
  approver: Tables<'users'>,
) =>
  eventually(() => {
    const [message] = t.slackApi.postedMessages(
      workspace.token,
      approver.slack_id,
    );

    if (!message) {
      throw new Error(`${approver.name} got no approval request`);
    }

    return message;
  });
