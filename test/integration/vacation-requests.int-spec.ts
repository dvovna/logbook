import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { Tables } from '@common/types/database.types';
import { CANCEL_REQUEST_ACTION_ID } from '@modules/slack/tabs/home/views/cancel-vacation-request-select-modal.view';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { addDays, workWeek } from './support/dates';
import { findAction, textOf } from './support/block-kit';
import { acknowledged } from './support/slack-test-client';
import { publishedHome } from './support/app-home';
import { noticeOf, sectionTexts } from './support/tab-readers';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  approvalMessageTo,
  requestVacation,
  submitVacationRequest,
  VACATIONS_COMMAND,
} from './support/vacation-flows';

describe('/vacations', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let manager: Tables<'users'>;
  let member: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    manager = await workspace.addUser({ role: UserRole.Manager });
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
    });
    member = await workspace.addUser({ team_id: team.id });
  });

  const command = async (text: string) => {
    const since = t.slackApi.mark();

    await t.slack
      .command(VACATIONS_COMMAND, workspace, member, text)
      .expect(acknowledged);

    return since;
  };

  const ephemeralReply = async (since: number) => {
    await t.idle();
    const [reply] = t.slackApi.ephemeralMessages(
      workspace.token,
      member.slack_id,
      { since },
    );
    expect(reply).toBeDefined();

    return textOf(reply);
  };

  describe('cancel', () => {
    it('cancels a pending request and closes its approval message', async () => {
      const request = await requestVacation(t, workspace, member, workWeek(2));
      const approval = await approvalMessageTo(t, workspace, manager);

      const since = await command('cancel');
      await t.idle();
      const modal = t.slackApi.openedModal(workspace.token, { since });

      const submitted = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, member, modal, {
          [CANCEL_REQUEST_ACTION_ID]: request.id,
        })
        .expect(200);

      // The form closes; Home shows the request gone.
      expect(response.body).toEqual({ response_action: 'clear' });
      const home = await publishedHome(t, workspace, member, submitted);
      expect(home.callback_id).toBe(ViewCallbackId.HomeTabView);
      expect(noticeOf(home)).toBe('✅ Vacation request canceled.');
      expect(
        sectionTexts(home).filter((text) => text.startsWith('*Annual leave*')),
      ).toEqual([]);
      expect(
        (await workspace.row('vacation_requests', request.id)).status,
      ).toBe(VacationRequestStatus.Canceled);
      await t.idle();
      const [update] = t.slackApi.messageUpdates(workspace.token, approval);
      expect(textOf(update)).toContain(`Canceled by <@${member.slack_id}>`);
    });

    it('offers only pending requests', async () => {
      const pending = await requestVacation(t, workspace, member, workWeek(2));
      const approved = await requestVacation(t, workspace, member, workWeek(4));
      await t.db
        .updateTable('vacation_requests')
        .set({ status: VacationRequestStatus.Approved })
        .where('id', '=', approved.id)
        .execute();

      const since = await command('cancel');
      await t.idle();
      const modal = t.slackApi.openedModal(workspace.token, { since });

      expect(
        findAction(modal.blocks, CANCEL_REQUEST_ACTION_ID).element.options.map(
          ({ value }: { value: string }) => value,
        ),
      ).toEqual([pending.id]);
    });

    it('says so when there is nothing to cancel', async () => {
      const since = await command('cancel');

      expect(await ephemeralReply(since)).toContain(
        'no vacation requests waiting for approval',
      );
    });
  });

  describe('request', () => {
    it('refuses dates that overlap an active request', async () => {
      const { start, end } = workWeek(2);
      await requestVacation(t, workspace, member, { start, end });

      const response = await submitVacationRequest(t, workspace, member, {
        start: addDays(end, -1),
        end: addDays(end, 3),
      });

      // At the dates, so what was typed stays in the form.
      expect(response.response_action).toBe('errors');
      expect(response.errors.end_date_block).toContain(
        'overlap with another vacation request',
      );
      expect(await workspace.rows('vacation_requests')).toHaveLength(1);
    });

    it('allows the dates of a canceled request again', async () => {
      const dates = workWeek(2);
      const first = await requestVacation(t, workspace, member, dates);
      await t.db
        .updateTable('vacation_requests')
        .set({ status: VacationRequestStatus.Canceled })
        .where('id', '=', first.id)
        .execute();

      const response = await submitVacationRequest(t, workspace, member, {
        start: addDays(dates.start, 1),
        end: dates.end,
      });

      expect(response).toEqual({ response_action: 'clear' });
      expect(await workspace.rows('vacation_requests')).toHaveLength(2);
    });

    it('returns field errors for an invalid form', async () => {
      const { start, end } = workWeek(2);

      const response = await submitVacationRequest(t, workspace, member, {
        start: end,
        end: start,
      });

      expect(response).toEqual({
        response_action: 'errors',
        errors: { end_date_block: 'End date must be after start date' },
      });
    });
  });

  describe('usage', () => {
    it('shows days used and no limits without a vacation policy', async () => {
      // A vacation year that started a month ago, so next weeks fall into it
      // whatever the date.
      const today = new Date().toISOString().slice(0, 10);
      await t.db
        .updateTable('users')
        .set({ contract_start_date: addDays(today, -30) })
        .where('id', '=', member.id)
        .execute();
      member = await workspace.row('users', member.id);

      // Pending requests count as used too.
      await requestVacation(t, workspace, member, workWeek(2));

      const reply = await ephemeralReply(await command('usage'));

      expect(reply).toContain('Used: 5 days');
      expect(reply).toContain('Remaining: not limited');
    });
  });
});
